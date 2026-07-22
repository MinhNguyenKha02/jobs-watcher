import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';

const TEST_STATE_PATH = '/tmp/test-tui-action-edge.json';
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

const { setCurrentJob, resetState, getQueueMode, setQueueMode } = await import('../../../src/presentation/tui/shared-tui-state.js' );
const { ActionController } = await import('../../../src/presentation/tui/action-controller.js' );

function cleanState() {
  try { unlinkSync(TEST_STATE_PATH); } catch {}
}

function setJob(id: string, company: string, role: string) {
  cleanState();
  resetState();
  setCurrentJob(id, { _id: id, company, role, url: 'https://ex.com/job' } as any, 'FULL_PARSED');
}

describe('ActionController — mode toggle edge cases', () => {
  let controller: ActionController;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanState();
    resetState();
    mockAttach.mockResolvedValue(undefined);
    mockUdsQueue.mockResolvedValue(undefined);
    mockUdsTrash.mockResolvedValue(undefined);
    mockUdsWebhookIngest.mockResolvedValue('<div>parsed</div>');
    controller = new ActionController({ socketPath: '/tmp/test.sock', udsToken: 'test-token' });
  });

  afterEach(() => {
    controller.stop();
    cleanState();
  });

  it('toggles from default queue to direct mode', async () => {
    expect(getQueueMode()).toBe(true);
    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);
  });

  it('toggles back to queue mode on second call', async () => {
    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);
    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(true);
  });

  it('allows queue action after toggling to direct and back', async () => {
    setJob('edge-job', 'EdgeCo', 'Engineer');

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(true);

    await (controller as any).dispatchAction('queue');
    expect(mockUdsQueue).toHaveBeenCalledWith('edge-job', expect.any(Object));
  });

  it('toggles without a job set (no crash)', async () => {
    cleanState();
    resetState();
    expect(() => (controller as any).dispatchAction('toggle_queue')).not.toThrow();
    expect(getQueueMode()).toBe(false);
  });

  it('queue action sees no job after toggle (mode substates isolated)', async () => {
    setJob('direct-q-job', 'DCo', 'Engineer');

    await (controller as any).dispatchAction('toggle_queue');
    expect(getQueueMode()).toBe(false);

    await (controller as any).dispatchAction('queue');
    expect(mockUdsQueue).not.toHaveBeenCalled();
  });
});
