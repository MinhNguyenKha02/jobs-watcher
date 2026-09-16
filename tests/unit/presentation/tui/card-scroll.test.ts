import { unlinkSync, existsSync, writeFileSync, readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { JobStage } from '../../../../src/domain/types/job-lifecycle.js';

const TEST_STATE_PATH = '/tmp/test-tui-cardscroll.json';
if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
process.env.TUI_SHARED_STATE_PATH = TEST_STATE_PATH;

vi.mock('node:fs', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    watch: vi.fn(() => ({ close: vi.fn() })),
  };
});

const { setCurrentJob, getCurrentJob, resetState, updateCardScroll, getCardScroll, setCardScrollMax, getCardScrollMax } =
  await import('../../../../src/presentation/tui/shared-tui-state.js');

const { JobCardRenderer } =
  await import('../../../../src/presentation/tui/components/JobCardRenderer.js');

function cleanState() {
  try {
    unlinkSync(TEST_STATE_PATH);
  } catch {}
  try {
    unlinkSync(TEST_STATE_PATH + '.lock');
  } catch {}
}

describe('B1 card-scroll state', () => {
  beforeEach(() => {
    cleanState();
    resetState();
  });

  afterEach(cleanState);

  it('GIVEN fresh state WHEN getCardScroll THEN offset defaults to 0', () => {
    expect(getCardScroll()).toBe(0);
    expect(getCurrentJob().cardScroll).toBe(0);
  });

  it('GIVEN scroll input WHEN updateCardScroll THEN persists stepped offset clamped at 0', () => {
    setCardScrollMax(10);
    expect(updateCardScroll('down')).toBe(1);
    expect(updateCardScroll('down')).toBe(2);
    expect(updateCardScroll('up')).toBe(1);
    expect(updateCardScroll('up')).toBe(0);
    expect(updateCardScroll('up')).toBe(0);
    expect(getCardScroll()).toBe(0);
  });

  it('GIVEN published max WHEN updateCardScroll past max THEN top-clamps to max', () => {
    setCardScrollMax(2);
    expect(updateCardScroll('down')).toBe(1);
    expect(updateCardScroll('down')).toBe(2);
    expect(updateCardScroll('down')).toBe(2);
    expect(getCardScroll()).toBe(2);
  });

  it('GIVEN overflowing offset WHEN max shrinks THEN offset clamps down with max', () => {
    setCardScrollMax(10);
    updateCardScroll('down');
    updateCardScroll('down');
    updateCardScroll('down');
    setCardScrollMax(1);
    expect(getCardScroll()).toBe(1);
    expect(getCardScrollMax()).toBe(1);
  });

  it('GIVEN same max WHEN setCardScrollMax repeats THEN file content unchanged (no write loop)', () => {
    setCardScrollMax(5);
    const before = readFileSync(TEST_STATE_PATH, 'utf8');
    setCardScrollMax(5);
    expect(readFileSync(TEST_STATE_PATH, 'utf8')).toBe(before);
    setCardScrollMax(7);
    expect(readFileSync(TEST_STATE_PATH, 'utf8')).not.toBe(before);
  });

  it('GIVEN scrolled card WHEN setCurrentJob THEN offset resets to 0', () => {
    setCardScrollMax(4);
    updateCardScroll('down');
    updateCardScroll('down');
    setCurrentJob('job-9', { _id: 'job-9', company: 'Acme' } as any, JobStage.FULL_PARSED);
    expect(getCardScroll()).toBe(0);
    expect(getCardScrollMax()).toBe(0);
    expect(getCurrentJob().cardScroll).toBe(0);
  });

  it('GIVEN legacy v2 file without cardScroll WHEN read THEN parses to 0', () => {
    writeFileSync(
      TEST_STATE_PATH,
      JSON.stringify({
        version: 2,
        queueMode: true,
        updatedAt: null,
        queue: {
          jobLifecycleId: 'job-legacy',
          job: null,
          stage: null,
          editedFields: null,
          modal: null,
        },
        direct: {
          jobLifecycleId: null,
          job: null,
          stage: null,
          editedFields: null,
          modal: null,
        },
      }),
      'utf8'
    );
    expect(getCardScroll()).toBe(0);
  });
});

describe('B1 card-scroll renderer', () => {
  const status = { sseConnected: true, udsReady: true, state: 'DISPLAY' } as const;
  const smallJob = { _id: 'job-1', company: 'Acme Inc.', role: 'Senior Engineer' } as any;
  const tallJob = {
    _id: 'job-9',
    company: 'Acme Inc.',
    role: 'Senior Engineer',
    details: Array.from({ length: 40 }, (_, i) => `detail-line-${i}`).join('\n'),
  } as any;

  it('GIVEN fitting body WHEN renderCard THEN 4-arg output identical to 3-arg, no indicator', () => {
    const renderer = new JobCardRenderer(80, 24);
    const a = renderer.renderCard(smallJob, { ...status });
    const b = renderer.renderCard(smallJob, { ...status }, undefined, 0);
    expect(b).toBe(a);
    expect(b).not.toContain('(↑/↓ scroll)');
  });

  it('GIVEN overflowing body WHEN renderCard THEN shows indicator and windows by offset', () => {
    const renderer = new JobCardRenderer(80, 12);
    const top = renderer.renderCard(tallJob, { ...status }, undefined, 0);
    const scrolled = renderer.renderCard(tallJob, { ...status }, undefined, 3);
    expect(top).toContain('↕ 1–');
    expect(scrolled).toContain('↕ 4–');
    expect(scrolled).not.toBe(top);
  });

  it('GIVEN out-of-range offset WHEN renderCard THEN clamps to max like a huge offset', () => {
    const renderer = new JobCardRenderer(80, 12);
    const huge = renderer.renderCard(tallJob, { ...status }, undefined, 10_000);
    const alsoHuge = renderer.renderCard(tallJob, { ...status }, undefined, 500);
    expect(huge).toBe(alsoHuge);
    expect(huge).toContain('(↑/↓ scroll)');
  });

  it('GIVEN negative offset WHEN renderCard THEN renders same as 0', () => {
    const renderer = new JobCardRenderer(80, 12);
    expect(renderer.renderCard(tallJob, { ...status }, undefined, -5)).toBe(
      renderer.renderCard(tallJob, { ...status }, undefined, 0)
    );
  });

  it('GIVEN cardBodyStats WHEN queried THEN maxOffset matches renderer clamping', () => {
    const fit = new JobCardRenderer(80, 24);
    expect(fit.cardBodyStats(smallJob, { ...status }).maxOffset).toBe(0);
    const tight = new JobCardRenderer(80, 12);
    const stats = tight.cardBodyStats(tallJob, { ...status });
    expect(stats.maxOffset).toBeGreaterThan(0);
    expect(stats.maxOffset).toBe(stats.total - stats.visible);
    expect(tight.renderCard(tallJob, { ...status }, undefined, 10_000)).toBe(
      tight.renderCard(tallJob, { ...status }, undefined, stats.maxOffset)
    );
  });
});
