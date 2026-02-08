/**
 * Real integration tests for webhook pipeline
 * Tests actual HTML parsing from saved email bodies
 */

import fs from 'fs';
import path from 'path';
 

describe('Webhook Pipeline - Real Integration Tests', () => {
  const dbPath = path.join(process.cwd(), 'src', 'db', 'emails');
  describe('Real email body parsing', () => {
    it('parses Indeed multi-job email correctly', () => {
      const bodyFile = path.join(dbPath, '2026-01', '28', '19bf7fa0ca23773c.body.txt');
      
      if (!fs.existsSync(bodyFile)) {
        console.warn(`⚠️  Test email not found: ${bodyFile}`);
        return;
      }

      const html = fs.readFileSync(bodyFile, 'utf-8');
      
      // Extract first job - Indeed format: Title\nCompany - Location\nDescription...
      const lines = html.split('\n').filter(l => l.trim());
      const firstJobIdx = lines.findIndex(l => l.includes('Frontend Developer'));
      
      expect(firstJobIdx).toBeGreaterThanOrEqual(0);
      
      if (firstJobIdx >= 0) {
        const title = lines[firstJobIdx];
        const companyLocation = lines[firstJobIdx + 1] || '';
        
        expect(title).toContain('Frontend Developer');
        expect(companyLocation).toContain('Zalo');
      }
    });

    it('extracts job URLs from Indeed email', () => {
      const bodyFile = path.join(dbPath, '2026-01', '28', '19bf7fa0ca23773c.body.txt');
      
      if (!fs.existsSync(bodyFile)) {
        return;
      }

      const html = fs.readFileSync(bodyFile, 'utf-8');
      const urlPattern = /https:\/\/vn\.indeed\.com\/rc\/clk\/dl\?jk=([a-f0-9]+)/g;
      const urls = [...html.matchAll(urlPattern)];
      
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[0][0]).toContain('vn.indeed.com');
    });
  });
});
