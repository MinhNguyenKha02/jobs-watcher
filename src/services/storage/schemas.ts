/**
 * MongoDB Schema Definitions
 * 
 * Two-collection immutable/append-only design for audit trail:
 * - raw_ingest: Authoritative input from GMAIL_WEBHOOK, GMAIL_MANUAL, or HTML_ONLY sources
 * - parse_log: Append-only parse attempts with METADATA and JOB_DETAIL stages
 */

/**
 * Raw Ingest Document
 * Immutable collection storing original input (email or HTML)
 * Single source of truth for all parsing attempts
 */
export interface RawIngestDocument {
  _id?: string | { toString(): string };  // MongoDB ObjectId or messageId
  
  // Source classification
  source: 'GMAIL_WEBHOOK' | 'GMAIL_MANUAL' | 'HTML_ONLY';
  
  // Mode of input (for analytics/debugging)
  mode?: 'production' | 'testing' | 'manual';
  
  // Original raw content
  rawContent: string;
  
  // Gmail-specific metadata (if from Gmail)
  gmailMeta?: {
    messageId: string;
    threadId?: string;
    labelIds?: string[];
    snippet?: string;
    internalDate?: number;
    from?: string;
    to?: string;
    subject?: string;
  };
  
  // HTML-specific metadata (if from HTML paste)
  htmlMeta?: {
    url?: string;
    title?: string;
    description?: string;
  };
  
  // Timestamps
  ingestedAt: Date;
  createdAt: Date;
  
  // Tracking
  parseLogIds?: string[];
  lastParsedAt?: Date;
}

/**
 * Parse Log Document
 * Append-only collection tracking each parse attempt
 * Enables audit trail and failure pattern analysis
 */
export interface ParseLogDocument {
  _id?: string | { toString(): string };  // MongoDB ObjectId
  
  // Link to raw ingest document
  rawIngestId: string;
  
  // Parse stage
  stage: 'METADATA' | 'JOB_DETAIL';
  
  // Success/failure status
  success: boolean;
  
  // Extracted fields (if successful)
  extracted?: {
    company?: string;
    title?: string;
    salary?: string;
    location?: string;
    jobUrl?: string;
    description?: string;
    [key: string]: string | undefined;
  };
  
  // Error details (if failed)
  error?: {
    code: string;
    message: string;
    context?: Record<string, unknown>;
  };
  
  // Execution metrics
  executionMs: number;
  timestamp: Date;
  
  // Parser version for regression tracking
  parserVersion?: string;
  
  // Constraints results (if applicable)
  constraints?: {
    validated: boolean;
    violations?: string[];
  };
}

/**
 * Query result types for common operations
 */
export interface ParseFailureReport {
  rawIngestId: string;
  stage: 'METADATA' | 'JOB_DETAIL';
  source: 'GMAIL_WEBHOOK' | 'GMAIL_MANUAL' | 'HTML_ONLY';
  errorCode: string;
  errorMessage: string;
  rawContent: string;
  attemptCount: number;
  firstFailedAt: Date;
  lastAttemptAt: Date;
}

export interface ParserSuccessRate {
  source: 'GMAIL_WEBHOOK' | 'GMAIL_MANUAL' | 'HTML_ONLY' | 'ALL';
  stage: 'METADATA' | 'JOB_DETAIL' | 'ALL';
  total: number;
  successful: number;
  failed: number;
  successPercentage: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * MongoDB Index definitions for optimal querying
 */
export const STORAGE_INDEXES = {
  rawIngest: [
    { key: { source: 1, ingestedAt: -1 }, name: 'idx_source_ingested' },
    { key: { ingestedAt: -1 }, name: 'idx_ingested' },
    { key: { 'gmailMeta.messageId': 1 }, unique: true, sparse: true, name: 'idx_messageId' },
  ],
  parseLog: [
    { key: { rawIngestId: 1, stage: 1 }, name: 'idx_rawId_stage' },
    { key: { rawIngestId: 1, timestamp: -1 }, name: 'idx_rawId_time' },
    { key: { stage: 1, success: 1, timestamp: -1 }, name: 'idx_stage_status_time' },
    { key: { source: 1, timestamp: -1 }, name: 'idx_source_time' },
  ],
};

/**
 * Collection names
 */
export const COLLECTIONS = {
  RAW_INGEST: 'raw_ingest',
  PARSE_LOG: 'parse_log',
} as const;
