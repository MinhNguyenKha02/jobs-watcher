import { GmailService } from '../../src/services/gmail.js';

describe('GmailService (unit)', () => {
  it('extracts headers by name (case-insensitive)', () => {
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

  it('extracts body from text/html parts', () => {
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

  it('extracts body from nested parts', () => {
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

  it('extracts body from payload body when no parts exist', () => {
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
