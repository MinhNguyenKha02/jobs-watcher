import { EventDrivenWebhook } from '../../src/services/event-webhook.js';
import { mockPubSubMessage, mockGmailMessage } from '../__fixtures__/pubsub-messages.js';
import { showJobPopup } from '../../src/ui/JobPopup.js';
import { SmartGenerator } from '../../src/services/smart-generator.js';
import { notifyUser } from '../../src/services/notifications.js';

jest.mock('../../src/ui/JobPopup.js', () => ({
  showJobPopup: jest.fn(),
}));

jest.mock('../../src/services/notifications.js', () => ({
  notifyUser: jest.fn(),
  logAction: jest.fn(),
  getMonitoringStats: jest.fn(),
}));

jest.mock('../../src/services/smart-generator.js');

describe('EventDrivenWebhook - Headless Flow', () => {
  let gmailService: any;
  let webhook: EventDrivenWebhook;
  let generateForJob: jest.Mock;

  beforeEach(() => {
    generateForJob = jest.fn().mockResolvedValue('/tmp/output');
    (SmartGenerator as jest.Mock).mockImplementation(() => ({ generateForJob }));

    gmailService = {
      gmail: {
        users: {
          messages: {
            list: jest.fn(),
          },
        },
      },
      getMessagesSinceHistory: jest.fn().mockResolvedValue(['msg-001']),
      getLabelId: jest.fn().mockResolvedValue('label-1'),
      getMessage: jest.fn().mockResolvedValue(mockGmailMessage),
      extractHeader: jest.fn((message: any, header: string) => {
        const found = message.payload.headers.find((h: any) => h.name === header);
        return found?.value || '';
      }),
      extractBody: jest.fn(() => 'Job description...'),
    };

    (showJobPopup as jest.Mock).mockResolvedValue('apply');
    (notifyUser as jest.Mock).mockResolvedValue(undefined);

    webhook = new EventDrivenWebhook(gmailService as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('processes a Pub/Sub notification without manual input', async () => {
    // History-based path already returns ['msg-001'] via getMessagesSinceHistory

    await (webhook as any).handleJobNotification(mockPubSubMessage);

    expect(gmailService.getLabelId).toHaveBeenCalled();
    expect(gmailService.getMessagesSinceHistory).toHaveBeenCalledWith('12345', 'label-1');
    expect(gmailService.getMessage).toHaveBeenCalledWith('msg-001');
    expect(showJobPopup).toHaveBeenCalled();
    expect(generateForJob).toHaveBeenCalled();
    expect(notifyUser).toHaveBeenCalled();
  });

  it('skips processing when the message payload is empty', async () => {
    await (webhook as any).handleJobNotification({});

    expect(gmailService.getLabelId).not.toHaveBeenCalled();
    expect(showJobPopup).not.toHaveBeenCalled();
  });
});
