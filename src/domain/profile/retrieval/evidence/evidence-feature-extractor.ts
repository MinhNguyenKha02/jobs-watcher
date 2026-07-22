// src/services/profile/retrieval/evidence/evidence-feature-extractor.ts

import { EvidenceNode } from '../../types/retrieval.types.js';

/**
 * Features used for ranking evidence.
 */
export interface EvidenceFeatures {
  operationalScore: number;
  architectureScore: number;
  ownershipScore: number;
  quantifiedScore: number;
}

/**
 * Extracts ranking features from an evidence node.
 */
export class EvidenceFeaturesExtractor {
  /**
   * Extracts features from an evidence node.
   * @param evidence The evidence node to extract features from.
   * @returns The evidence features.
   */
  static extract(evidence: EvidenceNode): EvidenceFeatures {
    // Combine all text sources: summary, bullets, technologies
    const bulletTexts = evidence.bullets?.map(bullet => bullet.text) ?? [];
    const textParts = [
      evidence.summary ?? '',
      bulletTexts.join(' ') ?? '',
      Object.values(evidence.techStack ?? {}).flat().join(' ') ?? ''
    ];
    const text = textParts.join(' ').toLowerCase();

    // Operational keywords
    const operationalKeywords = [
      'production',
      'runtime',
      'deployment',
      'monitoring',
      'observability',
      'alerting',
      'workflow',
      'systemd',
      'daemon'
    ];
    const operationalScore = EvidenceFeaturesExtractor.calculateKeywordScore(text, operationalKeywords);

    // Architecture keywords
    const architectureKeywords = [
      'event-driven',
      'orchestration',
      'distributed',
      'hexagonal',
      'clean architecture',
      'saga'
    ];
    const architectureScore = EvidenceFeaturesExtractor.calculateKeywordScore(text, architectureKeywords);

    // Ownership keywords
    const ownershipKeywords = [
      'built',
      'implemented',
      'designed',
      'developed',
      'architected',
      'led'
    ];
    const ownershipScore = EvidenceFeaturesExtractor.calculateKeywordScore(text, ownershipKeywords);

    // Quantified score
    const quantifiedScore = EvidenceFeaturesExtractor.calculateQuantifiedScore(text);

    return {
      operationalScore,
      architectureScore,
      ownershipScore,
      quantifiedScore
    };
  }

  /**
   * Calculates a score based on the presence of keywords in the text.
   * @param text The text to search in (already lowercased).
   * @param keywords The list of keywords to search for.
   * @returns The score as a fraction of keywords found (0 to 1).
   */
  private static calculateKeywordScore(text: string, keywords: string[]): number {
    if (keywords.length === 0) {
      return 0;
    }
    let matchedCount = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        matchedCount++;
      }
    }
    return matchedCount / keywords.length;
  }

  /**
   * Calculates a score based on quantified matches in the text.
   * @param text The text to search in (already lowercased).
   * @returns The score as min(totalMatches / 5, 1).
   */
  private static calculateQuantifiedScore(text: string): number {
    // Define the regex patterns for quantified matches
    const patterns = [
      /\d+%/g,          // percentages
      /\d+ms/g,         // milliseconds
      /\d+x/g,          // times (e.g., 2x)
      /\d+k/g,          // thousands (e.g., 10k)
      /\d+m/g,          // millions (e.g., 5m)
      /\d+/g            // plain numbers
    ];

    let totalMatches = 0;
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        totalMatches += matches.length;
      }
    }

    // Score is min(totalMatches / 5, 1)
    return Math.min(totalMatches / 5, 1);
  }
}