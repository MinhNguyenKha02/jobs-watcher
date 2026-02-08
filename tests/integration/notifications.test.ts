import fs from 'fs';
import path from 'path';
import { logAction, getMonitoringStats, notifyUser } from '../../src/services/notifications';

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

      logAction(action);

      expect(fs.existsSync(todayFile)).toBe(true);
      const lines = fs.readFileSync(todayFile, 'utf-8').trim().split('\n');
      const parsed = JSON.parse(lines[0]);
      expect(parsed.jobId).toBe(action.jobId);
      expect(parsed.action).toBe('apply');
      expect(parsed.matchScore).toBe(90);
    });

    it('appends multiple actions', () => {
      const actions = ['apply', 'skip', 'queue'] as const;
      actions.forEach((a, idx) => logAction({
        timestamp: new Date(),
        jobId: `job-${idx}`,
        company: 'ACME',
        position: 'Dev',
        action: a,
        matchScore: 50 + idx,
      }));

      const lines = fs.readFileSync(todayFile, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(3);
      const parsed = lines.map(l => JSON.parse(l));
      expect(parsed.map(p => p.action)).toEqual(['apply', 'skip', 'queue']);
    });
  });

  describe('getMonitoringStats', () => {
    it('aggregates totals and average match score', () => {
      logAction({ timestamp: new Date(), jobId: '1', company: 'A', position: 'P', action: 'apply', matchScore: 80 });
      logAction({ timestamp: new Date(), jobId: '2', company: 'B', position: 'P', action: 'skip', matchScore: 40 });
      logAction({ timestamp: new Date(), jobId: '3', company: 'C', position: 'P', action: 'queue', matchScore: 60 });

      const stats = getMonitoringStats();
      expect(stats.totalProcessed).toBe(3);
      expect(stats.applied).toBe(1);
      expect(stats.skipped).toBe(1);
      expect(stats.queued).toBe(1);
      expect(stats.averageMatchScore).toBe(60);
    });

    it('returns zeros when no logs', () => {
      const stats = getMonitoringStats();
      expect(stats.totalProcessed).toBe(0);
      expect(stats.averageMatchScore).toBe(0);
    });
  });

  describe('notifyUser', () => {
    it('does not throw even if system notification is unavailable', async () => {
      await expect(notifyUser({ title: 'Test', message: 'Hello' })).resolves.not.toThrow();
    });
  });
});
