import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
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
    try { await client.close(); } catch (e) {}
    await releaseSharedMongod();
  }

  return { mongod, client, uri, dbName, clearDb, stop };
}
