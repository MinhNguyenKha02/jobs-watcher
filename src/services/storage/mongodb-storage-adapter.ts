/**
 * MongoDB Storage Adapter
 * 
 * Implements immutable/append-only pattern:
 * - raw_ingest: Insert once, never update
 * - parse_log: Append parse attempts only
 * 
 * Provides idempotent operations for resilient data ingestion
 */

import { MongoClient, Db, Collection } from 'mongodb';
import type { Filter } from 'mongodb';

import { type ILogger } from '../logger';
import {
  RawIngestDocument,
  ParseLogDocument,
  ParseFailureReport,
  ParserSuccessRate,
  COLLECTIONS,
  STORAGE_INDEXES,
} from './schemas';

export interface StorageAdapterConfig {
  mongoUri: string;
  dbName: string;
  logger: ILogger;
}

export class MongoDBStorageAdapter {
  private client: MongoClient;
  private db: Db | null = null;
  private rawIngestCollection: Collection<RawIngestDocument> | null = null;
  private parseLogCollection: Collection<ParseLogDocument> | null = null;
  private logger: ILogger;
  private mongoUri: string;
  private dbName: string;

  constructor(config: StorageAdapterConfig) {
    this.mongoUri = config.mongoUri;
    this.dbName = config.dbName;
    this.logger = config.logger;
    this.client = new MongoClient(this.mongoUri);
  }

  /**
   * Initialize connection and create indexes
   */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.db = this.client.db(this.dbName);

      // Get or create collections
      this.rawIngestCollection = this.db.collection<RawIngestDocument>(
        COLLECTIONS.RAW_INGEST
      );
      this.parseLogCollection = this.db.collection<ParseLogDocument>(
        COLLECTIONS.PARSE_LOG
      );

      // Create indexes for optimal querying
      await this.createIndexes();

      this.logger.info('MongoDB storage adapter connected', {
        uri: this.mongoUri.replace(/:[^/]*@/, ':***@'), // Hide password
        db: this.dbName,
      });
    } catch (error) {
      this.logger.error('Failed to connect MongoDB', { error });
      throw error;
    }
  }

  /**
   * Close MongoDB connection
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.close();
      this.logger.info('MongoDB storage adapter disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting MongoDB', { error });
      throw error;
    }
  }

  /**
   * Create indexes for optimal query performance
   */
  private async createIndexes(): Promise<void> {
    if (!this.rawIngestCollection || !this.parseLogCollection) return;

    try {
      // Raw ingest indexes
      for (const idx of STORAGE_INDEXES.rawIngest) {
        const indexOptions: Record<string, unknown> = { name: idx.name };
        if ('unique' in idx && idx.unique) indexOptions.unique = true;
        if ('sparse' in idx && idx.sparse) indexOptions.sparse = true;
        await this.rawIngestCollection.createIndex(idx.key, indexOptions);
      }

      // Parse log indexes
      for (const idx of STORAGE_INDEXES.parseLog) {
        const indexOptions: Record<string, unknown> = { name: idx.name };
        if ('unique' in idx && idx.unique) indexOptions.unique = true;
        if ('sparse' in idx && idx.sparse) indexOptions.sparse = true;
        await this.parseLogCollection.createIndex(idx.key, indexOptions);
      }

      this.logger.debug('MongoDB indexes created successfully');
    } catch (error) {
      this.logger.warn('Error creating indexes (may already exist)', { error });
    }
  }

  /**
   * Save raw ingest document (idempotent by messageId if from Gmail)
   */
  async saveRawIngest(doc: RawIngestDocument): Promise<string> {
    if (!this.rawIngestCollection) {
      throw new Error('Storage not initialized. Call connect() first.');
    }

    try {
      let _insertResult;

      // For Gmail sources, use upsert on messageId for idempotency
      if (doc.source === 'GMAIL_WEBHOOK' || doc.source === 'GMAIL_MANUAL') {
        if (!doc.gmailMeta?.messageId) {
          throw new Error('Gmail sources must include gmailMeta.messageId');
        }

        _insertResult = await this.rawIngestCollection.updateOne(
          { 'gmailMeta.messageId': doc.gmailMeta.messageId },
          {
            $setOnInsert: {
              ...doc,
              createdAt: new Date(),
              ingestedAt: doc.ingestedAt || new Date(),
            },
          },
          { upsert: true }
        );

        // For upsert, use messageId as _id equivalent
        const existing = await this.rawIngestCollection.findOne({
          'gmailMeta.messageId': doc.gmailMeta.messageId,
        });
        return existing?._id?.toString() || doc.gmailMeta.messageId;
      } else {
        // For HTML_ONLY, insert new document
        const insertResult = await this.rawIngestCollection.insertOne({
          ...doc,
          createdAt: new Date(),
          ingestedAt: doc.ingestedAt || new Date(),
        });
        return insertResult.insertedId.toString();
      }
    } catch (error) {
      this.logger.error('Failed to save raw ingest', { error, source: doc.source });
      throw error;
    }
  }

  /**
   * Log a parse attempt (append-only)
   */
  async logParseAttempt(log: ParseLogDocument): Promise<string> {
    if (!this.parseLogCollection) {
      throw new Error('Storage not initialized. Call connect() first.');
    }

    try {
      const result = await this.parseLogCollection.insertOne({
        ...log,
        timestamp: log.timestamp || new Date(),
      });
      return result.insertedId.toString();
    } catch (error) {
      this.logger.error('Failed to log parse attempt', { error });
      throw error;
    }
  }

  /**
   * Get failed parses for a specific stage (for regression testing)
   */
  async getFailedParsesByStage(
    stage: 'METADATA' | 'JOB_DETAIL',
    limit: number = 100
  ): Promise<ParseFailureReport[]> {
    if (!this.rawIngestCollection || !this.parseLogCollection) {
      throw new Error('Storage not initialized. Call connect() first.');
    }

    try {
      const pipeline = [
        {
          $match: {
            stage,
            success: false,
          },
        },
        {
          $group: {
            _id: '$rawIngestId',
            errorCode: { $first: '$error.code' },
            errorMessage: { $first: '$error.message' },
            attemptCount: { $sum: 1 },
            firstFailedAt: { $min: '$timestamp' },
            lastAttemptAt: { $max: '$timestamp' },
          },
        },
        {
          $lookup: {
            from: COLLECTIONS.RAW_INGEST,
            localField: '_id',
            foreignField: '_id',
            as: 'rawIngest',
          },
        },
        {
          $unwind: '$rawIngest',
        },
        {
          $project: {
            rawIngestId: '$_id',
            stage,
            source: '$rawIngest.source',
            errorCode: 1,
            errorMessage: 1,
            rawContent: '$rawIngest.rawContent',
            attemptCount: 1,
            firstFailedAt: 1,
            lastAttemptAt: 1,
          },
        },
        { $limit: limit },
      ];

      const results = await this.parseLogCollection.aggregate<ParseFailureReport>(pipeline).toArray();
      return results;
    } catch (error) {
      this.logger.error('Failed to get failed parses', { error, stage });
      throw error;
    }
  }

  /**
   * Get all raw ingest documents by source
   */
  async getRawBySource(
    source: 'GMAIL_WEBHOOK' | 'GMAIL_MANUAL' | 'HTML_ONLY',
    limit: number = 1000
  ): Promise<RawIngestDocument[]> {
    if (!this.rawIngestCollection) {
      throw new Error('Storage not initialized. Call connect() first.');
    }

    try {
      return await this.rawIngestCollection
        .find({ source })
        .sort({ ingestedAt: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      this.logger.error('Failed to get raw by source', { error, source });
      throw error;
    }
  }

  /**
   * Get full parse history for a raw ingest document
   */
  async getParseHistory(rawIngestId: string): Promise<ParseLogDocument[]> {
    if (!this.parseLogCollection) {
      throw new Error('Storage not initialized. Call connect() first.');
    }

    try {
      return await this.parseLogCollection
        .find({ rawIngestId })
        .sort({ timestamp: -1 })
        .toArray();
    } catch (error) {
      this.logger.error('Failed to get parse history', { error, rawIngestId });
      throw error;
    }
  }

  /**
   * Calculate success rate by source and stage
   */
  async getSuccessRateBySource(
    source?: 'GMAIL_WEBHOOK' | 'GMAIL_MANUAL' | 'HTML_ONLY' | 'ALL',
    stage?: 'METADATA' | 'JOB_DETAIL' | 'ALL',
    periodDays: number = 30
  ): Promise<ParserSuccessRate> {
    if (!this.parseLogCollection || !this.rawIngestCollection) {
      throw new Error('Storage not initialized. Call connect() first.');
    }

    try {
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - periodDays);

      // Build match filters
      const matchFilters: Filter<ParseLogDocument> = {
        timestamp: { $gte: periodStart },
      };

      if (stage && stage !== 'ALL') {
        matchFilters.stage = stage;
      }

      // Get parse logs with source from joined raw ingest
      const pipeline = [
        { $match: matchFilters },
        {
          $lookup: {
            from: COLLECTIONS.RAW_INGEST,
            localField: 'rawIngestId',
            foreignField: '_id',
            as: 'rawIngest',
          },
        },
        {
          $unwind: '$rawIngest',
        },
      ];

      // Filter by source if specified
      if (source && source !== 'ALL') {
        pipeline.push({
          $match: { 'rawIngest.source': source },
        });
      }

      // Count successes and total
      const results = await this.parseLogCollection
        .aggregate([
          ...pipeline,
          {
            $facet: {
              stats: [
                {
                  $group: {
                    _id: null,
                    total: { $sum: 1 },
                    successful: {
                      $sum: { $cond: ['$success', 1, 0] },
                    },
                  },
                },
              ],
            },
          },
        ])
        .toArray();

      const stats = results[0]?.stats?.[0];
      if (!stats) {
        return {
          source: source || 'ALL',
          stage: stage || 'ALL',
          total: 0,
          successful: 0,
          failed: 0,
          successPercentage: 0,
          periodStart,
          periodEnd: new Date(),
        };
      }

      return {
        source: (source || 'ALL') as 'GMAIL_WEBHOOK' | 'GMAIL_MANUAL' | 'HTML_ONLY' | 'ALL',
        stage: (stage || 'ALL') as 'METADATA' | 'JOB_DETAIL' | 'ALL',
        total: stats.total,
        successful: stats.successful,
        failed: stats.total - stats.successful,
        successPercentage: (stats.successful / stats.total) * 100,
        periodStart,
        periodEnd: new Date(),
      };
    } catch (error) {
      this.logger.error('Failed to get success rate', { error, source, stage });
      throw error;
    }
  }

  /**
   * Get raw ingest by Gmail message ID
   */
  async getRawByMessageId(messageId: string): Promise<RawIngestDocument | null> {
    if (!this.rawIngestCollection) {
      throw new Error('Storage not initialized. Call connect() first.');
    }

    try {
      return await this.rawIngestCollection.findOne({
        'gmailMeta.messageId': messageId,
      });
    } catch (error) {
      this.logger.error('Failed to get raw by messageId', { error, messageId });
      throw error;
    }
  }

  /**
   * Get recent parses (for monitoring dashboard)
   */
  async getRecentParses(
    limit: number = 50,
    successOnly: boolean = false
  ): Promise<(ParseLogDocument & { rawIngest?: RawIngestDocument })[]> {
    if (!this.parseLogCollection) {
      throw new Error('Storage not initialized. Call connect() first.');
    }

    try {
      const matchFilter: Filter<ParseLogDocument> = {};
      if (successOnly) {
        matchFilter.success = true;
      }

      return await this.parseLogCollection
        .aggregate([
          { $match: matchFilter },
          {
            $lookup: {
              from: COLLECTIONS.RAW_INGEST,
              localField: 'rawIngestId',
              foreignField: '_id',
              as: 'rawIngest',
            },
          },
          { $unwind: { path: '$rawIngest', preserveNullAndEmptyArrays: true } },
          { $sort: { timestamp: -1 } },
          { $limit: limit },
        ])
        .toArray();
    } catch (error) {
      this.logger.error('Failed to get recent parses', { error });
      throw error;
    }
  }
}

/**
 * Factory function for easy instantiation
 */
export function createMongoDBStorageAdapter(
  mongoUri: string,
  dbName: string,
  logger: ILogger
): MongoDBStorageAdapter {
  return new MongoDBStorageAdapter({
    mongoUri,
    dbName,
    logger,
  });
}
