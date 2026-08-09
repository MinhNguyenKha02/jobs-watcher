import { GmailService } from '../../../../src/infrastructure/outbound/gmail.js';

// Pure message-deserialization cases migrated from the removed tests/unit/adapter/
// contract layer (no mocks, no network). Adapter↔port conformance for Gmail lives in
// tests/integration/adapter/inbound/webhook-adapter-contract.contract.integration.test.ts.
describe('Gmail message parsing (pure)', () => {
  it('GIVEN a message with headers WHEN extracting by name THEN returns case-insensitive value', () => {
    const service = new GmailService({});
    const message = {
      payload: {
        headers: [
          { name: 'Subject', value: 'Job Alert: Backend Engineer' },
          { name: 'From', value: 'jobs@linkedin.com' },
        ],
      },
    };

    expect(service.extractHeader(message, 'Subject')).toBe('Job Alert: Backend Engineer');
    expect(service.extractHeader(message, 'subject')).toBe('Job Alert: Backend Engineer');
    expect(service.extractHeader(message, 'From')).toBe('jobs@linkedin.com');
  });

  it('GIVEN a message with text/html part WHEN extracting body THEN returns decoded html', () => {
    const service = new GmailService({});
    const html = '<html><body>Test</body></html>';
    const encoded = Buffer.from(html, 'utf-8').toString('base64');

    const message = {
      payload: {
        parts: [
          { mimeType: 'text/plain', body: { data: '' } },
          { mimeType: 'text/html', body: { data: encoded } },
        ],
      },
    };

    const body = service.extractBody(message);
    expect(body).toContain('Test');
  });

  it('GIVEN a message with nested multipart parts WHEN extracting body THEN decodes inner part', () => {
    const service = new GmailService({});
    const nested = Buffer.from('Nested Body', 'utf-8').toString('base64');

    const message = {
      payload: {
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: nested } },
            ],
          },
        ],
      },
    };

    const body = service.extractBody(message);
    expect(body).toContain('Nested Body');
  });

  it('GIVEN a message with top-level body WHEN extracting body THEN returns decoded payload', () => {
    const service = new GmailService({});
    const raw = Buffer.from('Raw Body', 'utf-8').toString('base64');

    const message = {
      payload: {
        body: { data: raw },
      },
    };

    const body = service.extractBody(message);
    expect(body).toBe('Raw Body');
  });
});