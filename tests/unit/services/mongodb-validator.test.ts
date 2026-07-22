import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockCommand = vi.fn();

vi.mock('mongodb', () => ({
  MongoClient: vi.fn(() => ({
    connect: mockConnect,
    close: mockClose,
    db: vi.fn(() => ({
      command: mockCommand,
    })),
  })),
}));

const { validateMongoTopology } = await import('../../../src/infrastructure/outbound/persistence/mongodb-validator.js' );

describe('validateMongoTopology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
  });

  it('passes when replica set is detected', async () => {
    mockCommand.mockResolvedValue({ isMaster: 1, setName: 'rs0' });

    await expect(validateMongoTopology('mongodb://localhost:27017')).resolves.toBeUndefined();
    expect(mockConnect).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it('warns in dev mode when not a replica set', async () => {
    mockCommand.mockResolvedValue({ isMaster: 1 });

    await expect(validateMongoTopology('mongodb://localhost:27017', 'development')).resolves.toBeUndefined();
  });

  it('throws in production mode when not a replica set', async () => {
    mockCommand.mockResolvedValue({ isMaster: 1 });

    await expect(validateMongoTopology('mongodb://localhost:27017', 'production')).rejects.toThrow(
      'MongoDB is not part of a replica set'
    );
  });

  it('falls back to hello command when isMaster fails', async () => {
    mockCommand
      .mockRejectedValueOnce(new Error('command not found'))
      .mockResolvedValueOnce({ hello: 1, replicaSet: 'rs1' });

    await expect(validateMongoTopology('mongodb://localhost:27017')).resolves.toBeUndefined();
  });

  it('treats hello result with setName as replica set', async () => {
    mockCommand
      .mockRejectedValueOnce(new Error('not master'))
      .mockResolvedValueOnce({ hello: 1, setName: 'rs2' });

    await expect(validateMongoTopology('mongodb://localhost:27017')).resolves.toBeUndefined();
    expect(mockConnect).toHaveBeenCalled();
  });

  it('handles connection failure gracefully', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'));

    await expect(validateMongoTopology('mongodb://localhost:27017')).rejects.toThrow('connection refused');
  });

  it('cleans up client connection on success', async () => {
    mockCommand.mockResolvedValue({ isMaster: 1, setName: 'rs0' });

    await validateMongoTopology('mongodb://localhost:27017');
    expect(mockClose).toHaveBeenCalled();
  });

  it('cleans up client connection on error', async () => {
    mockCommand.mockResolvedValue({ isMaster: 1 });

    try {
      await validateMongoTopology('mongodb://localhost:27017', 'production');
    } catch {}

    expect(mockClose).toHaveBeenCalled();
  });
});
