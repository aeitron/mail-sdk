import {
  CreateEmailOptions,
  CreateEmailResponse,
  BatchEmailResponse,
  EmailRecord,
  SendTemplateOptions,
  SuppressionRecord,
  SuppressionReason,
  MailClientOptions,
} from './types.js';
import {
  MailError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  DeliveryError,
  ServerError,
} from './errors.js';
import { WebhookVerifier, WebhookVerifyOptions } from './webhooks.js';

export const DEFAULT_BASE_URL = 'https://dashboard.aeitron.com';
export const DEFAULT_API_VERSION = '2026-11-01';
export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_MAX_RETRIES = 3;
export const SDK_VERSION = '0.1.0';

export class AeitronMail {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly defaultFrom?: string;
  private readonly apiVersion: string;

  public readonly emails: EmailsNamespace;
  public readonly templates: TemplatesNamespace;
  public readonly suppressions: SuppressionsNamespace;
  public readonly webhooks: WebhooksNamespace;

  constructor(apiKeyOrOptions?: string | MailClientOptions) {
    let options: MailClientOptions = {};
    if (typeof apiKeyOrOptions === 'string') {
      options = { apiKey: apiKeyOrOptions };
    } else if (apiKeyOrOptions) {
      options = apiKeyOrOptions;
    }

    const key = options.apiKey || (typeof process !== 'undefined' ? process.env?.AEITRON_MAIL_API_KEY || process.env?.AEITRON_API_KEY : '');
    const trimmedKey = (key || '').trim();

    if (!trimmedKey) {
      throw new AuthenticationError('AeitronMail requires an API key (e.g. amk_live_... or atk_live_...)');
    }

    this.apiKey = trimmedKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.defaultFrom = options.defaultFrom;
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;

    this.emails = new EmailsNamespace(this);
    this.templates = new TemplatesNamespace(this);
    this.suppressions = new SuppressionsNamespace(this);
    this.webhooks = new WebhooksNamespace();
  }

  /**
   * Internal HTTP execution engine with exponential backoff & jitter retry.
   */
  public async request<T>(
    method: string,
    path: string,
    body?: any,
    headers: Record<string, string> = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const maxAttempts = 1 + this.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(100 * Math.pow(2, attempt - 1), 3000);
        const jitter = Math.random() * (backoff / 2);
        await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const reqHeaders: Record<string, string> = {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': `@aeitron/mail/${SDK_VERSION} (Node.js)`,
          'X-API-Version': this.apiVersion,
          ...headers,
        };

        const res = await fetch(url, {
          method,
          headers: reqHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          if (res.status === 204) {
            return {} as T;
          }
          return (await res.json()) as T;
        }

        // Handle error status
        const requestId = res.headers.get('x-request-id') || undefined;
        let errorData: any = {};
        try {
          errorData = await res.json();
        } catch {
          errorData = { message: res.statusText };
        }

        const message = errorData.message || errorData.error || res.statusText || 'Mail request failed';
        const code = errorData.code;

        let err: MailError;
        switch (res.status) {
          case 400:
          case 422:
            err = new ValidationError(message, res.status, code, requestId);
            break;
          case 401:
            err = new AuthenticationError(message, res.status, code, requestId);
            break;
          case 403:
            err = new PermissionDeniedError(message, res.status, code, requestId);
            break;
          case 404:
            err = new NotFoundError(message, res.status, code, requestId);
            break;
          case 429: {
            const retryHeader = res.headers.get('retry-after');
            const retryAfterSec = retryHeader ? parseInt(retryHeader, 10) : 1;
            err = new RateLimitError(message, retryAfterSec, res.status, code, requestId);
            break;
          }
          case 502:
            err = new DeliveryError(message, res.status, code, requestId);
            break;
          default:
            err = res.status >= 500
              ? new ServerError(message, res.status, code, requestId)
              : new MailError(message, res.status, code, requestId);
        }

        // Check retryable status (429 or 5xx)
        if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts - 1) {
          lastError = err;
          continue;
        }

        throw err;
      } catch (e: any) {
        clearTimeout(timer);
        if (e instanceof MailError) {
          throw e;
        }
        lastError = e;
        if (attempt < maxAttempts - 1) {
          continue;
        }
        throw new ServerError(`Network failure during mail request: ${e.message}`);
      }
    }

    throw lastError || new ServerError('Mail request failed after retries');
  }

  public getDefaultFrom(): string | undefined {
    return this.defaultFrom;
  }
}

/**
 * Emails namespace for single, batch, and status operations.
 */
export class EmailsNamespace {
  constructor(private readonly client: AeitronMail) {}

  /**
   * Dispatches a single transactional or marketing email.
   */
  public async send(options: CreateEmailOptions): Promise<CreateEmailResponse> {
    if (!options) {
      throw new ValidationError('Email options are required');
    }

    const from = options.from || this.client.getDefaultFrom();
    if (!from) {
      throw new ValidationError('Email "from" address is required (either in options or client defaultFrom)');
    }

    if (!options.to || (Array.isArray(options.to) && options.to.length === 0)) {
      throw new ValidationError('Email "to" address is required');
    }

    if (!options.subject) {
      throw new ValidationError('Email "subject" is required');
    }

    if (!options.html && !options.text) {
      throw new ValidationError('Email body ("html" or "text") is required');
    }

    const payload = {
      ...options,
      from,
      to: Array.isArray(options.to) ? options.to : [options.to],
      cc: options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : undefined,
      bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : undefined,
      replyTo: options.replyTo ? (Array.isArray(options.replyTo) ? options.replyTo : [options.replyTo]) : undefined,
    };

    const headers: Record<string, string> = {};
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    if (options.sovereignJurisdiction) {
      headers['X-Sovereign-Jurisdiction'] = options.sovereignJurisdiction;
    }

    return this.client.request<CreateEmailResponse>('POST', '/v1/mail/send', payload, headers);
  }

  /**
   * Dispatches a batch of up to 100 emails in a single atomic network roundtrip.
   */
  public async sendBatch(emails: CreateEmailOptions[]): Promise<BatchEmailResponse> {
    if (!Array.isArray(emails) || emails.length === 0) {
      throw new ValidationError('Batch send requires a non-empty array of email options');
    }

    const processedEmails = emails.map((opt) => {
      const from = opt.from || this.client.getDefaultFrom();
      if (!from) {
        throw new ValidationError('Batch item missing "from" address');
      }
      return {
        ...opt,
        from,
        to: Array.isArray(opt.to) ? opt.to : [opt.to],
      };
    });

    return this.client.request<BatchEmailResponse>('POST', '/v1/mail/batch', { emails: processedEmails });
  }

  /**
   * Retrieves delivery telemetry, open, click, and bounce status for a sent email.
   */
  public async get(emailId: string): Promise<EmailRecord> {
    if (!emailId || !emailId.trim()) {
      throw new ValidationError('Email ID is required');
    }
    return this.client.request<EmailRecord>('GET', `/v1/mail/emails/${encodeURIComponent(emailId)}`);
  }

  /**
   * Cancels a scheduled or queued email before transit.
   */
  public async cancel(emailId: string): Promise<{ success: boolean }> {
    if (!emailId || !emailId.trim()) {
      throw new ValidationError('Email ID is required');
    }
    return this.client.request<{ success: boolean }>('POST', `/v1/mail/emails/${encodeURIComponent(emailId)}/cancel`);
  }
}

/**
 * Templates namespace for rendering and variable interpolation.
 */
export class TemplatesNamespace {
  constructor(private readonly client: AeitronMail) {}

  /**
   * Renders a dynamic email template with provided variables.
   */
  public async render(templateId: string, variables: Record<string, any>): Promise<{ html: string; text: string }> {
    if (!templateId) {
      throw new ValidationError('Template ID is required');
    }
    return this.client.request<{ html: string; text: string }>('POST', `/v1/mail/templates/${encodeURIComponent(templateId)}/render`, {
      variables,
    });
  }

  /**
   * Sends an email directly from a pre-configured template.
   */
  public async send(options: SendTemplateOptions): Promise<CreateEmailResponse> {
    if (!options.templateId) {
      throw new ValidationError('Template ID is required');
    }
    const from = options.from || this.client.getDefaultFrom();
    if (!from) {
      throw new ValidationError('Email "from" address is required');
    }

    const headers: Record<string, string> = {};
    if (options.sovereignJurisdiction) {
      headers['X-Sovereign-Jurisdiction'] = options.sovereignJurisdiction;
    }

    return this.client.request<CreateEmailResponse>('POST', `/v1/mail/templates/${encodeURIComponent(options.templateId)}/send`, {
      ...options,
      from,
      to: Array.isArray(options.to) ? options.to : [options.to],
    }, headers);
  }
}

/**
 * Suppressions namespace for unsubscribe, bounce, and complaint management.
 */
export class SuppressionsNamespace {
  constructor(private readonly client: AeitronMail) {}

  /**
   * Lists all currently suppressed recipients.
   */
  public async list(): Promise<SuppressionRecord[]> {
    const res = await this.client.request<{ suppressions: SuppressionRecord[] }>('GET', '/v1/mail/suppressions');
    return res.suppressions || [];
  }

  /**
   * Manually adds an email address to the suppression list.
   */
  public async add(email: string, reason: SuppressionReason = 'manual_unsubscribe'): Promise<SuppressionRecord> {
    if (!email || !email.includes('@')) {
      throw new ValidationError('Valid email address is required');
    }
    return this.client.request<SuppressionRecord>('POST', '/v1/mail/suppressions', { email, reason });
  }

  /**
   * Removes an email from the suppression list to resume sending.
   */
  public async remove(email: string): Promise<{ success: boolean }> {
    if (!email || !email.includes('@')) {
      throw new ValidationError('Valid email address is required');
    }
    return this.client.request<{ success: boolean }>('DELETE', `/v1/mail/suppressions/${encodeURIComponent(email)}`);
  }
}

/**
 * Webhooks namespace for signature verification.
 */
export class WebhooksNamespace {
  /**
   * Verifies incoming webhook authenticity and freshness.
   */
  public verifySignature(options: WebhookVerifyOptions): boolean {
    return WebhookVerifier.verify(options);
  }
}

