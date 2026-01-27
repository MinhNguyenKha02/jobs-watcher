import { EmailParser } from '../../src/services/parser';
import { linkedinJobEmail, indeedJobEmail, vietnamworksJobEmail } from '../__fixtures__/emails';

const decodeBody = (payload: any) => {
  const data = payload.body?.data || '';
  return Buffer.from(data, 'base64').toString('utf-8');
};

describe('EmailParser', () => {
  let parser: EmailParser;

  beforeEach(() => {
    parser = new EmailParser();
  });

  const toInput = (fixture: any) => ({
    emailId: fixture.id,
    subject: fixture.payload.headers.find((h: any) => h.name === 'Subject')?.value || '',
    from: fixture.payload.headers.find((h: any) => h.name === 'From')?.value || '',
    body: decodeBody(fixture.payload),
    receivedAt: new Date(),
  });

  describe('parse', () => {
    it('parses LinkedIn job email', () => {
      const result = parser.parse(toInput(linkedinJobEmail));

      expect(result?.platform).toBe('LinkedIn');
      expect(result?.company).toContain('TechCorp');
      expect(result?.position).toContain('Senior Software Engineer');
      expect(result?.location).toContain('Ho Chi Minh City');
      expect(result?.description).toBeTruthy();
    });

    it('parses Indeed job email', () => {
      const result = parser.parse(toInput(indeedJobEmail));

      expect(result?.platform).toBe('Indeed');
      expect(result?.position).toContain('Backend Developer');
      expect(result?.description).toBeTruthy();
    });

    it('parses VietnamWorks job email', () => {
      const result = parser.parse(toInput(vietnamworksJobEmail));

      expect(result?.platform).toBe('VietnamWorks');
      expect(result?.position).toBeTruthy();
      expect(result?.description).toBeTruthy();
    });

    it('handles unknown platform', () => {
      const input = toInput(linkedinJobEmail);
      input.from = 'random@example.com';
      input.body = input.body.replace(/linkedin/gi, 'randomtext');
      const result = parser.parse(input);
      expect(result).not.toBeNull();
      expect(result?.platform).toBe('Unknown');
    });
  });

  describe('detectPlatform', () => {
    it('detects LinkedIn', () => {
      const platform = (parser as any).detectPlatform('jobs@linkedin.com', '');
      expect(platform).toBe('LinkedIn');
    });

    it('detects Indeed', () => {
      const platform = (parser as any).detectPlatform('alerts@indeed.com', '');
      expect(platform).toBe('Indeed');
    });

    it('falls back to Unknown', () => {
      const platform = (parser as any).detectPlatform('user@example.com', '');
      expect(platform).toBe('Unknown');
    });
  });
});
