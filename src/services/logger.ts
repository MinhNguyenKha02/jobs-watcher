/**
 * Logger interface and implementations
 * Supports pluggable logging backends
 */

export interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Console logger - logs to stdout/stderr
 */
export class ConsoleLogger implements ILogger {
  private prefix: string;

  constructor(prefix = 'jobs-watcher') {
    this.prefix = prefix;
  }

  debug(message: string, ...args: any[]): void {
    console.log(`[${this.prefix}] 🐛 DEBUG:`, message, ...args);
  }

  info(message: string, ...args: any[]): void {
    console.log(`[${this.prefix}] ℹ️  INFO:`, message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[${this.prefix}] ⚠️  WARN:`, message, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`[${this.prefix}] ❌ ERROR:`, message, ...args);
  }
}

/**
 * Silent logger - suppresses all output (useful for tests)
 */
export class SilentLogger implements ILogger {
  debug(_message: string, ..._args: any[]): void {}
  info(_message: string, ..._args: any[]): void {}
  warn(_message: string, ..._args: any[]): void {}
  error(_message: string, ..._args: any[]): void {}
}

// Global logger instance
let globalLogger: ILogger = new ConsoleLogger();

/**
 * Get the global logger instance
 */
export function getLogger(): ILogger {
  return globalLogger;
}

/**
 * Set the global logger instance (useful for tests)
 */
export function setLogger(logger: ILogger): void {
  globalLogger = logger;
}

/**
 * Create a logger with a custom prefix
 */
export function createLogger(prefix?: string): ILogger {
  return new ConsoleLogger(prefix);
}
