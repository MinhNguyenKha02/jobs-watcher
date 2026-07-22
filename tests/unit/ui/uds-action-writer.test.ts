import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../../src/cli/clipboard-getter.js', () => ({
  clipboardGetter: vi.fn().mockResolvedValue(['<div>test clipboard</div>']),
}));

const mockPostJsonOverUds = vi.fn();
vi.mock('../../../src/utils/uds-http.js', () => ({
  postJsonOverUds: mockPostJsonOverUds,
}));

const { UdsActionWriter } = await import('../../../src/presentation/tui/components/UdsActionWriter.js' );

describe('UdsActionWriter reliability', () => {
  let tmpDir: string;
  let validSocketPath: string;
  let missingSocketPath: string;
  let writer: UdsActionWriter;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'uds-test-'));
    validSocketPath = join(tmpDir, 'ingest.sock');
    missingSocketPath = join(tmpDir, 'nonexistent.sock');
    writeFileSync(validSocketPath, '');
    vi.clearAllMocks();

    mockPostJsonOverUds.mockResolvedValue({ statusCode: 202, body: '{"accepted":true}' });
  });

  afterEach(() => {
    try { unlinkSync(validSocketPath); } catch {}
  });

  describe('sendAction socket existence check', () => {
    it('throws when socket does not exist', async () => {
      writer = new UdsActionWriter(missingSocketPath, 'test-token');
      await expect(writer.queue('job-1', {})).rejects.toThrow(/UDS socket not found/);
    });

    it('succeeds when socket exists', async () => {
      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await expect(writer.queue('job-1', {})).resolves.toBeUndefined();
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(1);
    });

    it('throws immediately without retrying on missing socket (fs check is pre-request)', async () => {
      writer = new UdsActionWriter(missingSocketPath, 'test-token');
      await expect(writer.queue('job-1', {})).rejects.toThrow(/UDS socket not found/);
      expect(mockPostJsonOverUds).not.toHaveBeenCalled();
    });
  });

  describe('sendAction retry logic', () => {
    it('succeeds on first attempt', async () => {
      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await writer.queue('job-1', {});
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(1);
    });

    it('retries on transient failure and succeeds', async () => {
      mockPostJsonOverUds
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ statusCode: 202, body: '{"accepted":true}' });

      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await writer.queue('job-retry', {});
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(2);
    });

    it('retries up to 3 times then throws on persistent failure', async () => {
      mockPostJsonOverUds.mockRejectedValue(new Error('ECONNREFUSED'));

      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await expect(writer.trash('job-fail', {})).rejects.toThrow('ECONNREFUSED');
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(3);
    });

    it('retries on non-2xx status codes', async () => {
      mockPostJsonOverUds
        .mockResolvedValueOnce({ statusCode: 500, body: 'Internal Server Error' })
        .mockResolvedValueOnce({ statusCode: 503, body: 'Service Unavailable' })
        .mockResolvedValueOnce({ statusCode: 202, body: '{"accepted":true}' });

      writer = new UdsActionWriter(validSocketPath, 'test-token');
      await writer.queue('job-recover', {});
      expect(mockPostJsonOverUds).toHaveBeenCalledTimes(3);
    });
  });

  describe('queue/trash action payload', () => {
    beforeEach(() => {
      writer = new UdsActionWriter(validSocketPath, 'test-token');
    });

    it('sends queue action with correct payload', async () => {
      await writer.queue('job-q', { company: 'Updated' });
      const callArg = mockPostJsonOverUds.mock.calls[0][1];
      expect(callArg).toMatchObject({
        joblifecycleId: 'job-q',
        action: 'queue',
        source: 'ops-tui',
        editedKVs: { company: 'Updated' },
      });
    });

    it('sends trash action with correct payload', async () => {
      await writer.trash('job-t', { reason: 'not interested' });
      const callArg = mockPostJsonOverUds.mock.calls[0][1];
      expect(callArg).toMatchObject({
        joblifecycleId: 'job-t',
        action: 'trash',
        source: 'ops-tui',
        editedKVs: { reason: 'not interested' },
      });
    });
  });
});
