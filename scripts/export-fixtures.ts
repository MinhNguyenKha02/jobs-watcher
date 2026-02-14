/**
 * Export failed parse records from MongoDB to JSON fixtures
 * 
 * Usage:
 *   npm run export-fixtures       # Export failed parses only
 *   npm run export-fixtures -- --all   # Export all parses (success + fail)
 *   npm run export-fixtures -- --stage METADATA  # Filter by stage
 * 
 * Outputs:
 *   - tests/__fixtures__/failed-parses.json: Failed parse records
 *   - tests/__fixtures__/parse-samples.json: Representative samples
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'tests', '__fixtures__');

interface ExportOptions {
  mongoUri?: string;
  dbName?: string;
  stage?: 'METADATA' | 'JOB_DETAIL' | null;
  includeSuccess?: boolean;
  limit?: number;
}

// eslint-disable-next-line no-console
async function exportFixtures(options: ExportOptions = {}): Promise<void> {
  const mongoUri = options.mongoUri || process.env.MONGODB_URI;
  const dbName = options.dbName || process.env.MONGODB_DB_NAME || 'jobs_watcher';

  if (!mongoUri) {
    // eslint-disable-next-line no-console
    console.error('❌ MONGODB_URI environment variable not set');
    // eslint-disable-next-line no-console
    console.error('   Set it in .env or pass --mongo-uri flag');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    // eslint-disable-next-line no-console
    console.log('✅ Connected to MongoDB');

    const db = client.db(dbName);
    const parseLogCollection = db.collection('parse_log');
    const rawIngestCollection = db.collection('raw_ingest');

    // Build query
    const query: Record<string, unknown> = {};
    if (!options.includeSuccess) {
      query.success = false;
    }
    if (options.stage) {
      query.stage = options.stage;
    }

    // Get failed parses
    // eslint-disable-next-line no-console
    console.log('📥 Fetching parse logs...');
    const parseLogs = await parseLogCollection
      .find(query)
      .sort({ timestamp: -1 })
      .limit(options.limit || 1000)
      .toArray();

    // eslint-disable-next-line no-console
    console.log(`📊 Found ${parseLogs.length} parse logs`);

    // Enrich with raw content
    const enrichedFailures = [];
    for (const log of parseLogs) {
      const rawIngest = await rawIngestCollection.findOne({
        _id: log.rawIngestId,
      });

      enrichedFailures.push({
        parseLogId: log._id?.toString(),
        rawIngestId: log.rawIngestId,
        source: rawIngest?.source || 'UNKNOWN',
        stage: log.stage,
        errorCode: log.error?.code,
        errorMessage: log.error?.message,
        rawContent: rawIngest?.rawContent || '',
        gmailMeta: rawIngest?.gmailMeta,
        timestamp: log.timestamp,
        executionMs: log.executionMs,
      });
    }

    // Ensure fixtures directory exists
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
      // eslint-disable-next-line no-console
      console.log(`📁 Created ${FIXTURES_DIR}`);
    }

    // Write failed parses
    const failedPath = path.join(FIXTURES_DIR, 'failed-parses.json');
    fs.writeFileSync(failedPath, JSON.stringify(enrichedFailures, null, 2), 'utf-8');
    // eslint-disable-next-line no-console
    console.log(`✅ Exported ${enrichedFailures.length} failed parses to ${failedPath}`);

    // Generate samples (success + fail, all stages)
    const sampleQuery = {};
    const samples = await parseLogCollection
      .find(sampleQuery)
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    const enrichedSamples = [];
    for (const log of samples) {
      const rawIngest = await rawIngestCollection.findOne({
        _id: log.rawIngestId,
      });

      enrichedSamples.push({
        parseLogId: log._id?.toString(),
        rawIngestId: log.rawIngestId,
        source: rawIngest?.source || 'UNKNOWN',
        stage: log.stage,
        success: log.success,
        extracted: log.extracted,
        error: log.error,
        rawContent: rawIngest?.rawContent?.substring(0, 500) || '', // Truncate for samples
        gmailMeta: rawIngest?.gmailMeta,
        timestamp: log.timestamp,
      });
    }

    const samplesPath = path.join(FIXTURES_DIR, 'parse-samples.json');
    fs.writeFileSync(samplesPath, JSON.stringify(enrichedSamples, null, 2), 'utf-8');
    // eslint-disable-next-line no-console
    console.log(`✅ Exported ${enrichedSamples.length} parse samples to ${samplesPath}`);

    // Summary stats
    const stats = {
      exportedAt: new Date().toISOString(),
      totalFailures: enrichedFailures.length,
      totalSamples: enrichedSamples.length,
      byStage: {
        METADATA: enrichedFailures.filter((f) => f.stage === 'METADATA').length,
        JOB_DETAIL: enrichedFailures.filter((f) => f.stage === 'JOB_DETAIL').length,
      },
      bySource: {
        GMAIL_WEBHOOK: enrichedFailures.filter((f) => f.source === 'GMAIL_WEBHOOK').length,
        GMAIL_MANUAL: enrichedFailures.filter((f) => f.source === 'GMAIL_MANUAL').length,
        HTML_ONLY: enrichedFailures.filter((f) => f.source === 'HTML_ONLY').length,
      },
    };

    const statsPath = path.join(FIXTURES_DIR, 'export-stats.json');
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf-8');
    // eslint-disable-next-line no-console
    console.log(`\n📈 Export Statistics:`);
    // eslint-disable-next-line no-console
    console.log(`   Total failures: ${stats.totalFailures}`);
    // eslint-disable-next-line no-console
    console.log(`   By stage: METADATA=${stats.byStage.METADATA}, JOB_DETAIL=${stats.byStage.JOB_DETAIL}`);
    // eslint-disable-next-line no-console
    console.log(`   By source: GMAIL_WEBHOOK=${stats.bySource.GMAIL_WEBHOOK}, GMAIL_MANUAL=${stats.bySource.GMAIL_MANUAL}, HTML_ONLY=${stats.bySource.HTML_ONLY}`);

    // eslint-disable-next-line no-console
    console.log(`\n✅ Export complete - fixtures ready for parser regression testing`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(`❌ Export failed: ${errorMessage}`);
    process.exit(1);
  } finally {
    await client.close();
    // eslint-disable-next-line no-console
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Parse CLI arguments
const args = process.argv.slice(2);
const options: ExportOptions = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mongo-uri') {
    options.mongoUri = args[++i];
  } else if (args[i] === '--db-name') {
    options.dbName = args[++i];
  } else if (args[i] === '--stage') {
    options.stage = args[++i] as 'METADATA' | 'JOB_DETAIL';
  } else if (args[i] === '--all') {
    options.includeSuccess = true;
  } else if (args[i] === '--limit') {
    options.limit = parseInt(args[++i]);
  }
}

exportFixtures(options);
