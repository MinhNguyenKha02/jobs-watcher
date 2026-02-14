/**
 * Storage module exports
 */

export type {
  RawIngestDocument,
  ParseLogDocument,
  ParseFailureReport,
  ParserSuccessRate,
} from './schemas.js';

export {
  COLLECTIONS,
  STORAGE_INDEXES,
} from './schemas.js';

export {
  MongoDBStorageAdapter,
  createMongoDBStorageAdapter,
  type StorageAdapterConfig,
} from './mongodb-storage-adapter.js';
