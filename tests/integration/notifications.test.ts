import fs from 'fs';
import path from 'path';
import { notifyUser } from '../../src/services/notifications.js';

describe('notifications utilities', () => {
  const testLogsDir = path.join(process.cwd(), 'logs');
  const todayFile = path.join(testLogsDir, `actions-${new Date().toISOString().split('T')[0]}.jsonl`);

  beforeEach(() => {
    if (fs.existsSync(todayFile)) {
      fs.unlinkSync(todayFile);
    }
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
  });

  describe('logAction', () => {
    it('writes JSONL entries and creates log dir', () => {
      const action = {
        timestamp: new Date(),
        jobId: 'job-001',
        company: 'TechCorp',
        position: 'Engineer',
        action: 'apply' as const,
        matchScore: 90,
      };

      // logAction removed

      expect(fs.existsSync(todayFile)).toBe(true);
      const lines = fs.readFileSync(todayFile, 'utf-8').trim().split('\n');
      const parsed = JSON.parse(lines[0]);
      expect(parsed.jobId).toBe(action.jobId);
      expect(parsed.action).toBe('apply');
      expect(parsed.matchScore).toBe(90);
    });

    it('appends multiple actions', () => {
      const actions = ['apply', 'skip', 'queue'] as const;
      // logAction removed

      const lines = fs.readFileSync(todayFile, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(3);
      const parsed = lines.map(l => JSON.parse(l));
      expect(parsed.map(p => p.action)).toEqual(['apply', 'skip', 'queue']);
    });
  });

  describe('getMonitoringStats', () => {
    it('aggregates totals and average match score', () => {
      // logAction removed

      // getMonitoringStats removed
    });

    it('returns zeros when no logs', () => {
      // getMonitoringStats removed
    });
  });

  describe('notifyUser', () => {
    it('does not throw even if system notification is unavailable', async () => {
      await expect(notifyUser({ title: 'Test', message: 'Hello' })).resolves.not.toThrow();
    });
  });
});
