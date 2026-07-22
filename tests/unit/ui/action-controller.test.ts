import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';

const TEST_STATE_PATH = '/tmp/test-tui-state-action.json';
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

const mockSpawn = vi.fn(() => ({ unref: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

const { setCurrentJob, resetState, getQueueMode } = await import('../../../src/presentation/tui/shared-tui-state.js' );
const { ActionController } = await import('../../../src/presentation/tui/action-controller.js' );

function cleanState() {
  try { unlinkSync(TEST_STATE_PATH); } catch {}
}

function setJob(id: string, company: string, role: string) {
  cleanState();
  resetState();
  setCurrentJob(id, { _id: id, company, role, url: 'https://ex.com/job' } as any, 'FULL_PARSED');
}

describe('ActionController', () => {
  let controller: ActionController;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanState();
    resetState();
    mockAttach.mockResolvedValue(undefined);
    mockUdsQueue.mockResolvedValue(undefined);
    mockUdsTrash.mockResolvedValue(undefined);
    mockUdsWebhookIngest.mockResolvedValue('<div>parsed</div>');
    mockClipboardGetter.mockResolvedValue(['<div>clipboard</div>']);
    controller = new ActionController({ socketPath: '/tmp/test.sock', udsToken: 'test-token' });
  });

  afterEach(() => {
    controller.stop();
    cleanState();
  });

  describe('start / stop lifecycle', () => {
    it('attaches keyboard on start and detaches on quit', async () => {
      mockWaitForAction.mockResolvedValue('quit');
      await controller.start().catch(() => {});
      expect(mockAttach).toHaveBeenCalled();
      expect(mockDetach).toHaveBeenCalled();
    });

    it('stop is safe when not started', () => {
      expect(() => controller.stop()).not.toThrow();
    });
  });

  describe('actions', () => {
    it('prevents double-queue of same job via processedIds', async () => {
      setJob('job-dup', 'DupCo', 'Engineer');
      await (controller as any).dispatchAction('queue');
      await (controller as any).dispatchAction('queue');
      expect(mockUdsQueue).toHaveBeenCalledTimes(1);
    });

    it('allows queue of different jobs sequentially (processedIds per-job)', async () => {
      setJob('job-a', 'ACo', 'Engineer');
      await (controller as any).dispatchAction('queue');
      expect(mockUdsQueue).toHaveBeenCalledWith('job-a', expect.any(Object));

      setJob('job-b', 'BCo', 'Dev');
      await (controller as any).dispatchAction('queue');
      expect(mockUdsQueue).toHaveBeenCalledWith('job-b', expect.any(Object));
    });

    it('queue action sends to UDS', async () => {
      setJob('job-q', 'QueueCo', 'Junior Engineer');
      await (controller as any).dispatchAction('queue');
      expect(mockUdsQueue).toHaveBeenCalledWith('job-q', expect.any(Object));
    });

    it('trash action sends to UDS', async () => {
      setJob('job-t', 'TrashCo', 'Junior Engineer');
      await (controller as any).dispatchAction('trash');
      expect(mockUdsTrash).toHaveBeenCalledWith('job-t', expect.any(Object));
    });

    it('does not queue without a current job', async () => {
      cleanState();
      resetState();
      await (controller as any).dispatchAction('queue');
      expect(mockUdsQueue).not.toHaveBeenCalled();
    });

    it('prevents double-queue of same job', async () => {
      setJob('job-dup', 'DupCo', 'Engineer');
      await (controller as any).dispatchAction('queue');
      await (controller as any).dispatchAction('queue');
      expect(mockUdsQueue).toHaveBeenCalledTimes(1);
    });

    it('preview reads clipboard', async () => {
      setJob('job-p', 'PrevCo', 'Engineer');
      mockClipboardGetter.mockResolvedValue(['line1\nline2']);
      await (controller as any).dispatchAction('preview');
      expect(mockClipboardGetter).toHaveBeenCalled();
    });

    it('help does not throw', async () => {
      await (controller as any).dispatchAction('help');
    });

    it('toggle_queue flips mode', async () => {
      const before = getQueueMode();
      await (controller as any).dispatchAction('toggle_queue');
      expect(getQueueMode()).toBe(!before);
    });

    it('webhook_stage2_parse triggers webhook ingest for partial jobs', async () => {
      cleanState();
      resetState();
      setCurrentJob('job-c', { _id: 'job-c', company: 'StageCo', role: 'Engineer' } as any, 'PARTIAL');
      await (controller as any).dispatchAction('webhook_stage2_parse');
      expect(mockUdsWebhookIngest).toHaveBeenCalledWith('job-c');
    });

    it('webhook_stage2_parse is ignored for full-parsed jobs (B1 guard)', async () => {
      setJob('job-c', 'StageCo', 'Engineer');
      await (controller as any).dispatchAction('webhook_stage2_parse');
      expect(mockUdsWebhookIngest).not.toHaveBeenCalled();
    });

    it('[i] prints feedback in queue mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { setQueueMode } = await import('../../../src/presentation/tui/shared-tui-state.js' );
      setQueueMode(true);
      await (controller as any).dispatchAction('ingest');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[i] ignored in queue mode'),
      );
      expect(mockUdsQueue).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('[o] open URL dispatches spawn with job URL', async () => {
      setJob('job-o', 'OCo', 'Engineer');
      await (controller as any).dispatchAction('open');
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        ['https://ex.com/job'],
        expect.any(Object),
      );
    });
  });
});
