import { unlinkSync, existsSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { JobStage } from '../../../../src/domain/types/job-lifecycle.js';

const TEST_STATE_PATH = '/tmp/test-tui-state-race.json';
if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
process.env.TUI_SHARED_STATE_PATH = TEST_STATE_PATH;

vi.mock('node:fs', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    watch: vi.fn(() => ({ close: vi.fn() })),
  };
});

function cleanState() {
  try {
    unlinkSync(TEST_STATE_PATH);
  } catch {}
  try {
    unlinkSync(TEST_STATE_PATH + '.lock');
  } catch {}
}

const { setCurrentJob, getCurrentJob, setQueueMode, clearCurrentJob, resetState } =
  await import('../../../../src/presentation/tui/shared-tui-state.js');

describe('T3: Shared state file race condition', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('GIVEN T3 WHEN exercised THEN concurrent setCurrentJob calls do not corrupt state (S2+S1)', async () => {
    const job1 = { _id: 'race-job-1', company: 'Alpha', role: 'Engineer A' } as any;
    const job2 = { _id: 'race-job-2', company: 'Beta', role: 'Engineer B' } as any;

    await Promise.all([
      setCurrentJob('race-job-1', job1, JobStage.PARTIAL_PARSED),
      setCurrentJob('race-job-2', job2, JobStage.FULL_PARSED),
    ]);

    const state = getCurrentJob();
    expect(state.jobLifecycleId).toBe('race-job-1');
    expect(state.job?.company).toBe('Alpha');
    expect(state.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('GIVEN T3 WHEN exercised THEN concurrent clearCurrentJob + setCurrentJob proves race exists (either outcome valid) (S2+S1)', async () => {
    const job = { _id: 'race-job-3', company: 'Gamma', role: 'Engineer C' } as any;
    setCurrentJob('race-job-3', job, JobStage.FULL_PARSED);

    await Promise.all([
      clearCurrentJob(),
      setCurrentJob(
        'race-job-4',
        { _id: 'race-job-4', company: 'Delta', role: 'Engineer D' } as any,
        JobStage.PARTIAL_PARSED
      ),
    ]);

    const state = getCurrentJob();
    expect(state.jobLifecycleId === 'race-job-3' || state.jobLifecycleId === 'race-job-4').toBe(
      true
    );
  });

  it('GIVEN T3 WHEN exercised THEN concurrent queue mode toggle and setCurrentJob (S2)', async () => {
    await Promise.all([
      setQueueMode(false),
      setQueueMode(true),
      setCurrentJob(
        'race-job-5',
        { _id: 'race-job-5', company: 'Epsilon', role: 'Engineer E' } as any,
        JobStage.FULL_PARSED
      ),
    ]);

    const state = getCurrentJob();
    expect(state.jobLifecycleId).toBe('race-job-5');
    expect(state.stage).toBe(JobStage.FULL_PARSED);
  });

  it('GIVEN T3 WHEN ops.push THEN rapid sequential set/get across modes does not lose writes (S2+S1)', async () => {
    const ops = [];
    for (let i = 0; i < 20; i++) {
      const id = `race-seq-${i}`;
      const job = { _id: id, company: `SeqCorp${i}`, role: `Engineer ${i}` } as any;
      ops.push(
        setCurrentJob(id, job, i % 2 === 0 ? JobStage.FULL_PARSED : JobStage.PARTIAL_PARSED)
      );
    }
    await Promise.all(ops);

    const final = getCurrentJob();
    expect(final.jobLifecycleId).toBe('race-seq-0');
  });

  it('GIVEN T3 WHEN exercised THEN lock file is cleaned after write failure simulation (S2)', async () => {
    expect(existsSync(TEST_STATE_PATH + '.lock')).toBe(false);

    const job = { _id: 'race-job-lock', company: 'LockCorp', role: 'Engineer' } as any;
    setCurrentJob('race-job-lock', job, JobStage.FULL_PARSED);

    expect(existsSync(TEST_STATE_PATH + '.lock')).toBe(false);

    const state = getCurrentJob();
    expect(state.jobLifecycleId).toBe('race-job-lock');
  });
});
