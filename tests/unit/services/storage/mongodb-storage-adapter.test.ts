import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobStage, JobStatus, JobSource } from '../../../../src/domain/types/job-lifecycle.js' ;

function makeMockCollection() {
  return {
    updateOne: vi.fn(),
    findOne: vi.fn(),
    insertOne: vi.fn(),
    createIndex: vi.fn(),
  };
}

function makeMockDb(collections: Record<string, any>) {
  return {
    collection: vi.fn((name: string) => {
      if (!collections[name]) collections[name] = makeMockCollection();
      return collections[name];
    }),
  };
}

function makeMockMongoClient(db: any) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    db: vi.fn(() => db),
  };
}

const mockClient = vi.hoisted(() => makeMockMongoClient(makeMockDb({})));

vi.mock('mongodb', () => ({
  MongoClient: vi.fn(() => mockClient),
}));

describe('MongoDBStorageAdapter', () => {
  let MongoDBStorageAdapter: any;
  let mockCols: Record<string, any>;
  let mockDb: any;
  let adapter: any;

  function createAdapter() {
    return new MongoDBStorageAdapter({
      mongoUri: 'mongodb://localhost:27017/test',
      dbName: 'test-db',
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCols = {};
    mockDb = makeMockDb(mockCols);
    mockClient.db.mockReturnValue(mockDb);
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.close.mockResolvedValue(undefined);

    const mod = await import('../../../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' );
    MongoDBStorageAdapter = mod.MongoDBStorageAdapter;
    adapter = createAdapter();
  });

  describe('connect', () => {
    it('connects and creates indexes', async () => {
      await adapter.connect();
      expect(mockClient.connect).toHaveBeenCalledOnce();
      expect(mockClient.db).toHaveBeenCalledWith('test-db');
    });

    it('throws when MongoClient.connect fails', async () => {
      mockClient.connect.mockRejectedValueOnce(new Error('Connection refused'));
      await expect(adapter.connect()).rejects.toThrow('Connection refused');
    });
  });

  describe('upsertJobLifecycle', () => {
    it('upserts a job lifecycle document', async () => {
      await adapter.connect();
      const doc = {
        _id: 'test-job-1',
        raw: '<html/>',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
        company: 'TestCo',
        role: 'Engineer',
        createdAt: new Date(),
        updatedAt: new Date(),
        stageTimestamp: new Date(),
      };
      mockCols['job_lifecycle'].updateOne.mockResolvedValueOnce({ acknowledged: true });
      await adapter.upsertJobLifecycle(doc);
      expect(mockCols['job_lifecycle'].updateOne).toHaveBeenCalledWith(
        { _id: 'test-job-1' },
        { $set: doc },
        { upsert: true },
      );
    });

    it('throws when not connected', async () => {
      await expect(adapter.upsertJobLifecycle({ _id: 'x' } as any)).rejects.toThrow('not initialized');
    });

    it('throws when MongoDB update fails', async () => {
      await adapter.connect();
      mockCols['job_lifecycle'].updateOne.mockRejectedValueOnce(new Error('Write error'));
      await expect(adapter.upsertJobLifecycle({
        _id: 'test-job-1', raw: '', stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING, source: JobSource.BROWSER_AUTO,
        company: 'TestCo', role: 'Engineer', createdAt: new Date(),
        updatedAt: new Date(), stageTimestamp: new Date(),
      })).rejects.toThrow('Write error');
    });
  });

  describe('updateJobStatus', () => {
    it('updates status and sets updatedAt', async () => {
      await adapter.connect();
      mockCols['job_lifecycle'].updateOne.mockResolvedValueOnce({ acknowledged: true });
      await adapter.updateJobStatus('job-1', JobStatus.QUEUED);
      expect(mockCols['job_lifecycle'].updateOne).toHaveBeenCalledWith(
        { _id: 'job-1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: JobStatus.QUEUED,
            routedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('includes trashReason when provided', async () => {
      await adapter.connect();
      mockCols['job_lifecycle'].updateOne.mockResolvedValueOnce({ acknowledged: true });
      await adapter.updateJobStatus('job-1', JobStatus.TRASHED, 'operator:trash');
      expect(mockCols['job_lifecycle'].updateOne).toHaveBeenCalledWith(
        { _id: 'job-1' },
        expect.objectContaining({
          $set: expect.objectContaining({ trashReason: 'operator:trash' }),
        }),
      );
    });

    it('throws when not connected', async () => {
      await expect(adapter.updateJobStatus('x', JobStatus.QUEUED)).rejects.toThrow('not initialized');
    });
  });

  describe('findJobLifecycleById', () => {
    it('returns document when found', async () => {
      await adapter.connect();
      const expected = { _id: 'job-1', company: 'TestCo' };
      mockCols['job_lifecycle'].findOne.mockResolvedValueOnce(expected);
      const result = await adapter.findJobLifecycleById('job-1');
      expect(result).toEqual(expected);
    });

    it('returns null when not found', async () => {
      await adapter.connect();
      mockCols['job_lifecycle'].findOne.mockResolvedValueOnce(null);
      const result = await adapter.findJobLifecycleById('nonexistent');
      expect(result).toBeNull();
    });

    it('throws when not connected', async () => {
      await expect(adapter.findJobLifecycleById('x')).rejects.toThrow('not initialized');
    });
  });

  describe('insertActionSnapshot', () => {
    it('inserts a snapshot with a timestamp', async () => {
      await adapter.connect();
      mockCols['action_snapshots'].insertOne.mockResolvedValueOnce({ acknowledged: true });
      await adapter.insertActionSnapshot({ action: 'job.generated', joblifecycleId: 'job-1' } as any);
      expect(mockCols['action_snapshots'].insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'job.generated',
          joblifecycleId: 'job-1',
          timestamp: expect.any(Date),
        }),
      );
    });

    it('throws when collection insert fails', async () => {
      await adapter.connect();
      mockCols['action_snapshots'].insertOne.mockRejectedValueOnce(new Error('Insert failed'));
      await expect(adapter.insertActionSnapshot({ action: 'test' } as any)).rejects.toThrow('Insert failed');
    });

    it('throws when not connected', async () => {
      await expect(adapter.insertActionSnapshot({} as any)).rejects.toThrow('not initialized');
    });
  });

  describe('disconnect', () => {
    it('closes the client', async () => {
      await adapter.connect();
      await adapter.disconnect();
      expect(mockClient.close).toHaveBeenCalledOnce();
    });
  });
});
