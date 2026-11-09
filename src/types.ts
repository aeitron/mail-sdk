/**
 * Sovereign geopolitical jurisdiction boundary pinning.
 */
export type SovereignJurisdiction = 'BD' | 'EU' | 'US' | 'GLOBAL';

/**
 * An email attachment.
 */
export interface Attachment {
  filename: string;
  content: string; // Base64 encoded or raw string
  contentType?: string;
}

/**
 * Options for sending an individual email.
 */
export interface CreateEmailOptions {
  to: string | string[];
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  tags?: Record<string, string>;
  headers?: Record<string, string>;
  attachments?: Attachment[];
  idempotencyKey?: string;
  sovereignJurisdiction?: SovereignJurisdiction;
}

/**
 * Response payload returned upon successfully dispatching an email.
 */
export interface CreateEmailResponse {
  id: string;
  from: string;
  to: string[];
  status: 'queued' | 'delivered' | 'failed';
  region?: string;
  createdAt: string;
}

/**
 * Response payload for batch email dispatch.
 */
export interface BatchEmailResponse {
  data: CreateEmailResponse[];
}

/**
 * Telemetry and lifecycle record for a sent email.
 */
export interface EmailRecord {
  id: string;
  from: string;
  to: string[];
  subject: string;
  status: 'queued' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'failed';
  events?: Array<{
    type: string;
    timestamp: string;
    region?: string;
    details?: string;
  }>;
  createdAt: string;
}

/**
 * Options for sending an email via a registered template.
 */
export interface SendTemplateOptions {
  to: string | string[];
  from?: string;
  templateId: string;
  variables: Record<string, any>;
  subject?: string;
  replyTo?: string | string[];
  tags?: Record<string, string>;
  sovereignJurisdiction?: SovereignJurisdiction;
}

/**
 * Suppression reason for unsubscribed or failing recipients.
 */
export type SuppressionReason = 'hard_bounce' | 'spam_complaint' | 'manual_unsubscribe';

/**
 * Suppression list entry.
 */
export interface SuppressionRecord {
  id: string;
  email: string;
  reason: SuppressionReason;
  createdAt: string;
}

/**
 * Configuration options for the AeitronMail client.
 */
export interface MailClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  defaultFrom?: string;
  apiVersion?: string;
}

