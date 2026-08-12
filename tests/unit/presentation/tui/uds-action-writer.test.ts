import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/presentation/tui/services/clipboard-getter.js', () => ({
  clipboardGetter: vi.fn().mockResolvedValue(['<div>test clipboard</div>']),
}));

const mockPostJsonOverUds = vi.fn();
vi.mock('../../../../src/infrastructure/utils/uds-http.js', () => ({
  postJsonOverUds: mockPostJsonOverUds,
}));

const { UdsActionWriter } =
  await import('../../../../src/presentation/tui/components/UdsActionWriter.js');

describe('UdsActionWriter reliability', () => {
  let tmpDir: string;
  let validSocketPath: string;
  let missingSocketPath: string;
  let writer: InstanceType<typeof UdsActionWriter>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'uds-test-'));
    validSocketPath = join(tmpDir, 'ingest.sock');
    missingSocketPath = join(tmpDir, 'nonexistent.sock');
    writeFileSync(validSocketPath, '');
    vi.clearAllMocks();

    mockPostJsonOverUds.mockResolvedValue({ statusCode: 202, body: '{"accepted":true}' });
  });

  afterEach(() => {
    try {
      unlinkSync(validSocketPath);
    } catch {}
  });

  describe('sendAction socket existence check', () => {
    it('GIVEN socket does not exist WHEN writer.queue THEN throws', async () => {
      writer = new UdsActionWriter(missingSocketPath, 'test-token');
      await expect(writer.queue('job-1')).rejects.toThrow(/UDS socket not found/);
    });

    it('GIVEN socket exists WHEN writer.queue THEN succeeds', async () => {
      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await expect(writer.queue('job-1')).resolves.toBeUndefined();
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(1);
    });

    it('GIVEN UdsActionWriter WHEN writer.queue THEN throws immediately without retrying on missing socket (fs check is pre-request)', async () => {
      writer = new UdsActionWriter(missingSocketPath, 'test-token');
      await expect(writer.queue('job-1')).rejects.toThrow(/UDS socket not found/);
      expect(mockPostJsonOverUds).not.toHaveBeenCalled();
    });
  });

  describe('sendAction retry logic', () => {
    it('GIVEN UdsActionWriter WHEN writer.queue THEN succeeds on first attempt', async () => {
      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await writer.queue('job-1');
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(1);
    });

    it('GIVEN UdsActionWriter WHEN writer.queue THEN retries on transient failure and succeeds', async () => {
      mockPostJsonOverUds
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ statusCode: 202, body: '{"accepted":true}' });

      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await writer.queue('job-retry');
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(2);
    });

    it('GIVEN UdsActionWriter WHEN writer.trash THEN retries up to 3 times then throws on persistent failure', async () => {
      mockPostJsonOverUds.mockRejectedValue(new Error('ECONNREFUSED'));

      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await expect(writer.trash('job-fail')).rejects.toThrow('ECONNREFUSED');
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(3);
    });

    it('GIVEN UdsActionWriter WHEN writer.queue THEN retries on non-2xx status codes', async () => {
      mockPostJsonOverUds
        .mockResolvedValueOnce({ statusCode: 500, body: 'Internal Server Error' })
        .mockResolvedValueOnce({ statusCode: 503, body: 'Service Unavailable' })
        .mockResolvedValueOnce({ statusCode: 202, body: '{"accepted":true}' });

      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await writer.queue('job-recover');
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(3);
    });
  });

  describe('queue/trash action payload', () => {
    beforeEach(() => {
      writer = new UdsActionWriter(validSocketPath, 'test-token');
    });

    it('GIVEN UdsActionWriter WHEN writer.queue THEN sends queue action with correct payload', async () => {
      await writer.queue('job-q');
      const callArg = mockPostJsonOverUds.mock.calls[0][1];
      expect(callArg).toMatchObject({
        jobLifecycleId: 'job-q',
        action: 'queue',
      });
    });

    it('GIVEN UdsActionWriter WHEN writer.trash THEN sends trash action with correct payload', async () => {
      await writer.trash('job-t');
      const callArg = mockPostJsonOverUds.mock.calls[0][1];
      expect(callArg).toMatchObject({
        jobLifecycleId: 'job-t',
        action: 'trash',
      });
    });
  });
});
