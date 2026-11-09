# Aeitron Official Mail SDK (`@aeitron/mail`)

[![npm version](https://img.shields.io/npm/v/@aeitron/mail.svg)](https://www.npmjs.com/package/@aeitron/mail)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official, zero-dependency TypeScript & JavaScript client library for **Aeitron Mail**, transactional email infrastructure, sovereign delivery, and enterprise webhook verification.

---

## Features

- **Zero External Runtime Dependencies:** Built strictly using modern Web standard APIs (`fetch`, `crypto`).
- **Sovereign Geopolitical Delivery:** Pin email dispatch and logs to specific regions (`BD`, `EU`, `US`, `GLOBAL`).
- **Single & Batch Dispatch:** Send individual emails or batch up to 100 messages in a single atomic request.
- **Dynamic Templates:** Render templates with server-side variable interpolation and direct dispatch.
- **Suppression Management:** Automatically and manually handle unsubscribes, spam complaints, and hard bounces.
- **Enterprise Webhook Verification:** Constant-time HMAC-SHA256 signature verification with anti-replay timestamp tolerance.
- **Resilient Reliability:** Automatic exponential backoff with jitter on HTTP 429 rate limits and 5xx transient gateway errors.
- **Strictly Typed:** Full TypeScript declaration maps (`.d.ts`) included out of the box.

---

## Installation

```bash
npm install @aeitron/mail
# or
pnpm add @aeitron/mail
```

---

## Quickstart

### 1. Send an Email

```typescript
import { AeitronMail } from '@aeitron/mail';

const mail = new AeitronMail({
  apiKey: process.env.AEITRON_MAIL_API_KEY, // or amk_live_...
  defaultFrom: 'Aeitron Cloud <noreply@aeitron.com>',
});

async function sendWelcomeEmail() {
  const response = await mail.emails.send({
    to: 'founder@startup.io',
    subject: 'Welcome to Aeitron Sovereign Cloud',
    html: '<h1>Welcome!</h1><p>Your cluster is now online in Dhaka.</p>',
    text: 'Welcome! Your cluster is now online in Dhaka.',
    sovereignJurisdiction: 'BD', // Strictly pinned to Dhaka Sovereign Edge
    idempotencyKey: 'idem_welcome_123',
  });

  console.log(`Email queued with ID: ${response.id} in region: ${response.region}`);
}
```

---

### 2. Verify Inbound Webhooks

Verify incoming bounce, delivery, or open tracking webhooks with HMAC-SHA256:

```typescript
import { WebhookVerifier } from '@aeitron/mail';

app.post('/api/webhooks/mail', (req, res) => {
  const signature = req.headers['aeitron-signature'];
  const rawBody = req.rawBody; // Raw payload string or Buffer

  const isValid = WebhookVerifier.verify({
    payload: rawBody,
    header: signature,
    secret: process.env.AEITRON_WEBHOOK_SECRET,
    toleranceMs: 300000, // 5-minute replay tolerance window
  });

  if (!isValid) {
    return res.status(401).send('Unauthorized webhook signature');
  }

  // Process event safely
  res.status(200).send('OK');
});
```

---

## Testing

```bash
npm test
```

