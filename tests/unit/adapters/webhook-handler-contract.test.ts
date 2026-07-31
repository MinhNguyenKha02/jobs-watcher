import { describe, it, expect, vi } from 'vitest';
import { WebhookAdapter } from '../../../src/infrastructure/inbound/web/webhook-adapter.js';
import type { IngestorPort } from '../../../src/application/ports/inbound/ingestor.port.js';

describe('WebhookAdapter — contract', () => {
  it('depends on IngestorPort (DIP compliance)', () => {
    const ingestorMock = {
      processIngest: vi.fn(),
      processResolution: vi.fn(),
    } as unknown as IngestorPort;
    const gmailMock = {
      getMessage: vi.fn(),
      extractHeader: vi.fn(),
      extractBody: vi.fn(),
      getMessagesSinceHistory: vi.fn(),
    };
    const adapter = new WebhookAdapter(ingestorMock, gmailMock);
    expect(adapter).toBeInstanceOf(WebhookAdapter);
  });

  it('requires GmailClient with correct shape', () => {
    const ingestorMock = {} as unknown as IngestorPort;
    const validClient = {
      getMessage: vi.fn(),
      extractHeader: vi.fn(),
      extractBody: vi.fn(),
      getMessagesSinceHistory: vi.fn(),
    };
    const adapter = new WebhookAdapter(ingestorMock, validClient);
    expect(typeof adapter.stop).toBe('function');
  });

  it('adapter does not implement IngestorPort (inbound adapter consumes port)', () => {
    const ingestorMock = {} as unknown as IngestorPort;
    const gmailMock = {
      getMessage: vi.fn(),
      extractHeader: vi.fn(),
      extractBody: vi.fn(),
      getMessagesSinceHistory: vi.fn(),
    };
    const adapter = new WebhookAdapter(ingestorMock, gmailMock);
    const hasProcessIngest = typeof (adapter as unknown as IngestorPort).processIngest;
    expect(hasProcessIngest).toBe('undefined');
  });
});
