import { MongoClient, type Db, Collection } from 'mongodb';
import { createLogger } from '../logging/logger.js';
import { COLLECTIONS, INDEXES, ExtractionQueueDocument, JobLifecycleDocument } from './schemas.js';

const logger = createLogger('MongoIntializer');

export class MongoInitializer {
  private db: Db;

  constructor(
    private client: MongoClient,
    private dbName: string
  ) {
    this.db = this.client.db(this.dbName);
  }

  async init(): Promise<void> {
    await this.ensureCollectionExists();
    await this.ensureIndexes();
    logger.info('MongoInitializer completed', { dbName: this.dbName });
  }

  get dbInstance(): Db {
    return this.db;
  }

  private async ensureIndexes(): Promise<void> {
    const jobLifecycleCollection = this.db.collection<JobLifecycleDocument>(
      COLLECTIONS.JOB_LIFECYCLE
    );
    for (const index of INDEXES.JOB_LIFECYCLE) {
      const opts: Record<string, unknown> = { name: index.name };
      if (index.unique) opts.unique = true;
      await jobLifecycleCollection.createIndex(
        index.key as unknown as Record<string, number>,
        opts
      );
    }

    const extractionQueueCollection = this.db.collection<ExtractionQueueDocument>(
      COLLECTIONS.EXTRACTION_QUEUE
    );
    for (const index of INDEXES.EXTRACTION_QUEUE) {
      const opts: Record<string, unknown> = { name: index.name };
      await extractionQueueCollection.createIndex(
        index.key as unknown as Record<string, number>,
        opts
      );
    }
  }

  private async ensureCollectionExists(): Promise<void> {
    const collections = await this.db.listCollections().toArray();
    const collectionNames = collections.map((col) => col.name);

    if (!collectionNames.includes(COLLECTIONS.JOB_LIFECYCLE)) {
      await this.db.createCollection(COLLECTIONS.JOB_LIFECYCLE);
      logger.info(`Created collection: ${COLLECTIONS.JOB_LIFECYCLE}`);
    }

    if (!collectionNames.includes(COLLECTIONS.EXTRACTION_QUEUE)) {
      await this.db.createCollection(COLLECTIONS.EXTRACTION_QUEUE);
      logger.info(`Created collection: ${COLLECTIONS.EXTRACTION_QUEUE}`);
    }
  }
}
