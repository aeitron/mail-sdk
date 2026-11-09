const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const {
  AeitronMail,
  WebhookVerifier,
  AuthenticationError,
  ValidationError,
  RateLimitError,
  NotFoundError,
} = require('../dist/index.js');

describe('Aeitron Official Mail SDK Acceptance Tests', () => {
  let server;
  let serverUrl;
  let receivedRequests = [];
  let retryCount = 0;

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        const parsedBody = body ? JSON.parse(body) : null;
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: parsedBody,
        });

        // 1. Single email send
        if (req.url === '/v1/mail/send' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'email_live_001',
              from: parsedBody.from,
              to: parsedBody.to,
              status: 'queued',
              region: 'bd-dac',
              createdAt: new Date().toISOString(),
            })
          );
          return;
        }

        // 2. Batch email send
        if (req.url === '/v1/mail/batch' && req.method === 'POST') {
          const results = parsedBody.emails.map((em, idx) => ({
            id: `email_batch_${idx + 1}`,
            from: em.from,
            to: em.to,
            status: 'queued',
            region: 'bd-dac',
            createdAt: new Date().toISOString(),
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: results }));
          return;
        }

        // 3. Email get status
        if (req.url === '/v1/mail/emails/email_live_001' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'email_live_001',
              from: 'support@aeitron.com',
              to: ['customer@example.com'],
              subject: 'Your Invoice',
              status: 'delivered',
              events: [
                { type: 'queued', timestamp: new Date().toISOString(), region: 'bd-dac' },
                { type: 'delivered', timestamp: new Date().toISOString(), region: 'bd-dac' },
              ],
              createdAt: new Date().toISOString(),
            })
          );
          return;
        }

        // 4. Template send
        if (req.url === '/v1/mail/templates/tpl_welcome/send' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'email_tpl_999',
              from: parsedBody.from,
              to: parsedBody.to,
              status: 'queued',
              createdAt: new Date().toISOString(),
            })
          );
          return;
        }

        // 5. Suppressions
        if (req.url === '/v1/mail/suppressions' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              suppressions: [
                { id: 'sup_1', email: 'bounced@test.com', reason: 'hard_bounce', createdAt: new Date().toISOString() },
              ],
            })
          );
          return;
        }

        if (req.url === '/v1/mail/suppressions' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'sup_2',
              email: parsedBody.email,
              reason: parsedBody.reason,
              createdAt: new Date().toISOString(),
            })
          );
          return;
        }

        if (req.url.startsWith('/v1/mail/suppressions/') && req.method === 'DELETE') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // 6. Retry test simulation
        if (req.url === '/v1/mail/retry-test') {
          retryCount++;
          if (retryCount === 1) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
            res.end(JSON.stringify({ error: 'Rate limit exceeded', code: 'RATE_LIMITED' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', retriedSuccessfully: true }));
          return;
        }

        // 404 Fallback
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found', code: 'NOT_FOUND' }));
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(() => {
    server?.close();
  });

  test('Requirement MAIL.1: Client rejects missing or empty API keys', () => {
    assert.throws(() => new AeitronMail(''), AuthenticationError);
    assert.throws(() => new AeitronMail('   '), AuthenticationError);
    assert.doesNotThrow(() => new AeitronMail({ apiKey: 'amk_live_test_123', baseUrl: serverUrl }));
  });

  test('Requirement MAIL.2: Single email dispatch transmits headers and sovereign pinning', async () => {
    const mail = new AeitronMail({
      apiKey: 'amk_live_test_123',
      baseUrl: serverUrl,
      defaultFrom: 'support@aeitron.com',
    });

    const res = await mail.emails.send({
      to: 'founder@startup.io',
      subject: 'Welcome to Aeitron Sovereign Cloud',
      html: '<h1>Welcome</h1><p>Running from Dhaka Edge</p>',
      text: 'Welcome to Aeitron Sovereign Cloud',
      idempotencyKey: 'idem_mail_001',
      sovereignJurisdiction: 'BD',
    });

    assert.strictEqual(res.id, 'email_live_001');
    assert.strictEqual(res.status, 'queued');
    assert.strictEqual(res.region, 'bd-dac');

    const lastReq = receivedRequests.find((r) => r.url === '/v1/mail/send');
    assert.ok(lastReq);
    assert.strictEqual(lastReq.headers['authorization'], 'Bearer amk_live_test_123');
    assert.strictEqual(lastReq.headers['idempotency-key'], 'idem_mail_001');
    assert.strictEqual(lastReq.headers['x-sovereign-jurisdiction'], 'BD');
    assert.strictEqual(lastReq.body.from, 'support@aeitron.com');
  });

  test('Requirement MAIL.3: Validation errors thrown on missing recipient or subject', async () => {
    const mail = new AeitronMail({ apiKey: 'amk_live_test', baseUrl: serverUrl });

    await assert.rejects(
      () => mail.emails.send({ to: '', subject: 'Hi', html: 'test', from: 'a@b.com' }),
      ValidationError
    );
    await assert.rejects(
      () => mail.emails.send({ to: 'user@test.com', subject: '', html: 'test', from: 'a@b.com' }),
      ValidationError
    );
    await assert.rejects(
      () => mail.emails.send({ to: 'user@test.com', subject: 'Hi', from: 'a@b.com' }),
      ValidationError
    );
  });

  test('Requirement MAIL.4: Batch email dispatch handles up to 100 items atomically', async () => {
    const mail = new AeitronMail({
      apiKey: 'amk_live_test',
      baseUrl: serverUrl,
      defaultFrom: 'alerts@aeitron.com',
    });

    const res = await mail.emails.sendBatch([
      { to: 'user1@example.com', subject: 'Alert 1', text: 'Text 1' },
      { to: 'user2@example.com', subject: 'Alert 2', text: 'Text 2' },
    ]);

    assert.strictEqual(res.data.length, 2);
    assert.strictEqual(res.data[0].id, 'email_batch_1');
    assert.strictEqual(res.data[1].id, 'email_batch_2');
  });

  test('Requirement MAIL.5: Email status retrieval exposes delivery telemetry and events', async () => {
    const mail = new AeitronMail({ apiKey: 'amk_live_test', baseUrl: serverUrl });

    const email = await mail.emails.get('email_live_001');
    assert.strictEqual(email.id, 'email_live_001');
    assert.strictEqual(email.status, 'delivered');
    assert.strictEqual(email.events?.length, 2);
  });

  test('Requirement MAIL.6: Template rendering and direct template dispatch', async () => {
    const mail = new AeitronMail({
      apiKey: 'amk_live_test',
      baseUrl: serverUrl,
      defaultFrom: 'welcome@aeitron.com',
    });

    const res = await mail.templates.send({
      to: 'newuser@venture.org',
      templateId: 'tpl_welcome',
      variables: { name: 'Rahim', role: 'DevOps Lead' },
    });

    assert.strictEqual(res.id, 'email_tpl_999');
  });

  test('Requirement MAIL.7: Suppression management adds, lists, and removes records', async () => {
    const mail = new AeitronMail({ apiKey: 'amk_live_test', baseUrl: serverUrl });

    const list = await mail.suppressions.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].email, 'bounced@test.com');

    const added = await mail.suppressions.add('unsub@corp.com', 'manual_unsubscribe');
    assert.strictEqual(added.email, 'unsub@corp.com');

    const removed = await mail.suppressions.remove('unsub@corp.com');
    assert.strictEqual(removed.success, true);
  });

  test('Requirement MAIL.8: Enterprise Webhook HMAC-SHA256 signature verification', () => {
    const secret = 'whsec_enterprise_mail_secret_2026';
    const payload = JSON.stringify({ event: 'email.delivered', id: 'email_live_001' });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${timestamp}.${payload}`;
    const sig = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
    const header = `t=${timestamp},v1=${sig}`;

    // 1. Valid signature passes
    const isValid = WebhookVerifier.verify({ payload, header, secret, toleranceMs: 300000 });
    assert.strictEqual(isValid, true);

    // 2. Tampered payload fails
    const tamperedPayload = JSON.stringify({ event: 'email.delivered', id: 'email_HACKED' });
    const isTamperedValid = WebhookVerifier.verify({ payload: tamperedPayload, header, secret });
    assert.strictEqual(isTamperedValid, false);

    // 3. Expired timestamp fails
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 3600).toString();
    const oldSigned = `${oldTimestamp}.${payload}`;
    const oldSig = crypto.createHmac('sha256', secret).update(oldSigned, 'utf8').digest('hex');
    const oldHeader = `t=${oldTimestamp},v1=${oldSig}`;

    assert.throws(
      () => WebhookVerifier.verify({ payload, header: oldHeader, secret, toleranceMs: 300000 }),
      ValidationError
    );

    // 4. Wrong secret fails
    const isWrongSecretValid = WebhookVerifier.verify({ payload, header, secret: 'whsec_wrong_key' });
    assert.strictEqual(isWrongSecretValid, false);
  });

  test('Requirement MAIL.9: Automatic exponential backoff retries on HTTP 429 rate limits', async () => {
    const mail = new AeitronMail({
      apiKey: 'amk_live_test',
      baseUrl: serverUrl,
      maxRetries: 2,
    });

    const res = await mail.request('GET', '/v1/mail/retry-test');
    assert.strictEqual(res.retriedSuccessfully, true);
    assert.strictEqual(retryCount, 2);
  });

  test('Requirement MAIL.10: Typed errors map HTTP status codes correctly', async () => {
    const mail = new AeitronMail({ apiKey: 'amk_live_test', baseUrl: serverUrl });

    await assert.rejects(
      () => mail.request('GET', '/v1/mail/non-existent-endpoint'),
      NotFoundError
    );
  });
});
