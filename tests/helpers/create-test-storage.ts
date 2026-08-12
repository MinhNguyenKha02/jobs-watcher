import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { getSharedMongod, releaseSharedMongod } from './setup.js';

export async function createTestStorage(): Promise<{
  mongod: MongoMemoryServer;
  client: MongoClient;
  uri: string;
  dbName: string;
  clearDb: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  const mongod = await getSharedMongod();
  const uri = mongod.getUri();
  const dbName = mongod.instanceInfo?.dbName || 'test';
  const client = new MongoClient(uri);
  await client.connect();

  async function clearDb() {
    const db = client.db(dbName);
    const cols = await db.listCollections().toArray();
    for (const col of cols) {
      await db.collection(col.name).deleteMany({});
    }
  }

  async function stop() {
    // Swallow only the known-benign teardown artifact (MongoClientClosedError)
    // from in-flight checkouts closed during the shared-singleton teardown.
    // Any other unhandled rejection is rethrown so real flakiness is not masked.
    const onUnhandled = (reason: unknown) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      if (!/MongoClientClosedError|Topology is closed/.test(msg)) {
        process.off('unhandledRejection', onUnhandled);
        throw reason;
      }
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      try {
        await client.close();
      } catch (e) {}
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    await releaseSharedMongod();
  }

  return { mongod, client, uri, dbName, clearDb, stop };
}
