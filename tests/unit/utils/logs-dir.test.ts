import { describe, it, expect } from 'vitest';
import { getLogsDir } from '../../../src/infrastructure/utils/logs-dir.js' ;

describe('getLogsDir', () => {
  it('returns a string ending with logs', () => {
    const result = getLogsDir();
    expect(typeof result).toBe('string');
    expect(result.endsWith('logs')).toBe(true);
  });
});
