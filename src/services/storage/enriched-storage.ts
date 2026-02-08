/**
 * Enriched Job Storage Service
 * Organizes and stores enriched job records with metadata in a structured format
 * Storage path: db/enriched/YYYY-MM/DD/{jobTitle-company-score}/
 */

import fs from 'fs';
import path from 'path';

import type { EnrichedJobMetadata, EnrichedJobRecord, EnrichedJobRecordFile } from '../types.js';

import { getLogger } from './logger.js';

export type { EnrichedJobMetadata, EnrichedJobRecord, EnrichedJobRecordFile } from '../types.js';

const logger = getLogger();

export class EnrichedStorage {
  constructor(private readonly dbPath: string) {}

  /**
   * Save a single enriched job with its metadata and HTML input
   * Creates a dedicated directory for each job with separate files for metadata, enriched data, and HTML
   */
  async saveEnrichedJob(
    record: EnrichedJobRecord
  ): Promise<{ dirPath: string; metadataFile: string; recordFile: string; htmlFile: string }> {
    try {
      const enrichedDir = await this.ensureEnrichedDir();
      const jobDirName = this.generateJobDirName(
        record.metadata.jobTitle,
        record.metadata.company,
        record.metadata.matchScore
      );
      const jobDir = path.join(enrichedDir, jobDirName);

      // Create job-specific directory
      await fs.promises.mkdir(jobDir, { recursive: true });

      // Save metadata
      const metadataFile = path.join(jobDir, 'metadata.json');
      await fs.promises.writeFile(
        metadataFile,
        JSON.stringify(record.metadata, null, 2),
        'utf-8'
      );

      // Save enriched record
      const recordFile = path.join(jobDir, 'enriched-record.json');
      const recordFileContents: EnrichedJobRecordFile = {
        original: record.original,
        enriched: record.enriched,
      };

      await fs.promises.writeFile(
        recordFile,
        JSON.stringify(recordFileContents, null, 2),
        'utf-8'
      );

      // Save HTML input as reference
      const htmlFile = path.join(jobDir, 'pasted-html.html');
      await fs.promises.writeFile(htmlFile, record.htmlInput, 'utf-8');

      logger.info(`\n   ✅ Enriched job saved:`);
      logger.info(`      Directory: ${jobDir}`);
      logger.info(`      Metadata:  ${metadataFile}`);
      logger.info(`      Record:    ${recordFile}`);
      logger.info(`      HTML:      ${htmlFile}\n`);

      return {
        dirPath: jobDir,
        metadataFile,
        recordFile,
        htmlFile,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`   ❌ Failed to save enriched job: ${msg}`);
      throw error;
    }
  }

  /**
   * Save batch of enriched jobs
   */
  async saveEnrichedJobBatch(
    records: EnrichedJobRecord[]
  ): Promise<Map<string, { dirPath: string; metadataFile: string; recordFile: string; htmlFile: string }>> {
    const results = new Map();

    for (const record of records) {
      try {
        const result = await this.saveEnrichedJob(record);
        results.set(record.metadata.messageId, result);
      } catch (error) {
        logger.warn(
          `   ⚠️  Skipped saving enriched job ${record.metadata.messageId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return results;
  }

  /**
   * Load metadata for a specific enriched job
   */
  async loadEnrichedJobMetadata(jobDir: string): Promise<EnrichedJobMetadata | null> {
    try {
      const metadataFile = path.join(jobDir, 'metadata.json');
      if (!fs.existsSync(metadataFile)) {
        return null;
      }

      const content = await fs.promises.readFile(metadataFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.warn(`Failed to load metadata from ${jobDir}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * List all enriched jobs for a given date
   */
  async listEnrichedJobs(date: Date = new Date()): Promise<{ jobDir: string; metadata: EnrichedJobMetadata }[]> {
    try {
      const enrichedDir = await this.ensureEnrichedDir(date);
      const jobDirs = await fs.promises.readdir(enrichedDir);

      const jobs: { jobDir: string; metadata: EnrichedJobMetadata }[] = [];

      for (const jobDir of jobDirs) {
        const fullPath = path.join(enrichedDir, jobDir);
        const stat = await fs.promises.stat(fullPath);

        if (stat.isDirectory()) {
          const metadata = await this.loadEnrichedJobMetadata(fullPath);
          if (metadata) {
            jobs.push({ jobDir: fullPath, metadata });
          }
        }
      }

      return jobs;
    } catch (error) {
      logger.warn(
        `Failed to list enriched jobs: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /**
   * Get summary statistics of enriched jobs
   */
  async getEnrichedJobsStats(date: Date = new Date()): Promise<{
    totalJobs: number;
    byAction: Record<string, number>;
    avgMatchScore: number;
    byCompany: Record<string, number>;
  }> {
    const jobs = await this.listEnrichedJobs(date);

    const stats = {
      totalJobs: jobs.length,
      byAction: {} as Record<string, number>,
      avgMatchScore: 0,
      byCompany: {} as Record<string, number>,
    };

    let totalScore = 0;

    for (const job of jobs) {
      // Count by action
      const action = job.metadata.action || 'unknown';
      stats.byAction[action] = (stats.byAction[action] || 0) + 1;

      // Track score
      totalScore += job.metadata.matchScore;

      // Count by company
      const company = job.metadata.company;
      stats.byCompany[company] = (stats.byCompany[company] || 0) + 1;
    }

    if (jobs.length > 0) {
      stats.avgMatchScore = Math.round((totalScore / jobs.length) * 10) / 10;
    }

    return stats;
  }

  /**
   * Generate a safe filename from job details
   * Format: jobTitle-company-score-timestamp
   */
  private generateJobDirName(jobTitle: string, company: string, matchScore: number): string {
    const sanitize = (str: string) => str.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 30);
    const timestamp = Date.now().toString().slice(-6);
    return `${sanitize(jobTitle)}-${sanitize(company)}-${matchScore}-${timestamp}`;
  }

  /**
   * Ensure enriched directory exists for given date
   */
  private async ensureEnrichedDir(date: Date = new Date()): Promise<string> {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const enrichedDir = path.join(this.dbPath, 'enriched', `${year}-${month}`, day);
    await fs.promises.mkdir(enrichedDir, { recursive: true });

    return enrichedDir;
  }
}
