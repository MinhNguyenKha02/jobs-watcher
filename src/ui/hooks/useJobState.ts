import { useState } from 'react';
import type { Job } from '../../types.js';

/**
 * UI state for job decision workflow
 * Only core properties needed for: open browser, paste HTML, apply, queue
 */
export interface JobUIState {
  /** Current selected action: apply-* or queue */
  selected: ActionType;
  /** UI mode: menu (main), apply-submenu (apply options), html (paste mode) */
  mode: Mode;
  /** Pasted HTML content from job website for enrichment */
  htmlContent: string;
  /** Text input buffer for HTML paste mode */
  inputBuffer: string;
  /** Job-profile match score (number of matched skills) */
  matchScore: number;
  /** Whether user opened URL in browser (via 'o' key) */
  urlOpened: boolean;
}

export type ActionType = 'apply-custom' | 'apply-generate' | 'apply-edit' | 'queue';
export type Mode = 'menu' | 'apply-submenu' | 'html';

export interface EnrichedJobData {
  /** Pasted HTML content that enriched the job data */
  htmlContent?: string;
  /** Whether URL was opened in browser during decision */
  urlOpened?: boolean;
}

export function useJobState(initialJob: Job) {
  const [job, setJob] = useState(initialJob);
  const [selected, setSelected] = useState<ActionType>('queue');
  const [mode, setMode] = useState<Mode>('menu');
  const [htmlContent, setHtmlContent] = useState('');
  const [inputBuffer, setInputBuffer] = useState('');
  const [matchScore, setMatchScore] = useState(job.matchScore || 0);
  const [urlOpened, setUrlOpened] = useState(false);

  const state: JobUIState = {
    selected,
    mode,
    htmlContent,
    inputBuffer,
    matchScore,
    urlOpened,
  };

  const setState = {
    setJob,
    setSelected,
    setMode,
    setHtmlContent,
    setInputBuffer,
    setMatchScore,
    setUrlOpened,
  };

  return { state, setState, job };
}
