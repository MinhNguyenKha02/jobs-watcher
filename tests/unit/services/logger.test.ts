import { describe, it, expect, vi } from 'vitest';
import { getLogger, setLogger, createLogger, initLogger } from '../../../src/infrastructure/outbound/logging/logger.js';

describe('global logger', () => {
  it('getLogger returns a default logger', () => {
    const logger = getLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('setLogger replaces the global logger', () => {
    const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    setLogger(mockLogger as any);
    expect(getLogger()).toBe(mockLogger);
  });

  it('createLogger returns an ILogger', () => {
    const logger = createLogger('my-app');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('initLogger sets the global logger', () => {
    initLogger();
    const logger = getLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });
});

describe('ILogger interface', () => {
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    logger = createLogger('test');
  });

  it('info accepts message only', () => {
    expect(() => logger.info('hello')).not.toThrow();
  });

  it('info accepts message with context', () => {
    expect(() => logger.info('msg', { key: 'val' })).not.toThrow();
  });

  it('warn accepts message with context', () => {
    expect(() => logger.warn('warning', { count: 5 })).not.toThrow();
  });

  it('error accepts message', () => {
    expect(() => logger.error('error msg')).not.toThrow();
  });

  it('error accepts message with context', () => {
    expect(() => logger.error('error msg', { err: 'fail' })).not.toThrow();
  });

  it('debug accepts message', () => {
    expect(() => logger.debug('debug msg')).not.toThrow();
  });

  it('debug accepts message with context', () => {
    expect(() => logger.debug('debug msg', { detail: true })).not.toThrow();
  });
});
