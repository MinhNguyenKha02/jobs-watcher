import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, writeFileSync, readFileSync } from 'node:fs';

const TEST_STATE_PATH = '/tmp/test-tui-state-ext.json';
if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
try { unlinkSync(TEST_STATE_PATH + '.lock'); } catch {}
process.env.TUI_SHARED_STATE_PATH = TEST_STATE_PATH;

vi.mock('node:fs', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    watch: vi.fn(() => ({ close: vi.fn() })),
  };
});

const {
  setCurrentJob, getCurrentJob, getQueueMode, setQueueMode,
  clearCurrentJob, resetState, setPreviewViewerModal, clearModal,
} = await import('../../../src/presentation/tui/shared-tui-state.js' );

function cleanState() {
  try { unlinkSync(TEST_STATE_PATH); } catch {}
  try { unlinkSync(TEST_STATE_PATH + '.lock'); } catch {}
}

describe('shared-tui-state extended: mode toggle mid-job', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('mode toggle clears active display (different substate per mode)', () => {
    const job = { _id: 'job-q', company: 'QueueCo', role: 'Engineer' } as any;
    setCurrentJob('job-q', job, 'PARTIAL');
    expect(getCurrentJob().joblifecycleId).toBe('job-q');

    setQueueMode(false);
    expect(getCurrentJob().joblifecycleId).toBeNull();
    expect(getCurrentJob().job).toBeNull();

    setQueueMode(true);
    expect(getCurrentJob().joblifecycleId).toBe('job-q');
  });

  it('direct mode job preserved when toggling back and forth', () => {
    setQueueMode(false);
    const directJob = { _id: 'job-d', company: 'DirectCo', role: 'Dev' } as any;
    setCurrentJob('job-d', directJob, 'FULL_PARSED');
    expect(getCurrentJob().joblifecycleId).toBe('job-d');

    setQueueMode(true);
    expect(getCurrentJob().joblifecycleId).toBeNull();

    const queueJob = { _id: 'job-q2', company: 'QueueCo2', role: 'Engineer' } as any;
    setCurrentJob('job-q2', queueJob, 'PARTIAL');

    setQueueMode(false);
    expect(getCurrentJob().joblifecycleId).toBe('job-d');
    expect(getCurrentJob().job?.company).toBe('DirectCo');
  });

  it('can set different job in direct mode after toggle', () => {
    setQueueMode(false);
    const job1 = { _id: 'job-d1', company: 'D1', role: 'Dev' } as any;
    setCurrentJob('job-d1', job1, 'FULL_PARSED');

    setQueueMode(true);
    setCurrentJob('job-d1', job1, 'FULL_PARSED');
    expect(getCurrentJob().joblifecycleId).toBe('job-d1');
  });

  it('clearCurrentJob only clears active mode', () => {
    setQueueMode(false);
    const directJob = { _id: 'job-clear-d', company: 'DC', role: 'Dev' } as any;
    setCurrentJob('job-clear-d', directJob, 'FULL_PARSED');

    setQueueMode(true);
    const queueJob = { _id: 'job-clear-q', company: 'QC', role: 'Engineer' } as any;
    setCurrentJob('job-clear-q', queueJob, 'PARTIAL');

    clearCurrentJob();
    expect(getCurrentJob().joblifecycleId).toBeNull();

    setQueueMode(false);
    expect(getCurrentJob().joblifecycleId).toBe('job-clear-d');
  });
});

describe('shared-tui-state extended: setCurrentJob guard', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('rejects overwrite with different job ID in queue mode', () => {
    const job1 = { _id: 'job-a', company: 'ACo', role: 'Engineer' } as any;
    setCurrentJob('job-a', job1, 'PARTIAL');

    const job2 = { _id: 'job-b', company: 'BCo', role: 'Dev' } as any;
    setCurrentJob('job-b', job2, 'FULL_PARSED');

    const state = getCurrentJob();
    expect(state.joblifecycleId).toBe('job-a');
    expect(state.job?.company).toBe('ACo');
  });

  it('allows overwrite with same job ID (enrichment)', () => {
    const job1 = { _id: 'job-same', company: 'Co', role: 'Engineer' } as any;
    setCurrentJob('job-same', job1, 'PARTIAL');

    const job2 = { ...job1, role: 'Senior Engineer', matchScore: 90 };
    setCurrentJob('job-same', job2, 'FULL_PARSED');

    const state = getCurrentJob();
    expect(state.joblifecycleId).toBe('job-same');
    expect(state.stage).toBe('FULL_PARSED');
    expect(state.job?.role).toBe('Senior Engineer');
    expect(state.job?.matchScore).toBe(90);
  });

  it('allows latest-wins overwrite with different job ID in direct mode (B17)', () => {
    setQueueMode(false);

    const job1 = { _id: 'job-x', company: 'XCo', role: 'Dev' } as any;
    setCurrentJob('job-x', job1, 'FULL_PARSED');

    const job2 = { _id: 'job-y', company: 'YCo', role: 'Senior' } as any;
    setCurrentJob('job-y', job2, 'FULL_PARSED');

    expect(getCurrentJob().joblifecycleId).toBe('job-y');
  });
});

describe('shared-tui-state extended: modal interaction', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('modal is cleared by clearCurrentJob', () => {
    const job = { _id: 'job-modal', company: 'Co', role: 'Engineer' } as any;
    setCurrentJob('job-modal', job, 'FULL_PARSED');
    setPreviewViewerModal('line1\nline2', 2);
    expect(getCurrentJob().modal).not.toBeNull();

    clearCurrentJob();
    expect(getCurrentJob().modal).toBeNull();
  });

  it('modal is cleared when new job replaces current in queue mode', () => {
    const job1 = { _id: 'job-m1', company: 'C1', role: 'Engineer' } as any;
    setCurrentJob('job-m1', job1, 'PARTIAL');
    setPreviewViewerModal('preview content', 10);
    expect(getCurrentJob().modal).not.toBeNull();

    setCurrentJob('job-m1', { ...job1, matchScore: 90 }, 'FULL_PARSED');
    expect(getCurrentJob().modal).toBeNull();
  });

  it('modal survives mode toggle? (direct mode has own substate)', () => {
    setCurrentJob('job-modalq', { _id: 'job-modalq', company: 'Q' } as any, 'PARTIAL');
    setPreviewViewerModal('queue modal', 5);
    expect(getCurrentJob().modal).not.toBeNull();

    setQueueMode(false);
    expect(getCurrentJob().modal).toBeNull();
  });

  it('clearModal removes modal without affecting job', () => {
    const job = { _id: 'job-cm', company: 'Co', role: 'Engineer' } as any;
    setCurrentJob('job-cm', job, 'FULL_PARSED');
    setPreviewViewerModal('content', 5);
    expect(getCurrentJob().modal).not.toBeNull();

    clearModal();
    expect(getCurrentJob().modal).toBeNull();
    expect(getCurrentJob().joblifecycleId).toBe('job-cm');
  });
});

describe('shared-tui-state extended: file persistence edge cases', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('recovers from corrupt state file', () => {
    writeFileSync(TEST_STATE_PATH, 'not valid json', 'utf8');

    const state = getCurrentJob();
    expect(state.joblifecycleId).toBeNull();
    expect(state.version).toBe(2);
  });

  it('v1 migration with messageId converts to v2 queue sub-state', () => {
    writeFileSync(TEST_STATE_PATH, JSON.stringify({
      version: 1,
      messageId: 'v1-msg-id',
      job: { _id: 'v1-msg-id', company: 'V1Co', role: 'V1' },
      stage: 'PARTIAL',
      editedFields: null,
      updatedAt: '2025-01-01T00:00:00.000Z',
    }), 'utf8');

    const state = getCurrentJob();
    expect(state.version).toBe(2);
    expect(state.joblifecycleId).toBe('v1-msg-id');
    expect(state.job?.company).toBe('V1Co');
    expect(state.stage).toBe('PARTIAL');
  });
});
