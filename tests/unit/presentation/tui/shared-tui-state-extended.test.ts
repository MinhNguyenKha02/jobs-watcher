import { unlinkSync, existsSync, writeFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { JobStage } from '../../../../src/domain/types/job-lifecycle.js';

const TEST_STATE_PATH = '/tmp/test-tui-state-ext.json';
if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
try {
  unlinkSync(TEST_STATE_PATH + '.lock');
} catch {}
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

describe('shared-tui-state extended: mode toggle mid-job', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('GIVEN shared WHEN exercised THEN mode toggle clears active display (different substate per mode) (S1)', () => {
    const job = { _id: 'job-q', company: 'QueueCo', role: 'Engineer' } as any;
    setCurrentJob('job-q', job, JobStage.PARTIAL_PARSED);
    expect(getCurrentJob().jobLifecycleId).toBe('job-q');

    setQueueMode(false);
    expect(getCurrentJob().jobLifecycleId).toBeNull();
    expect(getCurrentJob().job).toBeNull();

    setQueueMode(true);
    expect(getCurrentJob().jobLifecycleId).toBe('job-q');
  });

  it('GIVEN toggling back and forth WHEN exercised THEN direct mode job preserved (S2+S1)', () => {
    setQueueMode(false);
    const directJob = { _id: 'job-d', company: 'DirectCo', role: 'Dev' } as any;
    setCurrentJob('job-d', directJob, JobStage.FULL_PARSED);
    expect(getCurrentJob().jobLifecycleId).toBe('job-d');

    setQueueMode(true);
    expect(getCurrentJob().jobLifecycleId).toBeNull();

    const queueJob = { _id: 'job-q2', company: 'QueueCo2', role: 'Engineer' } as any;
    setCurrentJob('job-q2', queueJob, JobStage.PARTIAL_PARSED);

    setQueueMode(false);
    expect(getCurrentJob().jobLifecycleId).toBe('job-d');
    expect(getCurrentJob().job?.company).toBe('DirectCo');
  });

  it('GIVEN shared WHEN exercised THEN can set different job in direct mode after toggle (S2)', () => {
    setQueueMode(false);
    const job1 = { _id: 'job-d1', company: 'D1', role: 'Dev' } as any;
    setCurrentJob('job-d1', job1, JobStage.FULL_PARSED);

    setQueueMode(true);
    setCurrentJob('job-d1', job1, JobStage.FULL_PARSED);
    expect(getCurrentJob().jobLifecycleId).toBe('job-d1');
  });

  it('GIVEN shared WHEN exercised THEN clearCurrentJob only clears active mode (S2+S1)', () => {
    setQueueMode(false);
    const directJob = { _id: 'job-clear-d', company: 'DC', role: 'Dev' } as any;
    setCurrentJob('job-clear-d', directJob, JobStage.FULL_PARSED);

    setQueueMode(true);
    const queueJob = { _id: 'job-clear-q', company: 'QC', role: 'Engineer' } as any;
    setCurrentJob('job-clear-q', queueJob, JobStage.PARTIAL_PARSED);

    clearCurrentJob();
    expect(getCurrentJob().jobLifecycleId).toBeNull();

    setQueueMode(false);
    expect(getCurrentJob().jobLifecycleId).toBe('job-clear-d');
  });
});

describe('shared-tui-state extended: setCurrentJob guard', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('GIVEN shared WHEN exercised THEN rejects overwrite with different job ID in queue mode (S2+S1)', () => {
    const job1 = { _id: 'job-a', company: 'ACo', role: 'Engineer' } as any;
    setCurrentJob('job-a', job1, JobStage.PARTIAL_PARSED);

    const job2 = { _id: 'job-b', company: 'BCo', role: 'Dev' } as any;
    setCurrentJob('job-b', job2, JobStage.FULL_PARSED);

    const state = getCurrentJob();
    expect(state.jobLifecycleId).toBe('job-a');
    expect(state.job?.company).toBe('ACo');
  });

  it('GIVEN shared WHEN exercised THEN allows overwrite with same job ID (enrichment) (S2+S1)', () => {
    const job1 = { _id: 'job-same', company: 'Co', role: 'Engineer' } as any;
    setCurrentJob('job-same', job1, JobStage.PARTIAL_PARSED);

    const job2 = { ...job1, role: 'Senior Engineer', description: 'enriched description' };
    setCurrentJob('job-same', job2, JobStage.FULL_PARSED);

    const state = getCurrentJob();
    expect(state.jobLifecycleId).toBe('job-same');
    expect(state.stage).toBe(JobStage.FULL_PARSED);
    expect(state.job?.role).toBe('Senior Engineer');
    expect(state.job?.description).toBe('enriched description');
  });

  it('GIVEN shared WHEN exercised THEN allows latest-wins overwrite with different job ID in direct mode (B17) (S2)', () => {
    setQueueMode(false);

    const job1 = { _id: 'job-x', company: 'XCo', role: 'Dev' } as any;
    setCurrentJob('job-x', job1, JobStage.FULL_PARSED);

    const job2 = { _id: 'job-y', company: 'YCo', role: 'Senior' } as any;
    setCurrentJob('job-y', job2, JobStage.FULL_PARSED);

    expect(getCurrentJob().jobLifecycleId).toBe('job-y');
  });
});

describe('shared-tui-state extended: modal interaction', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('GIVEN shared WHEN exercised THEN modal is cleared by clearCurrentJob (S2)', () => {
    const job = { _id: 'job-modal', company: 'Co', role: 'Engineer' } as any;
    setCurrentJob('job-modal', job, JobStage.FULL_PARSED);
    setPreviewViewerModal('line1\nline2', 2);
    expect(getCurrentJob().modal).not.toBeNull();

    clearCurrentJob();
    expect(getCurrentJob().modal).toBeNull();
  });

  it('GIVEN new job replaces current in queue mode WHEN exercised THEN modal is cleared (S2+S1)', () => {
    const job1 = { _id: 'job-m1', company: 'C1', role: 'Engineer' } as any;
    setCurrentJob('job-m1', job1, JobStage.PARTIAL_PARSED);
    setPreviewViewerModal('preview content', 10);
    expect(getCurrentJob().modal).not.toBeNull();

    setCurrentJob('job-m1', { ...job1, matchScore: 90 }, JobStage.FULL_PARSED);
    expect(getCurrentJob().modal).toBeNull();
  });

  it('GIVEN shared WHEN exercised THEN modal survives mode toggle? (direct mode has own substate) (S1)', () => {
    setCurrentJob(
      'job-modalq',
      { _id: 'job-modalq', company: 'Q' } as any,
      JobStage.PARTIAL_PARSED
    );
    setPreviewViewerModal('queue modal', 5);
    expect(getCurrentJob().modal).not.toBeNull();

    setQueueMode(false);
    expect(getCurrentJob().modal).toBeNull();
  });

  it('GIVEN shared WHEN exercised THEN clearModal removes modal without affecting job (S2)', () => {
    const job = { _id: 'job-cm', company: 'Co', role: 'Engineer' } as any;
    setCurrentJob('job-cm', job, JobStage.FULL_PARSED);
    setPreviewViewerModal('content', 5);
    expect(getCurrentJob().modal).not.toBeNull();

    clearModal();
    expect(getCurrentJob().modal).toBeNull();
    expect(getCurrentJob().jobLifecycleId).toBe('job-cm');
  });
});

describe('shared-tui-state extended: file persistence edge cases', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('GIVEN shared WHEN exercised THEN recovers from corrupt state file', () => {
    writeFileSync(TEST_STATE_PATH, 'not valid json', 'utf8');

    const state = getCurrentJob();
    expect(state.jobLifecycleId).toBeNull();
    expect(state.version).toBe(2);
  });

  it('GIVEN shared WHEN exercised THEN v1 migration with messageId converts to v2 queue sub-state (S1)', () => {
    writeFileSync(
      TEST_STATE_PATH,
      JSON.stringify({
        version: 1,
        messageId: 'v1-msg-id',
        job: { _id: 'v1-msg-id', company: 'V1Co', role: 'V1' },
        stage: 'partial_parsed',
        editedFields: null,
        updatedAt: '2025-01-01T00:00:00.000Z',
      }),
      'utf8'
    );

    const state = getCurrentJob();
    expect(state.version).toBe(2);
    expect(state.jobLifecycleId).toBe('v1-msg-id');
    expect(state.job?.company).toBe('V1Co');
    expect(state.stage).toBe(JobStage.PARTIAL_PARSED);
  });
});
