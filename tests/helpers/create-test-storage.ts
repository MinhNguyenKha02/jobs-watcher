import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

export async function createTestStorage(): Promise<{
  mongod: MongoMemoryServer;
  client: MongoClient;
  uri: string;
  dbName: string;
  stop: () => Promise<void>;
}> {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  const dbName = mongod.instanceInfo?.dbName || 'test';
  const client = new MongoClient(uri);
  await client.connect();

  async function stop() {
    try { await client.close(); } catch (e) {}
    try { await mongod.stop(); } catch (e) {}
  }

  return { mongod, client, uri, dbName, stop };
}
