import { writeFileSync, readFileSync, unlinkSync, existsSync, openSync, closeSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { JobStage } from '../../../../src/domain/types/job-lifecycle.js';

const TEST_STATE_PATH = '/tmp/test-tui-state.json';
if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
process.env.TUI_SHARED_STATE_PATH = TEST_STATE_PATH;

vi.mock('node:fs', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    watch: vi.fn(() => ({ close: vi.fn() })),
  };
});

const {
  setCurrentJob,
  getCurrentJob,
  getQueueMode,
  setQueueMode,
  clearCurrentJob,
  resetState,
  setPreviewViewerModal,
  clearModal,
} = await import('../../../../src/presentation/tui/shared-tui-state.js');

function cleanState() {
  try {
    unlinkSync(TEST_STATE_PATH);
  } catch {}
  try {
    unlinkSync(TEST_STATE_PATH + '.lock');
  } catch {}
}

describe('shared-tui-state', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  describe('getCurrentJob / setCurrentJob', () => {
    it('GIVEN shared WHEN exercised THEN returns default state before any job is set', () => {
      const state = getCurrentJob();
      expect(state.jobLifecycleId).toBeNull();
      expect(state.job).toBeNull();
      expect(state.stage).toBeNull();
    });

    it('GIVEN shared WHEN exercised THEN sets and gets a job (S2)', () => {
      const job = { _id: 'job-1', company: 'Acme', role: 'Junior Engineer' } as any;
      setCurrentJob('job-1', job, JobStage.FULL_PARSED);

      const state = getCurrentJob();
      expect(state.jobLifecycleId).toBe('job-1');
      expect(state.job?.company).toBe('Acme');
      expect(state.stage).toBe(JobStage.FULL_PARSED);
    });

    it('GIVEN shared WHEN exercised THEN updates stage on second call with same ID (S2+S1)', () => {
      const job = { _id: 'job-1', company: 'Acme', role: 'Junior Engineer' } as any;
      setCurrentJob('job-1', job, JobStage.PARTIAL_PARSED);

      const enriched = { ...job, description: 'enriched full description' };
      setCurrentJob('job-1', enriched, JobStage.FULL_PARSED);

      const state = getCurrentJob();
      expect(state.stage).toBe(JobStage.FULL_PARSED);
      expect(state.job?.description).toBe('enriched full description');
    });

    it('GIVEN shared WHEN exercised THEN rejects overwrite for different job ID in queue mode (S2+S1)', () => {
      const job1 = { _id: 'job-1', company: 'Acme', role: 'Engineer' } as any;
      setCurrentJob('job-1', job1, JobStage.PARTIAL_PARSED);

      const job2 = { _id: 'job-2', company: 'Beta', role: 'Dev' } as any;
      setCurrentJob('job-2', job2, JobStage.FULL_PARSED);

      const state = getCurrentJob();
      expect(state.jobLifecycleId).toBe('job-1');
    });

    it('GIVEN shared WHEN exercised THEN allows overwrite for different job ID in direct mode (B17 — latest wins) (S2)', () => {
      setQueueMode(false);

      const job1 = { _id: 'direct-1', company: 'FirstCo', role: 'Role1' } as any;
      setCurrentJob('direct-1', job1, JobStage.FULL_PARSED);

      const state1 = getCurrentJob();
      expect(state1.jobLifecycleId).toBe('direct-1');

      const job2 = { _id: 'direct-2', company: 'SecondCo', role: 'Role2' } as any;
      setCurrentJob('direct-2', job2, JobStage.FULL_PARSED);

      const state2 = getCurrentJob();
      expect(state2.jobLifecycleId).toBe('direct-2');
      expect(state2.job?.company).toBe('SecondCo');

      setQueueMode(true);
    });
  });

  describe('queue mode toggle', () => {
    it('GIVEN shared WHEN exercised THEN defaults to queue mode true', () => {
      expect(getQueueMode()).toBe(true);
    });

    it('GIVEN shared WHEN exercised THEN toggles queue mode off and on', () => {
      setQueueMode(false);
      expect(getQueueMode()).toBe(false);
      setQueueMode(true);
      expect(getQueueMode()).toBe(true);
    });

    it('GIVEN shared WHEN exercised THEN maintains separate sub-states per mode (S2+S1)', () => {
      const jobQ = { _id: 'q-job', company: 'QueueCo', role: 'Engineer' } as any;
      setCurrentJob('q-job', jobQ, JobStage.PARTIAL_PARSED);
      expect(getCurrentJob().jobLifecycleId).toBe('q-job');

      setQueueMode(false);
      expect(getCurrentJob().jobLifecycleId).toBeNull();

      const jobD = { _id: 'd-job', company: 'DirectCo', role: 'Dev' } as any;
      setCurrentJob('d-job', jobD, JobStage.FULL_PARSED);
      expect(getCurrentJob().jobLifecycleId).toBe('d-job');

      setQueueMode(true);
      expect(getCurrentJob().jobLifecycleId).toBe('q-job');
    });
  });

  describe('clearCurrentJob', () => {
    it('GIVEN shared WHEN exercised THEN clears the active sub-state (S2)', () => {
      const job = { _id: 'job-clear', company: 'ClearCo', role: 'Engineer' } as any;
      setCurrentJob('job-clear', job, JobStage.FULL_PARSED);
      clearCurrentJob();

      const state = getCurrentJob();
      expect(state.jobLifecycleId).toBeNull();
      expect(state.job).toBeNull();
      expect(state.stage).toBeNull();
    });
  });

  describe('modal functions', () => {
    it('GIVEN shared WHEN exercised THEN setPreviewViewerModal shows modal (S2)', () => {
      const job = { _id: 'job-modal', company: 'ModalCo', role: 'Engineer' } as any;
      setCurrentJob('job-modal', job, JobStage.FULL_PARSED);
      setPreviewViewerModal('line1\nline2\nline3', 2);

      const state = getCurrentJob();
      expect(state.modal).not.toBeNull();
      expect(state.modal!.type).toBe('PREVIEW_VIEWER');
      expect(state.modal!.clipboardContent).toHaveLength(3);
    });

    it('GIVEN shared WHEN exercised THEN clearModal removes modal (S2)', () => {
      const job = { _id: 'job-modal', company: 'ModalCo', role: 'Engineer' } as any;
      setCurrentJob('job-modal', job, JobStage.FULL_PARSED);
      setPreviewViewerModal('content', 5);
      expect(getCurrentJob().modal).not.toBeNull();

      clearModal();
      expect(getCurrentJob().modal).toBeNull();
    });
  });

  describe('file persistence', () => {
    it('GIVEN shared WHEN exercised THEN writes state file on setCurrentJob (verify on disk) (S2)', () => {
      const job = { _id: 'job-disk', company: 'DiskCo', role: 'Engineer' } as any;
      setCurrentJob('job-disk', job, JobStage.FULL_PARSED);

      const raw = readFileSync(TEST_STATE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.queue.jobLifecycleId).toBe('job-disk');
    });

    it('GIVEN shared WHEN exercised THEN reads existing state file on getCurrentJob (S2)', () => {
      writeFileSync(
        TEST_STATE_PATH,
        JSON.stringify({
          version: 2,
          queueMode: true,
          updatedAt: null,
          queue: {
            jobLifecycleId: 'file-job',
            job: { _id: 'file-job', company: 'FileCo' },
            stage: 'full_parsed',
            editedFields: null,
            modal: null,
          },
          direct: { jobLifecycleId: null, job: null, stage: null, editedFields: null, modal: null },
        }),
        'utf8'
      );

      const state = getCurrentJob();
      expect(state.jobLifecycleId).toBe('file-job');
      expect(state.job?.company).toBe('FileCo');
    });
  });

  describe('flock exclusive lock', () => {
    it('GIVEN shared WHEN exercised THEN creates lock file before write and removes it after (S2)', () => {
      const lockPath = TEST_STATE_PATH + '.lock';
      const job = { _id: 'job-lock', company: 'LockCo', role: 'Engineer' } as any;
      setCurrentJob('job-lock', job, JobStage.FULL_PARSED);

      expect(existsSync(lockPath)).toBe(false);
      expect(existsSync(TEST_STATE_PATH)).toBe(true);
    });

    it('GIVEN shared WHEN exercised THEN lock acquisition blocks concurrent writes (S2)', () => {
      const lockPath = TEST_STATE_PATH + '.lock';

      const fd = openSync(lockPath, 'wx');
      closeSync(fd);

      const job = { _id: 'job-blocked', company: 'BlockedCo', role: 'Engineer' } as any;
      expect(() => setCurrentJob('job-blocked', job, JobStage.FULL_PARSED)).toThrow(
        'Could not acquire lock'
      );

      const state = getCurrentJob();
      expect(state.jobLifecycleId).toBeNull();
      expect(state.job).toBeNull();

      unlinkSync(lockPath);
    });

    it('GIVEN shared WHEN exercised THEN recovers after lock is released (S2)', () => {
      const lockPath = TEST_STATE_PATH + '.lock';

      const fd = openSync(lockPath, 'wx');
      closeSync(fd);

      const job = { _id: 'job-blocked', company: 'BlockedCo', role: 'Engineer' } as any;
      expect(() => setCurrentJob('job-blocked', job, JobStage.FULL_PARSED)).toThrow(
        'Could not acquire lock'
      );

      const state = getCurrentJob();
      expect(state.jobLifecycleId).toBeNull();

      unlinkSync(lockPath);

      setCurrentJob('job-blocked', job, JobStage.FULL_PARSED);
      const state2 = getCurrentJob();
      expect(state2.jobLifecycleId).toBe('job-blocked');
    });
  });
});
