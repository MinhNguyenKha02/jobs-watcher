import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { getSharedMongod, releaseSharedMongod } from './setup.js';

export async function createTestStorage(): Promise<{
  mongod: MongoMemoryServer;
  client: MongoClient;
  uri: string;
  dbName: string;
  stop: () => Promise<void>;
}> {
  const mongod = await getSharedMongod();
  const uri = mongod.getUri();
  const dbName = mongod.instanceInfo?.dbName || 'test';
  const client = new MongoClient(uri);
  await client.connect();

  async function stop() {
    try { await client.close(); } catch (e) {}
    await releaseSharedMongod();
  }

  return { mongod, client, uri, dbName, stop };
}
