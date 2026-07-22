import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogger, getLogger, setLogger, createLogger, setLoggerJsonMode } from '../../../src/infrastructure/outbound/logging/logger.js' ;

describe('ConsoleLogger', () => {
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('formats info messages with prefix and level', () => {
    const logger = new ConsoleLogger('test-prefix');
    logger.info('hello world');
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[test-prefix]'));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('INFO'));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('hello world'));
  });

  it('includes context in JSON format', () => {
    const logger = new ConsoleLogger('test', true);
    logger.info('msg', { key: 'val' });
    const call = consoleErrorSpy.mock.calls[0][0];
    const parsed = JSON.parse(call);
    expect(parsed.prefix).toBe('test');
    expect(parsed.message).toBe('msg');
    expect(parsed.key).toBe('val');
  });

  it('appends context to non-JSON output', () => {
    const logger = new ConsoleLogger('test');
    logger.warn('warning', { count: 5 });
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('{"count":5}'));
  });

  it('debug calls console.error', () => {
    const logger = new ConsoleLogger('test');
    logger.debug('debug msg');
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG'));
  });

  it('error calls console.error', () => {
    const logger = new ConsoleLogger('test');
    logger.error('error msg');
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR'));
  });
});

describe('global logger', () => {
  it('getLogger returns a logger by default', () => {
    const logger = getLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('setLogger replaces the global logger', () => {
    const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    setLogger(mockLogger as any);
    expect(getLogger()).toBe(mockLogger);
  });

  it('createLogger returns a ConsoleLogger', () => {
    const logger = createLogger('my-app');
    expect(logger).toBeInstanceOf(ConsoleLogger);
  });

  it('setLoggerJsonMode recreates global logger in JSON mode', () => {
    const original = getLogger();
    setLogger(new ConsoleLogger('test'));
    setLoggerJsonMode(true);
    const updated = getLogger();
    expect(updated).not.toBe(original);
  });
});
