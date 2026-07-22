import { MongoClient } from 'mongodb';
import { getLogger } from '../logging/logger.js';

const logger = getLogger();

export async function validateMongoTopology(uri: string, env = process.env.NODE_ENV || 'development') {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const admin = client.db('admin');
    // `isMaster`/`hello` response contains replica set name when part of a replSet
    let info: any = null;
    try {
      info = await admin.command({ isMaster: 1 });
    } catch (e) {
      // Older/newer servers may prefer 'hello'
      try { info = await admin.command({ hello: 1 }); } catch (ee) { info = null; }
    }

    const isReplica = !!(info && (info.setName || info.replicaSet));
    if (!isReplica) {
      const msg = 'MongoDB is not part of a replica set; change streams and transactions require a replica set.';
      if (env === 'production') {
        logger.error(msg);
        throw new Error(msg);
      }
      logger.warn(msg + ' Continuing in non-production mode with polling fallback.');
    } else {
      logger.info('MongoDB topology: replica set detected', { setName: info.setName || info.replicaSet });
    }
  } finally {
    try { await client.close(); } catch (_) {}
  }
}

export default validateMongoTopology;
