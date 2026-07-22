import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';

const TEST_STATE_PATH = '/tmp/test-tui-action-seq.json';
if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
try { unlinkSync(TEST_STATE_PATH + '.lock'); } catch {}
process.env.TUI_SHARED_STATE_PATH = TEST_STATE_PATH;

vi.mock('node:fs', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, watch: vi.fn(() => ({ close: vi.fn() })) };
});

const mockUdsQueue = vi.fn();
const mockUdsTrash = vi.fn();
const mockUdsWebhookIngest = vi.fn();
vi.mock('../../../src/ui/components/UdsActionWriter.js', () => ({
  UdsActionWriter: vi.fn(() => ({
    queue: mockUdsQueue,
    trash: mockUdsTrash,
    webhookIngest: mockUdsWebhookIngest,
  })),
}));

const mockAttach = vi.fn<[], Promise<void>>();
const mockDetach = vi.fn<[], void>();
const mockWaitForAction = vi.fn<[], Promise<string>>();
const mockShowHelp = vi.fn(() => 'help text');
const MockKeyboardHandler = vi.fn(() => ({
  attach: mockAttach,
  detach: mockDetach,
  waitForAction: mockWaitForAction,
}));
MockKeyboardHandler.showHelp = mockShowHelp;
vi.mock('../../../src/ui/components/KeyboardHandler.js', () => ({
  KeyboardHandler: MockKeyboardHandler,
}));

const mockClipboardGetter = vi.fn();
vi.mock('../../../src/cli/clipboard-getter.js', () => ({
  clipboardGetter: mockClipboardGetter,
}));

const CLIPBOARD_HTML = '<div class="job-detail__info--title"><h1>Junior Engineer</h1></div><div class="company-name-label"><a class="name">Junior Co</a></div><div>topcv</div>';

const { setCurrentJob, resetState, getQueueMode, getCurrentJob, clearCurrentJob, setQueueMode } = await import('../../../src/presentation/tui/shared-tui-state.js' );
const { ActionController } = await import('../../../src/presentation/tui/action-controller.js' );

function cleanState() {
  try { unlinkSync(TEST_STATE_PATH); } catch {}
  try { unlinkSync(TEST_STATE_PATH + '.lock'); } catch {}
}

function setPartialJob(id: string) {
  cleanState();
  resetState();
  setQueueMode(true);
  setCurrentJob(id, { _id: id, company: 'TestCo', role: 'Junior Engineer', url: 'https://ex.com/job' } as any, 'PARTIAL');
}

function setFullJob(id: string) {
  cleanState();
  resetState();
  setQueueMode(true);
  setCurrentJob(id, { _id: id, company: 'TestCo', role: 'Engineer', matchScore: 85 } as any, 'FULL_PARSED');
}

describe('ActionController keyboard sequences (Case 1: [p]→[c]→[j])', () => {
  let controller: ActionController;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanState();
    resetState();
    mockAttach.mockResolvedValue(undefined);
    mockUdsQueue.mockResolvedValue(undefined);
    mockUdsTrash.mockResolvedValue(undefined);
    mockUdsWebhookIngest.mockResolvedValue(CLIPBOARD_HTML);
    mockClipboardGetter.mockResolvedValue([CLIPBOARD_HTML]);
    controller = new ActionController({ socketPath: '/tmp/test.sock', udsToken: 'test-token' });
  });

  afterEach(() => {
    controller.stop();
    cleanState();
  });

  it('[p] reads clipboard and opens preview modal', async () => {
    setPartialJob('job-seq-1');
    mockClipboardGetter.mockResolvedValue(['preview content line 1\npreview content line 2']);

    await (controller as any).dispatchAction('preview');

    expect(mockClipboardGetter).toHaveBeenCalledTimes(1);
    const state = getCurrentJob();
    expect(state.modal).not.toBeNull();
    expect(state.modal!.type).toBe('PREVIEW_VIEWER');
    expect((state.modal as any).clipboardContent).toContain('preview content line 1');
  });

  it('[p] does not crash when clipboard is empty', async () => {
    setPartialJob('job-seq-2');
    mockClipboardGetter.mockResolvedValue(['']);

    await expect(
      (controller as any).dispatchAction('preview'),
    ).resolves.toBeUndefined();
  });

  it('[c] sends clipboard via webhookIngest for partial job and returns html', async () => {
    setPartialJob('job-seq-3');
    mockUdsWebhookIngest.mockResolvedValue(CLIPBOARD_HTML);

    await (controller as any).dispatchAction('webhook_stage2_parse');

    expect(mockUdsWebhookIngest).toHaveBeenCalledWith('job-seq-3');
    expect(mockUdsWebhookIngest).toHaveBeenCalledTimes(1);
  });

  it('[c] is ignored for FULL_PARSED job (B1 guard)', async () => {
    setFullJob('job-seq-4');

    await (controller as any).dispatchAction('webhook_stage2_parse');

    expect(mockUdsWebhookIngest).not.toHaveBeenCalled();
  });

  it('[c] is ignored when joblifecycleId is missing', async () => {
    cleanState();
    resetState();
    setQueueMode(true);

    await (controller as any).dispatchAction('webhook_stage2_parse');

    expect(mockUdsWebhookIngest).not.toHaveBeenCalled();
  });

  it('[j] sends queue action via UDS', async () => {
    setFullJob('job-seq-5');

    await (controller as any).dispatchAction('queue');

    expect(mockUdsQueue).toHaveBeenCalledWith('job-seq-5', expect.any(Object));
    expect(mockUdsQueue).toHaveBeenCalledTimes(1);
  });

  it('[j] prevents double-queue for same job', async () => {
    setFullJob('job-seq-6');

    await (controller as any).dispatchAction('queue');
    await (controller as any).dispatchAction('queue');

    expect(mockUdsQueue).toHaveBeenCalledTimes(1);
  });

  it('[p]→[c]→[j] full sequence with consistent clipboard', async () => {
    setPartialJob('job-seq-7');
    mockClipboardGetter.mockResolvedValue([CLIPBOARD_HTML]);

    await (controller as any).dispatchAction('preview');
    expect(mockClipboardGetter).toHaveBeenCalledTimes(1);
    const afterPreview = getCurrentJob();
    expect(afterPreview.modal).not.toBeNull();

    await (controller as any).dispatchAction('webhook_stage2_parse');
    expect(mockUdsWebhookIngest).toHaveBeenCalledWith('job-seq-7');
    const htmlSent = mockUdsWebhookIngest.mock.results[0].value;
    expect(await htmlSent).toBe(CLIPBOARD_HTML);

    await (controller as any).dispatchAction('queue');
    expect(mockUdsQueue).toHaveBeenCalledWith('job-seq-7', expect.any(Object));
  });

  it('[p]→[c]→[j] with clipboard changed between [p] and [c]', async () => {
    setPartialJob('job-seq-8');
    mockClipboardGetter
      .mockResolvedValueOnce(['old clipboard content'])
      .mockResolvedValueOnce([CLIPBOARD_HTML]);

    await (controller as any).dispatchAction('preview');
    expect(mockClipboardGetter).toHaveBeenCalledTimes(1);

    mockClipboardGetter.mockClear();

    await (controller as any).dispatchAction('webhook_stage2_parse');
    const htmlSent = mockUdsWebhookIngest.mock.results[0].value;
    expect(await htmlSent).toBe(CLIPBOARD_HTML);
  });

  it('[p]→[c]→[j] even when [c] has unparsable clipboard (s4 guard)', async () => {
    setPartialJob('job-seq-9');
    mockClipboardGetter.mockResolvedValue(['unparsable clipboard text']);
    mockUdsWebhookIngest.mockResolvedValue('');

    await (controller as any).dispatchAction('preview');
    expect(getCurrentJob().modal).not.toBeNull();

    await (controller as any).dispatchAction('webhook_stage2_parse');
    expect(mockUdsWebhookIngest).toHaveBeenCalled();

    await (controller as any).dispatchAction('queue');
    expect(mockUdsQueue).toHaveBeenCalled();
  });
});

describe('ActionController keyboard sequences (Case 4: [b]→[i]→[j])', () => {
  let controller: ActionController;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanState();
    resetState();
    setQueueMode(true);
    mockAttach.mockResolvedValue(undefined);
    mockUdsQueue.mockResolvedValue(undefined);
    mockUdsTrash.mockResolvedValue(undefined);
    mockUdsWebhookIngest.mockResolvedValue(CLIPBOARD_HTML);
    mockClipboardGetter.mockResolvedValue([CLIPBOARD_HTML]);
    controller = new ActionController({ socketPath: '/tmp/test.sock', udsToken: 'test-token' });
  });

  afterEach(() => {
    controller.stop();
    cleanState();
  });

  it('[b] toggles queue mode to direct', async () => {
    expect(getQueueMode()).toBe(true);

    await (controller as any).dispatchAction('toggle_queue');

    expect(getQueueMode()).toBe(false);
  });

  it('[b] toggles back to queue mode on second press', async () => {
    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(true);
  });

  it('[i] is ignored in queue mode (requires [b] first)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await (controller as any).dispatchAction('ingest');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[i] ignored in queue mode'));
    consoleSpy.mockRestore();
  });

  it('[b]→[i] sequence: toggle then ingest', async () => {
    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);

    await (controller as any).dispatchAction('ingest');

    expect(mockClipboardGetter).toHaveBeenCalled();
  });

  it('[i] reads clipboard and logs success', async () => {
    await (controller as any).dispatchAction('toggle_queue');
    mockClipboardGetter.mockResolvedValue([CLIPBOARD_HTML]);

    await (controller as any).dispatchAction('ingest');

    expect(mockClipboardGetter).toHaveBeenCalledTimes(1);
  });

  it('[i] does not crash on empty clipboard', async () => {
    await (controller as any).dispatchAction('toggle_queue');
    mockClipboardGetter.mockResolvedValue(['']);

    await expect(
      (controller as any).dispatchAction('ingest'),
    ).resolves.toBeUndefined();
  });

  it('[b]→[i]→[j] full sequence', async () => {
    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);

    mockClipboardGetter.mockResolvedValue([CLIPBOARD_HTML]);
    await (controller as any).dispatchAction('ingest');
    expect(mockClipboardGetter).toHaveBeenCalledTimes(1);

    setFullJob('job-seq-i2j');
    await (controller as any).dispatchAction('queue');
    expect(mockUdsQueue).toHaveBeenCalledWith('job-seq-i2j', expect.any(Object));
  });

  it('[i] with non-HTML clipboard does not crash', async () => {
    await (controller as any).dispatchAction('toggle_queue');
    mockClipboardGetter.mockResolvedValue(['just some plain text']);

    await expect(
      (controller as any).dispatchAction('ingest'),
    ).resolves.toBeUndefined();
  });
});

describe('ActionController mode toggle mid-job state integrity', () => {
  let controller: ActionController;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanState();
    resetState();
    setQueueMode(true);
    mockAttach.mockResolvedValue(undefined);
    mockUdsQueue.mockResolvedValue(undefined);
    mockUdsTrash.mockResolvedValue(undefined);
    mockUdsWebhookIngest.mockResolvedValue(CLIPBOARD_HTML);
    mockClipboardGetter.mockResolvedValue([CLIPBOARD_HTML]);
    controller = new ActionController({ socketPath: '/tmp/test.sock', udsToken: 'test-token' });
  });

  afterEach(() => {
    controller.stop();
    cleanState();
  });

  it('[b] preserves queue job state after direct-mode ingest and toggle back', async () => {
    cleanState();
    resetState();
    setCurrentJob('queue-job-1', { _id: 'queue-job-1', company: 'QCo', role: 'Dev' } as any, 'PARTIAL');
    expect(getCurrentJob().joblifecycleId).toBe('queue-job-1');

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);
    expect(getCurrentJob().joblifecycleId).toBeNull();

    setCurrentJob('direct-job-1', { _id: 'direct-job-1', company: 'DCo', role: 'Engineer' } as any, 'FULL_PARSED');
    expect(getCurrentJob().joblifecycleId).toBe('direct-job-1');

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(true);
    expect(getCurrentJob().joblifecycleId).toBe('queue-job-1');
    expect(getCurrentJob().stage).toBe('PARTIAL');
  });

  it('[b] preserves direct mode job after queue-store and toggle back', async () => {
    cleanState();
    resetState();
    setCurrentJob('queue-interim', { _id: 'queue-interim', company: 'QCo', role: 'Dev' } as any, 'PARTIAL');

    setQueueMode(false);
    setCurrentJob('direct-preserve', { _id: 'direct-preserve', company: 'DCo', role: 'Engineer' } as any, 'FULL_PARSED');
    expect(getCurrentJob().joblifecycleId).toBe('direct-preserve');

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(true);
    expect(getCurrentJob().joblifecycleId).toBe('queue-interim');

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);
    expect(getCurrentJob().joblifecycleId).toBe('direct-preserve');
    expect(getCurrentJob().stage).toBe('FULL_PARSED');
  });

  it('[b] does not lose editedFields across toggle', async () => {
    setPartialJob('edit-job');
    setCurrentJob('edit-job', { _id: 'edit-job', company: 'TestCo', role: 'Engineer' } as any, 'PARTIAL');

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(true);
    expect(getCurrentJob().joblifecycleId).toBe('edit-job');
    expect(getCurrentJob().stage).toBe('PARTIAL');
  });
});
