import * as crypto from 'node:crypto';
import { ValidationError } from './errors.js';

export interface WebhookVerifyOptions {
  payload: string | Buffer;
  header: string;
  secret: string;
  toleranceMs?: number; // Default 5 minutes
}

export class WebhookVerifier {
  /**
   * Cryptographically verifies incoming Aeitron Mail webhook signatures.
   * Prevents replay attacks and payload tampering via HMAC-SHA256 constant-time verification.
   */
  public static verify(options: WebhookVerifyOptions): boolean {
    const { payload, header, secret, toleranceMs = 300000 } = options;

    if (!secret || !secret.trim()) {
      throw new ValidationError('Webhook secret is required');
    }
    if (!header || !header.trim()) {
      throw new ValidationError('Missing Aeitron-Signature header');
    }

    const parts = header.split(',');
    let timestampStr = '';
    const signatures: string[] = [];

    for (const part of parts) {
      const [key, val] = part.trim().split('=');
      if (key === 't') {
        timestampStr = val;
      } else if (key === 'v1') {
        signatures.push(val);
      }
    }

    if (!timestampStr || signatures.length === 0) {
      throw new ValidationError('Malformed Aeitron-Signature header (expected t=...,v1=...)');
    }

    const timestampSec = parseInt(timestampStr, 10);
    if (isNaN(timestampSec)) {
      throw new ValidationError('Invalid timestamp integer in signature header');
    }

    const eventTimeMs = timestampSec * 1000;
    const nowMs = Date.now();
    const age = Math.abs(nowMs - eventTimeMs);

    if (toleranceMs > 0 && age > toleranceMs) {
      throw new ValidationError(`Webhook timestamp expired (age ${age}ms exceeds tolerance ${toleranceMs}ms)`);
    }

    const rawPayload = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
    const signedPayload = `${timestampStr}.${rawPayload}`;

    const hmac = crypto.createHmac('sha256', secret.trim());
    hmac.update(signedPayload, 'utf8');
    const expectedSig = hmac.digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'hex');

    for (const sig of signatures) {
      try {
        const sigBuf = Buffer.from(sig, 'hex');
        if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
          return true;
        }
      } catch {
        // Continue checking other signatures
      }
    }

    return false;
  }
}

