/**
 * useEnrichedJob - Hook for enriched job state management
 * Handles job data, enrichment status, and mode changes
 */

import { useState, useCallback } from 'react';
import type { Job } from '../../types.js';

export type EnrichedJobMode = 'main' | 'pasting';

export interface EnrichedJobAction {
  action: 'paste' | 'next' | 'skip' | 'quit';
  enrichedJob?: any;
  pastedHtml?: string;
}

export interface EnrichedJobState {
  job: Job;
  mode: EnrichedJobMode;
  htmlContent: string;
  matchScore: number;
  enrichedAt: string | null;
}

interface EnrichedJobStateActions {
  setJob: (job: Job) => void;
  setMode: (mode: EnrichedJobMode) => void;
  setHtmlContent: (html: string) => void;
  setMatchScore: (score: number) => void;
  setEnrichedAt: (time: string | null) => void;
}

/**
 * Hook to manage enriched job state
 */
export function useEnrichedJobState(initialJob: Job) {
  const [job, setJob] = useState<Job>(initialJob);
  const [mode, setMode] = useState<EnrichedJobMode>('main');
  const [htmlContent, setHtmlContent] = useState('');
  const [matchScore, setMatchScore] = useState(initialJob.matchScore || 0);
  const [enrichedAt, setEnrichedAt] = useState<string | null>(null);

  const state: EnrichedJobState = {
    job,
    mode,
    htmlContent,
    matchScore,
    enrichedAt,
  };

  const setState: EnrichedJobStateActions = {
    setJob: useCallback((newJob: Job) => setJob(newJob), []),
    setMode: useCallback((newMode: EnrichedJobMode) => setMode(newMode), []),
    setHtmlContent: useCallback((html: string) => setHtmlContent(html), []),
    setMatchScore: useCallback((score: number) => setMatchScore(score), []),
    setEnrichedAt: useCallback((time: string | null) => setEnrichedAt(time), []),
  };

  return { state, setState, job };
}
