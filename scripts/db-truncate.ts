import { MongoClient } from 'mongodb';

async function main() {
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB_NAME ?? process.env.MONGODB_DB ?? 'jobs_watcher';

  const client = new MongoClient(uri);
  try {
    console.log(`Connecting to ${uri} (db: ${dbName})`);
    await client.connect();
    const db = client.db(dbName);

    const collections = ['job_queue', 'job_trash', 'parse_log', 'action_log', 'raw_ingest'];

    const skipConfirm = !!process.env.SKIP_CONFIRM;
    if (!skipConfirm) {
      process.stdout.write(
        `About to empty collections: ${collections.join(', ')}. Type YES to continue: `
      );
      const buf = Buffer.alloc(64);
      const n = await new Promise<number>((res) => {
        process.stdin.once('data', (d: Buffer) => res(d.copy(buf)));
      });
      const answer = buf.slice(0, n).toString().trim();
      if (answer !== 'YES') {
        console.log('Aborted by user.');
        return;
      }
    }

    for (const name of collections) {
      const col = db.collection(name);
      const count = await col.countDocuments();
      if (count === 0) {
        console.log(`${name}: already empty`);
        continue;
      }
      const res = await col.deleteMany({});
      console.log(`${name}: deleted ${res.deletedCount ?? 0} documents`);
    }

    console.log('Truncate complete.');
  } catch (err) {
    console.error('Error truncating DB:', err);
    process.exitCode = 2;
  } finally {
    await client.close();
  }
}

main();
