import { jest } from '@jest/globals';

import { GmailService } from '../../src/services/gmail.js';

const runReal = process.env.GMAIL_INTEGRATION === 'true';
const describeIf = runReal ? describe : describe.skip;

describeIf('GmailService - Real API Integration Tests', () => {
  jest.setTimeout(30000);
  let service: GmailService;

  beforeAll(async () => {
    service = new GmailService();
    await service.authenticate();
  });

  it('lists messages with a query', async () => {
    const result = await service.listMessages('newer_than:7d', 1);
    expect(Array.isArray(result)).toBe(true);
  });

  it('fetches a full message when available', async () => {
    const messages = await service.listMessages('newer_than:7d', 1);
    const messageId = messages[0]?.id;
    if (!messageId) {
      return;
    }

    const result = await service.getMessage(messageId);
    expect(result.id).toBe(messageId);
  });

  it('lists messages by label when configured', async () => {
    const labelName = process.env.GMAIL_LABEL_NAME;
    if (!labelName) {
      return;
    }

    const labelId = await service.getLabelId(labelName);
    const result = await service.listMessagesByLabel(labelId, 1);
    expect(Array.isArray(result)).toBe(true);
  });
});
