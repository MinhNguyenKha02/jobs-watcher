import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import type { Job } from '../types.js';

interface Props {
  job: Job;
  onAction: (action: 'apply' | 'skip' | 'queue') => void;
}

function JobPopupComponent({ job, onAction }: Props) {
  const [selected, setSelected] = useState<'apply' | 'skip' | 'queue'>('queue');
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.leftArrow || input === 'h') {
      setSelected(prev => {
        if (prev === 'skip') return 'apply';
        if (prev === 'queue') return 'skip';
        return prev;
      });
    } else if (key.rightArrow || input === 'l') {
      setSelected(prev => {
        if (prev === 'apply') return 'skip';
        if (prev === 'skip') return 'queue';
        return prev;
      });
    } else if (key.return) {
      onAction(selected);
      exit();
    } else if (key.escape || input === 'q') {
      onAction('queue');
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Text bold color="cyan">
        🎯 New Job Alert
      </Text>
      
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold color="yellow">Company:  </Text>
          <Text>{job.company}</Text>
        </Text>
        <Text>
          <Text bold color="yellow">Position: </Text>
          <Text>{job.position}</Text>
        </Text>
        {job.location && (
          <Text>
            <Text bold color="yellow">Location: </Text>
            <Text>{job.location}</Text>
          </Text>
        )}
        <Text>
          <Text bold color="yellow">Platform: </Text>
          <Text>{job.platform}</Text>
        </Text>
        {job.url && (
          <Text>
            <Text bold color="yellow">URL:      </Text>
            <Text color="blue" dimColor>{job.url}</Text>
          </Text>
        )}
      </Box>

      {job.description && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{job.description.substring(0, 200)}...</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="row" justifyContent="center">
        <Box
          borderStyle="round"
          borderColor={selected === 'apply' ? 'green' : 'gray'}
          paddingX={2}
          marginX={1}
        >
          <Text bold color={selected === 'apply' ? 'green' : 'white'}>
            ✓ Apply
          </Text>
        </Box>
        
        <Box
          borderStyle="round"
          borderColor={selected === 'skip' ? 'red' : 'gray'}
          paddingX={2}
          marginX={1}
        >
          <Text bold color={selected === 'skip' ? 'red' : 'white'}>
            ✗ Skip
          </Text>
        </Box>
        
        <Box
          borderStyle="round"
          borderColor={selected === 'queue' ? 'yellow' : 'gray'}
          paddingX={2}
          marginX={1}
        >
          <Text bold color={selected === 'queue' ? 'yellow' : 'white'}>
            ⏰ Queue
          </Text>
        </Box>
      </Box>

      <Box marginTop={1} justifyContent="center">
        <Text dimColor>
          ← → / h l: Navigate  •  Enter: Confirm  •  Esc/q: Queue & Exit
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Show job popup TUI and return user action
 * No database - just returns the action
 */
export async function showJobPopup(job: Job): Promise<'apply' | 'skip' | 'queue'> {
  return new Promise((resolve) => {
    const handleAction = (action: 'apply' | 'skip' | 'queue') => {
      resolve(action);
    };

    render(<JobPopupComponent job={job} onAction={handleAction} />);
  });
}
