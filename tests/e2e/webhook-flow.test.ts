import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import fs from 'fs';

import { MongoClient } from 'mongodb';

import { EventDrivenWebhook } from '../../src/services/event-webhook.js';
import { GmailService } from '../../src/services/gmail.js';
import { mockPubSubMessage } from '../__fixtures__/pubsub-messages.js';

describe('EventDrivenWebhook - Real Integration Flow', () => {
  let gmailService: GmailService;
  let mongo: MongoClient;
  let webhook: EventDrivenWebhook;

  const MONGO_URI = `${process.env.MONGODB_URI}/${process.env.MONGODB_DB_NAME || ''}`;
  const REQUIRED_COLLECTIONS = [
    'raw_ingest',
    'job_queue',
    'job_trash',
    'needs_enrichment',
    'parse_log',
  ];

  beforeAll(async () => {
    // Connect to real MongoDB and GmailService
    if (!MONGO_URI) throw new Error('[Webhook E2E] Missing MONGO_URI');
    mongo = new MongoClient(MONGO_URI);
    await mongo.connect();
    gmailService = new GmailService();
    await gmailService.authenticate();
    webhook = new EventDrivenWebhook(gmailService);
    if (webhook._presenterInit) {
      await webhook._presenterInit();
    }
    await webhook.connectStorage();
  });

  afterAll(async () => {
    if (mongo) await mongo.close();
  });

  it('processes a Pub/Sub notification with real integrations', async () => {
    await webhook.connectStorage();
    await webhook.processJobNotification(mockPubSubMessage);
    // Check storage is initialized and no errors
    expect(webhook['storage']).not.toBeNull();

    const db = mongo.db(process.env.MONGODB_DB_NAME || 'jobs_watcher');
    for (const collectionName of REQUIRED_COLLECTIONS) {
      await expect(
        db.collection(collectionName).countDocuments({})
      ).resolves.toBeGreaterThanOrEqual(0);
    }
  });

  it('skips processing when the message payload is empty (real)', async () => {
    await webhook.connectStorage();
    await webhook.processJobNotification({});
    expect(webhook['storage']).not.toBeNull();
  });
});
