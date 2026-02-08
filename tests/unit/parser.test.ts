import fs from 'fs';
import path from 'path';
import { EmailParser } from '../../src/services/parsers/email-parser.js';
import { 
  linkedinJobEmail, 
  indeedJobEmail, 
  vietnamworksJobEmail,
  topCVEmailAlert,
  indeedEmailAlert 
} from '../__fixtures__/emails';

const decodeBody = (payload: any) => {
  const data = payload.body?.data || '';
  return Buffer.from(data, 'base64').toString('utf-8');
};

function getFirstRawEmailEntry(): { metadata: any; body: string } | null {
  const baseDir = path.join(process.cwd(), 'src', 'db', 'emails');
  if (!fs.existsSync(baseDir)) return null;

  const monthDirs = fs.readdirSync(baseDir).filter(d => fs.statSync(path.join(baseDir, d)).isDirectory());
  if (monthDirs.length === 0) return null;

  const dayDir = monthDirs
    .map(month => ({
      month,
      days: fs.readdirSync(path.join(baseDir, month)).filter(d => fs.statSync(path.join(baseDir, month, d)).isDirectory()),
    }))
    .flatMap(entry => entry.days.map(day => path.join(baseDir, entry.month, day)))
    .find(Boolean);

  if (!dayDir) return null;

  const jsonlPath = path.join(dayDir, 'raw-emails.jsonl');
  if (!fs.existsSync(jsonlPath)) return null;

  const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  const metadata = JSON.parse(lines[0]);
  const bodyPath = path.join(dayDir, `${metadata.messageId}.body.txt`);
  if (!fs.existsSync(bodyPath)) return null;

  const body = fs.readFileSync(bodyPath, 'utf-8');
  return { metadata, body };
}

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

    it('parses real raw email from src/db when available', () => {
      const entry = getFirstRawEmailEntry();
      if (!entry) {
        return;
      }

      const result = parser.parse({
        emailId: entry.metadata.messageId || 'unknown',
        subject: entry.metadata.subject || '(no subject)',
        from: entry.metadata.from || '(unknown)',
        body: entry.body,
        receivedAt: new Date(entry.metadata.timestamp || Date.now()),
      });

      expect(result).not.toBeNull();
      expect(result?.position || result?.company || result?.description).toBeTruthy();
    });

    it('parses TopCV email alert with HTML', () => {
      const result = parser.parse(toInput(topCVEmailAlert));

      expect(result?.platform).toBe('TopCV');
      expect(result).not.toBeNull();
      expect(result?.position || result?.company || result?.description).toBeTruthy();
    });

    it('parses Indeed email alert with HTML', () => {
      const result = parser.parse(toInput(indeedEmailAlert));

      expect(result?.platform).toBe('Indeed');
      expect(result).not.toBeNull();
      expect(result?.position || result?.company || result?.description).toBeTruthy();
    });
  });

  // detectPlatform is covered indirectly via parse() tests
});
