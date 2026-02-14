import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

import { EmailParser } from '../src/services/parsers/email-parser.js';

interface SeedOptions {
  date: string;
  limit?: number;
  mongoUri: string;
  dbName: string;
  source: 'GMAIL_MANUAL';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);
  const options: Partial<SeedOptions> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date') options.date = args[++i];
    if (args[i] === '--limit') options.limit = parseInt(args[++i], 10);
    if (args[i] === '--mongo-uri') options.mongoUri = args[++i];
    if (args[i] === '--db-name') options.dbName = args[++i];
  }

  const date = options.date || process.env.DATE || '2026-01-28';
  const mongoUri = options.mongoUri || process.env.MONGODB_URI || '';
  const dbName = options.dbName || process.env.MONGODB_DB_NAME || 'jobs_watcher';

  if (!mongoUri) {
    throw new Error('MONGODB_URI required (set env or pass --mongo-uri)');
  }

  return {
    date,
    limit: options.limit,
    mongoUri,
    dbName,
    source: 'GMAIL_MANUAL',
  };
}

async function main(): Promise<void> {
  const options = parseArgs();
  const [year, month, day] = options.date.split('-');
  const emailDir = path.join(process.cwd(), 'src', 'db', 'emails', `${year}-${month}`, day);
  const jsonlFile = path.join(emailDir, 'raw-emails.jsonl');

  if (!fs.existsSync(jsonlFile)) {
    throw new Error(`raw-emails.jsonl not found at ${jsonlFile}`);
  }

  const lines = fs.readFileSync(jsonlFile, 'utf-8').trim().split('\n');
  const records = lines.map((line) => JSON.parse(line));
  const limitedRecords = typeof options.limit === 'number' ? records.slice(0, options.limit) : records;

  const client = new MongoClient(options.mongoUri);
  const parser = new EmailParser();

  await client.connect();
  const db = client.db(options.dbName);
  const rawIngest = db.collection('raw_ingest');
  const parseLog = db.collection('parse_log');

  for (const entry of limitedRecords) {
    const messageId = entry.messageId;
    const bodyFile = path.join(emailDir, `${messageId}.body.txt`);

    if (!fs.existsSync(bodyFile)) {
      // Skip if body not found
      continue;
    }

    const body = fs.readFileSync(bodyFile, 'utf-8');
    const rawDoc = {
      source: options.source,
      mode: 'testing',
      rawContent: body,
      gmailMeta: {
        messageId,
        from: entry.from,
        subject: entry.subject,
      },
      ingestedAt: new Date(),
      createdAt: new Date(),
    };

    await rawIngest.updateOne(
      { 'gmailMeta.messageId': messageId },
      { $setOnInsert: rawDoc },
      { upsert: true }
    );

    const inserted = await rawIngest.findOne({ 'gmailMeta.messageId': messageId });
    const rawIngestId = inserted?._id?.toString();

    if (!rawIngestId) {
      continue;
    }

    const input = {
      emailId: messageId,
      subject: entry.subject || '(no subject)',
      from: entry.from || '(unknown sender)',
      body,
      receivedAt: new Date(entry.timestamp || Date.now()),
    };

    const metadata = parser.parseMetadata(input);
    const detail = parser.parseJobDetail(input);

    await parseLog.insertOne({
      rawIngestId,
      stage: 'METADATA',
      success: metadata.errors.length === 0,
      extracted: {
        company: metadata.company,
        position: metadata.position,
        salary: metadata.salary,
        location: metadata.location,
      },
      error: metadata.errors.length
        ? { code: 'SEED_METADATA_FAILED', message: metadata.errors.join('; ') }
        : undefined,
      executionMs: 0,
      timestamp: new Date(),
    });

    await parseLog.insertOne({
      rawIngestId,
      stage: 'JOB_DETAIL',
      success: detail.errors.length === 0,
      extracted: {
        url: detail.url,
        description: detail.description,
      },
      error: detail.errors.length
        ? { code: 'SEED_DETAIL_FAILED', message: detail.errors.join('; ') }
        : undefined,
      executionMs: 0,
      timestamp: new Date(),
    });
  }

  await client.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`seed-test-db failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
