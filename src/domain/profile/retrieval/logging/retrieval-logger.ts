// src/services/profile/retrieval/logging/retrieval-logger.ts

/**
 * Retrieval logging layer for calibration, debugging, and learning loop.
 * Logs lexical hits, propagation traces, acceptance decisions, and ATS exposure.
 */

import { ResolutionStrength } from "../../types/retrieval.types.js";

export interface RetrievalLogEntry {
   timestamp: string;
   jobId: string;
   type: 'lexical-hit' | 'propagation' | 'acceptance' | 'ats-exposure' | 'evidence-attachment-missing' | 'resolution-classified' | 'evidence-ranked';
   data: Record<string, any>;
 }

export class RetrievalLogger {
  private static instance: RetrievalLogger;
  private readonly logs: RetrievalLogEntry[] = [];
  private readonly maxLogs = 1000; // Keep last 1000 entries

  private constructor() {}

  /**
   * Get singleton instance of the retrieval logger
   */
  public static getInstance(): RetrievalLogger {
    if (!RetrievalLogger.instance) {
      RetrievalLogger.instance = new RetrievalLogger();
    }
    return RetrievalLogger.instance;
  }

  /**
   * Log a lexical hit event
   */
  public logLexicalHit(
    jobId: string,
    anchorId: string,
    pattern: string,
    source: string,
    weight: number,
    score: number
  ): void {
    const entry: RetrievalLogEntry = {
      timestamp: new Date().toISOString(),
      jobId,
      type: 'lexical-hit',
      data: {
        anchorId,
        pattern,
        source,
        weight,
        score
      }
    };
    this.addLog(entry);
  }

  /**
   * Log a propagation event
   */
  public logPropagation(
    jobId: string,
    fromAnchorId: string,
    toAnchorId: string,
    edgeWeight: number,
    decayFactor: number,
    propagatedScore: number
  ): void {
    const entry: RetrievalLogEntry = {
      timestamp: new Date().toISOString(),
      jobId,
      type: 'propagation',
      data: {
        fromAnchorId,
        toAnchorId,
        edgeWeight,
        decayFactor,
        propagatedScore
      }
    };
    this.addLog(entry);
  }

  /**
   * Log an acceptance decision
   */
  public logAcceptance(
    jobId: string,
    anchorId: string,
    accepted: boolean,
    reason: string,
    score: number,
    confidence: number
  ): void {
    const entry: RetrievalLogEntry = {
      timestamp: new Date().toISOString(),
      jobId,
      type: 'acceptance',
      data: {
        anchorId,
        accepted,
        reason,
        score,
        confidence
      }
    };
    this.addLog(entry);
  }

   /**
    * Log an ATS exposure decision
    */
   public logAtsExposure(
     jobId: string,
     anchorId: string,
     anchorKind: string,
     skillName: string,
     visibility: 'primary' | 'secondary' | 'hidden',
     shown: boolean
   ): void {
     const entry: RetrievalLogEntry = {
       timestamp: new Date().toISOString(),
       jobId,
       type: 'ats-exposure',
       data: {
         anchorId,
         anchorKind,
         skillName,
         visibility,
         shown
       }
     };
     this.addLog(entry);
   }

   /**
    * Log an evidence attachment missing event
    */
   public logEvidenceAttachmentMissing(
     jobId: string,
     anchorId: string
   ): void {
     const entry: RetrievalLogEntry = {
       timestamp: new Date().toISOString(),
       jobId,
       type: 'evidence-attachment-missing',
       data: {
         anchorId,
         jobId
       }
     };
     this.addLog(entry);
   }

   /**
    * Log a resolution classification event
    */
   public logResolutionClassified(
     jobId: string,
     anchorId: string,
     finalScore: number,
     strength: ResolutionStrength
   ): void {
     const entry: RetrievalLogEntry = {
       timestamp: new Date().toISOString(),
       jobId,
       type: 'resolution-classified',
       data: {
         anchorId,
         finalScore,
         strength
       }
     };
     this.addLog(entry);
   }

   /**
    * Log an evidence ranked event
    */
   public logEvidenceRanked(
     jobId: string,
     evidenceId: string,
     score: number
   ): void {
     const entry: RetrievalLogEntry = {
       timestamp: new Date().toISOString(),
       jobId,
       type: 'evidence-ranked',
       data: {
         evidenceId,
         score
       }
     };
     this.addLog(entry);
   }

  /**
   * Get recent logs for debugging/calibration
   */
  public getRecentLogs(count: number = 100): RetrievalLogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Get logs by type for analysis
   */
  public getLogsByType(type: RetrievalLogEntry['type']): RetrievalLogEntry[] {
    return this.logs.filter(log => log.type === type);
  }

  /**
   * Get logs for a specific job
   */
  public getLogsByJobId(jobId: string): RetrievalLogEntry[] {
    return this.logs.filter(log => log.jobId === jobId);
  }

  /**
   * Clear all logs (useful for testing)
   */
  public clearLogs(): void {
    this.logs.length = 0;
  }

  /**
   * Add a log entry, maintaining the max size
   */
  private addLog(entry: RetrievalLogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest entry
    }
  }
}