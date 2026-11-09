/**
 * Base error for the Aeitron Mail SDK.
 */
export class MailError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly requestId?: string;

  constructor(message: string, status?: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'MailError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends MailError {
  constructor(message: string, status = 401, code = 'UNAUTHORIZED', requestId?: string) {
    super(message, status, code, requestId);
    this.name = 'AuthenticationError';
  }
}

export class PermissionDeniedError extends MailError {
  constructor(message: string, status = 403, code = 'FORBIDDEN', requestId?: string) {
    super(message, status, code, requestId);
    this.name = 'PermissionDeniedError';
  }
}

export class NotFoundError extends MailError {
  constructor(message: string, status = 404, code = 'NOT_FOUND', requestId?: string) {
    super(message, status, code, requestId);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends MailError {
  constructor(message: string, status = 422, code = 'VALIDATION_ERROR', requestId?: string) {
    super(message, status, code, requestId);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends MailError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number, status = 429, code = 'RATE_LIMITED', requestId?: string) {
    super(message, status, code, requestId);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class DeliveryError extends MailError {
  constructor(message: string, status = 502, code = 'DELIVERY_FAILED', requestId?: string) {
    super(message, status, code, requestId);
    this.name = 'DeliveryError';
  }
}

export class ServerError extends MailError {
  constructor(message: string, status = 500, code = 'SERVER_ERROR', requestId?: string) {
    super(message, status, code, requestId);
    this.name = 'ServerError';
  }
}

