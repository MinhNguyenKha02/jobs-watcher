import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGmailService = {
  authenticate: vi.fn<() => Promise<void>>(),
  getLabelId: vi.fn<() => Promise<string>>(),
  setupWatch: vi.fn<() => Promise<void>>(),
};

let questionCallback: ((answer: string) => void) | null = null;

vi.mock('../../../src/services/gmail.js', () => ({
  GmailService: vi.fn(() => mockGmailService),
}));

vi.mock('readline', () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: vi.fn((_prompt: string, cb: (answer: string) => void) => {
        questionCallback = cb;
      }),
      close: vi.fn(),
    })),
  },
}));

describe('setup CLI', () => {
  let processExitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    questionCallback = null;
    process.env.GMAIL_TOPIC_NAME = 'projects/test-project/topics/test-topic';
  });

  it('authenticates, finds label, and sets up watch', async () => {
    mockGmailService.getLabelId.mockResolvedValue('Label_123');
    mockGmailService.setupWatch.mockResolvedValue(undefined);

    await import('../../../src/infrastructure/inbound/cli/setup.js' );
    await vi.waitFor(() => expect(mockGmailService.authenticate).toHaveBeenCalled());

    expect(mockGmailService.getLabelId).toHaveBeenCalled();
    expect(mockGmailService.setupWatch).toHaveBeenCalledWith('Label_123', 'projects/test-project/topics/test-topic');
  });
});
