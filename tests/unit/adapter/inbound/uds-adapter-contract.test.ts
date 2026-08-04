import { describe, it, expect, vi, beforeAll } from 'vitest';
import { UdsAdapter } from '../../../../src/infrastructure/inbound/uds/uds-adapter.js';
import type { IngestorPort } from '../../../../src/application/ports/inbound/ingestor.port.js';

describe('UdsAdapter — contract', () => {
  let ingestorMock: IngestorPort;

  beforeAll(() => {
    ingestorMock = {
      processIngest: vi.fn().mockResolvedValue(undefined),
      processResolution: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('depends on IngestorPort (DIP compliance)', () => {
    const adapter = new UdsAdapter(ingestorMock, { socketPath: '/tmp/test.sock' });
    expect(adapter).toBeInstanceOf(UdsAdapter);
    expect(typeof adapter.start).toBe('function');
    expect(typeof adapter.stop).toBe('function');
  });

  it('does not implement IngestorPort (inbound adapter consumes port)', () => {
    const adapter = new UdsAdapter(ingestorMock, { socketPath: '/tmp/test.sock' });
    const hasProcessIngest = typeof (adapter as unknown as IngestorPort).processIngest;
    expect(hasProcessIngest).toBe('undefined');
  });

  it('accepts optional token in config', () => {
    const adapter = new UdsAdapter(ingestorMock, {
      socketPath: '/tmp/test.sock',
      token: 'my-secret',
    });
    expect(adapter).toBeInstanceOf(UdsAdapter);
  });

  it('accepts config without token', () => {
    const adapter = new UdsAdapter(ingestorMock, { socketPath: '/tmp/test.sock' });
    expect(adapter).toBeInstanceOf(UdsAdapter);
  });
});
