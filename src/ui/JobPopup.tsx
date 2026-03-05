import { render, Box, Text, useInput, useApp } from 'ink';
import React from 'react';

import { getLogger } from '../services/logger.js';
import type { Job } from '../types.js';

import { createInputHandlers } from './hooks/useJobInput.js';
import { useJobState, type EnrichedJobData, type ActionType } from './hooks/useJobState.js';
import { enrichJobFromHtml } from './services/htmlEnricher.js';
import { openUrlInBrowser } from './services/urlHandler.js';
import { theme, scoreColor, decisionColor } from './theme.js';

const logger = getLogger();

function decisionLabel(action: ActionType): string {
  switch (action) {
    case 'apply-custom':
      return 'Apply (Custom)';
    case 'apply-generate':
      return 'Apply (Generate)';
    case 'apply-edit':
      return 'Apply (Edit)';
    case 'queue':
      return 'Queue';
    default:
      return 'Queue';
  }
}

interface Props {
  job: Job;
  onAction: (action: ActionType, enrichedData?: EnrichedJobData) => void;
}

function JobPopupComponent({ job: initialJob, onAction }: Props) {
  const { state, setState, job } = useJobState(initialJob);
  const { exit } = useApp();

  // Log initial job reception
  React.useEffect(() => {
    logger.info('New job alert received');
    logger.info('Job metadata', {
      position: job.position,
      company: job.company,
      location: job.location,
      salary: job.salary,
      platform: job.platform,
      matchScore: job.matchScore,
      messageId: job.messageId,
    });
    logger.info('Actions: (o)pen URL | (p)aste HTML | (a)pply | (q)ueue');
  }, [job.messageId]); // Only log on new job

  const handlers = {
    setSelected: setState.setSelected,
    setMode: setState.setMode,
    setInputBuffer: setState.setInputBuffer,
    onInputReturn: async () => {
      if (state.mode === 'html') {
        logger.info('Paste mode → Enriching from HTML');
        const success = await enrichJobFromHtml(
          state.inputBuffer,
          job,
          setState.setJob,
          setState.setMatchScore
        );
        if (success) {
          setState.setHtmlContent(state.inputBuffer);
          logger.info('Enrichment successful - returned to menu');
        } else {
          logger.warn('Enrichment failed - invalid HTML');
        }
      }
      setState.setInputBuffer('');
      setState.setMode('menu');
    },
    onOpenUrl: () => {
      if (job.url) {
        logger.info(`Opening URL: ${job.url}`);
        openUrlInBrowser(job.url);
        setState.setUrlOpened(true);
      }
    },
    onConfirm: () => {
      logger.info(`Job decision made: ${state.selected}`);
      logger.info('Final job metadata', {
        position: job.position,
        company: job.company,
        location: job.location,
        salary: job.salary,
        matchScore: job.matchScore,
        enriched: !!state.htmlContent,
        urlOpened: state.urlOpened,
      });
      const enrichedData: EnrichedJobData = {
        htmlContent: state.htmlContent || undefined,
        urlOpened: state.urlOpened || undefined,
        manuallyValidated: Boolean(state.htmlContent),
      };
      onAction(state.selected, enrichedData);
      exit();
    },
    onEscape: () => {
      setState.setInputBuffer('');
      setState.setMode('menu');
    },
  };

  const inputHandlers = createInputHandlers(state, handlers);

  useInput(
    (
      input: string,
      key: {
        return?: boolean;
        escape?: boolean;
        backspace?: boolean;
        delete?: boolean;
        ctrl?: boolean;
        meta?: boolean;
      }
    ) => {
      if (state.mode === 'menu') {
        if (input === 'a' && state.selected.startsWith('apply')) inputHandlers.onApplyMode();
        else if (input === 'p') inputHandlers.onHtmlPaste();
        else if (input === 'o') inputHandlers.onOpenUrl();
        else if (key.return) inputHandlers.onConfirm();
        else if (key.escape || input === 'q') {
          onAction('queue');
          exit();
        }
      } else if (state.mode === 'apply-submenu') {
        if (input === 'c') inputHandlers.onCustomApply();
        else if (input === 'g') inputHandlers.onGenerateApply();
        else if (input === 'e') inputHandlers.onEditApply();
        else if (key.escape) inputHandlers.onBackFromSubmenu();
      } else {
        if (key.return) inputHandlers.onConfirm();
        else if (key.escape) inputHandlers.onEscape();
        else if (key.backspace || key.delete) inputHandlers.onBackspace();
        else if (input && !key.ctrl && !key.meta) inputHandlers.onInputChar(input);
      }
    }
  );
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor={theme.border}>
      <Text bold color={theme.header}>
        🎯 New Job Alert
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold color={theme.label}>
            Company:{' '}
          </Text>
          <Text>{job.company}</Text>
        </Text>
        <Text>
          <Text bold color={theme.label}>
            Position:{' '}
          </Text>
          <Text>{job.position}</Text>
        </Text>
        {job.location && (
          <Text>
            <Text bold color={theme.label}>
              Location:{' '}
            </Text>
            <Text>{job.location}</Text>
          </Text>
        )}
        <Text>
          <Text bold color={theme.label}>
            Platform:{' '}
          </Text>
          <Text>{job.platform}</Text>
        </Text>
        <Text>
          <Text bold color={theme.label}>
            URL:{' '}
          </Text>
          {job.url ? (
            <Text color={theme.link}>
              {job.url} {state.urlOpened && '✓'}
            </Text>
          ) : (
            <Text color={theme.muted}>Not</Text>
          )}
        </Text>
        <Text>
          <Text bold color={theme.label}>
            Match:{' '}
          </Text>
          <Text color={scoreColor(state.matchScore)}>
            {state.matchScore > 0 ? `${Math.round(state.matchScore)}%` : 'No match'}
          </Text>
        </Text>
        <Text>
          <Text bold color={theme.label}>
            Decision:{' '}
          </Text>
          <Text color={decisionColor(state.selected)}>{decisionLabel(state.selected)}</Text>
        </Text>
      </Box>

      {job.description && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.muted}>{job.description.substring(0, 200)}...</Text>
        </Box>
      )}

      {/* Enrichment preview */}
      {state.htmlContent && state.mode === 'menu' && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={theme.accent}>
            ✨ HTML Enrichment
          </Text>
          <Text color={theme.accent}>• Job data reparsed from website HTML</Text>
          <Text color={theme.accent}>• Match score: {Math.round(state.matchScore)}%</Text>
        </Box>
      )}

      {/* Apply submenu */}
      {state.mode === 'apply-submenu' && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={theme.header}>
            📋 Apply Mode
          </Text>
          <Text>
            <Text color={theme.link}>[c]</Text> Custom{' '}
            <Text color={theme.muted}>Manual application</Text>
          </Text>
          <Text>
            <Text color={theme.link}>[g]</Text> Generate{' '}
            <Text color={theme.muted}>Auto-generate materials</Text>
          </Text>
          <Text>
            <Text color={theme.link}>[e]</Text> Edit{' '}
            <Text color={theme.muted}>Generate then edit</Text>
          </Text>
          <Text color={theme.muted}>Esc: Back</Text>
        </Box>
      )}

      {/* Input mode */}
      {state.mode === 'html' && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color={theme.warning}>
            📄 Paste HTML content from job page
          </Text>
          <Text>
            <Text color={theme.link}>
              {state.inputBuffer.length > 100
                ? state.inputBuffer.substring(0, 100) + '...'
                : state.inputBuffer}
            </Text>
            <Text color={theme.muted}>█</Text>
          </Text>
          <Text color={theme.muted}>Enter: Parse & Enrich • Esc: Cancel</Text>
        </Box>
      )}

      {state.mode === 'menu' && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.muted}>
            Actions: [Enter] confirm • [a] apply mode • [o] open URL • [p] paste HTML • [q] queue
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Show job popup TUI and return user action + enriched data
 */
export async function showJobPopup(job: Job): Promise<{
  action: ActionType;
  enrichedData?: EnrichedJobData;
}> {
  return new Promise((resolve) => {
    const handleAction = (action: ActionType, enrichedData?: EnrichedJobData) => {
      resolve({ action, enrichedData });
    };

    render(<JobPopupComponent job={job} onAction={handleAction} />);
  });
}

export type { EnrichedJobData, ActionType };
