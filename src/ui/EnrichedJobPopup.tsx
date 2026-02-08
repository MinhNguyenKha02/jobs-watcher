/**
 * EnrichedJobPopup - TUI Component for Data Testing Mode
 * Handles job navigation, HTML enrichment, and metadata capture
 * React/Ink-based interactive component
 */

import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import type { Job } from '../types.js';
import { useEnrichedJobState, type EnrichedJobAction } from './hooks/useEnrichedJob.js';
import { enrichJobFromHtml } from './services/htmlEnricher.js';
import { openUrlInBrowser } from './services/urlHandler.js';
import { theme, scoreColor } from './theme.js';
import { getLogger } from '../services/logger.js';

const logger = getLogger();

interface Props {
  job: Job;
  jobNumber: number;
  onComplete: (action: EnrichedJobAction) => void;
}

/**
 * Format job metadata for display
 */
function JobInfoDisplay({ job }: { job: Job }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold color={theme.label}>Position:</Text>
        <Text> {job.position}</Text>
      </Text>
      <Text>
        <Text bold color={theme.label}>Company:</Text>
        <Text> {job.company}</Text>
      </Text>
      {job.location && (
        <Text>
          <Text bold color={theme.label}>Location:</Text>
          <Text> {job.location}</Text>
        </Text>
      )}
      <Text>
        <Text bold color={theme.label}>Match Score:</Text>
        <Text color={scoreColor(job.matchScore || 0)}>
          {' '}
          {job.matchScore || 0} skills
        </Text>
      </Text>
      {job.url && (
        <Text>
          <Text bold color={theme.label}>URL:</Text>
          <Text color={theme.link}> {job.url}</Text>
        </Text>
      )}
    </Box>
  );
}

/**
 * Display enrichment progress
 */
function EnrichmentDisplay({
  status,
  parsedJob,
  originalScore,
  enrichedScore,
}: {
  status: 'idle' | 'enriching' | 'complete';
  parsedJob?: any;
  originalScore?: number;
  enrichedScore?: number;
}) {
  if (status === 'idle') return null;

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor={theme.accent}>
      <Text bold color={theme.accent}>✨ ENRICHMENT RESULTS</Text>

      {status === 'enriching' && <Text color={theme.warning}>Processing HTML...</Text>}

      {status === 'complete' && parsedJob && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text bold color={theme.accent}>Title:</Text>
            <Text> {parsedJob.title}</Text>
          </Text>
          <Text>
            <Text bold color={theme.accent}>Company:</Text>
            <Text> {parsedJob.company}</Text>
          </Text>
          {parsedJob.location && (
            <Text>
              <Text bold color={theme.accent}>Location:</Text>
              <Text> {parsedJob.location}</Text>
            </Text>
          )}
          {parsedJob.description && (
            <Text>
              <Text bold color={theme.accent}>Description:</Text>
              <Text> {parsedJob.description.length} chars</Text>
            </Text>
          )}
          <Box marginTop={1}>
            <Text bold color={theme.accent}>Match Score:</Text>
            <Text>
              {' '}
              {originalScore} → {enrichedScore} skills
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Action menu for job
 */
function ActionMenu({ mode }: { mode: 'main' | 'pasting' }) {
  if (mode === 'pasting') {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.warning}>
        <Text bold color={theme.warning}>📄 PASTE HTML MODE</Text>
        <Text color={theme.muted}>Paste HTML from browser (right-click → Copy HTML)</Text>
        <Text color={theme.muted}>Press Enter twice when done, or type 'skip' to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.border}>
      <Text bold color={theme.header}>⌨️ ACTIONS</Text>
      <Text>
        <Text bold color={theme.link}>[p]</Text>
        <Text> Paste HTML to enrich</Text>
      </Text>
      <Text>
        <Text bold color={theme.link}>[n]</Text>
        <Text> Next job</Text>
      </Text>
      <Text>
        <Text bold color={theme.link}>[s]</Text>
        <Text> Skip this job</Text>
      </Text>
      <Text>
        <Text bold color={theme.link}>[q]</Text>
        <Text> Quit</Text>
      </Text>
    </Box>
  );
}

function EnrichedJobPopupComponent({ job: initialJob, jobNumber, onComplete }: Props) {
  const { state, setState, job } = useEnrichedJobState(initialJob);
  const { exit } = useApp();
  const [pastedHtml, setPastedHtml] = React.useState('');
  const [inputBuffer, setInputBuffer] = React.useState('');
  const [enrichmentStatus, setEnrichmentStatus] = React.useState<'idle' | 'enriching' | 'complete'>('idle');
  const [enrichedData, setEnrichedData] = React.useState<any>(null);

  // Log initial job reception
  React.useEffect(() => {
    logger.info(`\n[EnrichedJobPopup] Showing job #${jobNumber}`);
  }, [jobNumber]);

  // Handle paste mode
  const handlePasteMode = () => {
    setState.setMode('pasting');
    setInputBuffer('');
  };

  const handleInputChar = (char: string) => {
    setInputBuffer(prev => prev + char);
  };

  const handleBackspace = () => {
    setInputBuffer(prev => prev.slice(0, -1));
  };

  const handleConfirmPaste = async () => {
    if (inputBuffer.toLowerCase().trim() === 'skip') {
      setState.setMode('main');
      setInputBuffer('');
      return;
    }

    const html = inputBuffer.trim();
    if (html.length < 100) {
      logger.warn('HTML too short (minimum 100 characters)');
      return;
    }

    setEnrichmentStatus('enriching');
    setPastedHtml(html);

    try {
      const enriched = await enrichJobFromHtml(html, job, setState.setJob, setState.setMatchScore);

      if (enriched) {
        setEnrichedData(enriched);
        setEnrichmentStatus('complete');
        setState.setMode('main');
        setInputBuffer('');
        logger.info('Job enriched successfully');
      } else {
        logger.warn('Failed to parse HTML');
        setEnrichmentStatus('idle');
      }
    } catch (error) {
      logger.warn(`Error during enrichment: ${error instanceof Error ? error.message : String(error)}`);
      setEnrichmentStatus('idle');
    }
  };

  useInput((input, key) => {
    if (state.mode === 'main') {
      if (input === 'p') {
        handlePasteMode();
      } else if (input === 'n') {
        onComplete({ action: 'next', enrichedJob: enrichedData, pastedHtml });
        exit();
      } else if (input === 's') {
        onComplete({ action: 'skip', enrichedJob: enrichedData, pastedHtml });
        exit();
      } else if (input === 'q') {
        onComplete({ action: 'quit', enrichedJob: enrichedData, pastedHtml });
        exit();
      }
    } else if (state.mode === 'pasting') {
      if (key.return) {
        handleConfirmPaste();
      } else if (key.escape) {
        setState.setMode('main');
        setInputBuffer('');
      } else if (key.backspace || key.delete) {
        handleBackspace();
      } else if (input && !key.ctrl && !key.meta) {
        handleInputChar(input);
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="double" borderColor={theme.border}>
      <Text bold color={theme.header}>
        📌 JOB #{jobNumber}
      </Text>

      <Box marginTop={1} marginBottom={1}>
        <JobInfoDisplay job={job} />
      </Box>

      {pastedHtml && (
        <EnrichmentDisplay
          status={enrichmentStatus}
          parsedJob={enrichedData}
          originalScore={initialJob.matchScore}
          enrichedScore={job.matchScore}
        />
      )}

      <ActionMenu mode={state.mode} />

      {state.mode === 'pasting' && (
        <Box marginTop={1}>
          <Text>
            <Text color="yellow">{inputBuffer.length > 100 ? inputBuffer.substring(0, 100) + '...' : inputBuffer}</Text>
            <Text dimColor>█</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Show enriched job popup and handle interaction
 */
export async function showEnrichedJobPopup(
  job: Job,
  jobNumber: number
): Promise<{
  action: EnrichedJobAction['action'];
  enrichedJob?: any;
  pastedHtml?: string;
}> {
  return new Promise((resolve) => {
    const handleComplete = (result: EnrichedJobAction) => {
      resolve({
        action: result.action,
        enrichedJob: result.enrichedJob,
        pastedHtml: result.pastedHtml,
      });
    };

    render(<EnrichedJobPopupComponent job={job} jobNumber={jobNumber} onComplete={handleComplete} />);
  });
}
