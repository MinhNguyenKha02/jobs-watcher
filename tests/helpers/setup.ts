import { MongoMemoryServer } from 'mongodb-memory-server';

let sharedMongod: MongoMemoryServer | null = null;
let refCount = 0;

export async function getSharedMongod(): Promise<MongoMemoryServer> {
  if (!sharedMongod) {
    sharedMongod = await MongoMemoryServer.create();
  }
  refCount++;
  return sharedMongod;
}

export async function releaseSharedMongod(): Promise<void> {
  refCount--;
  if (refCount <= 0 && sharedMongod) {
    const instance = sharedMongod;
    sharedMongod = null;
    await instance.stop();
  }
}

export function getSharedMongodRefCount(): number {
  return refCount;
}
