import fs from 'fs';
import path from 'path';
/**
 * Logger interface and implementations
 * Supports pluggable logging backends
 */

export interface ILogger {
  debug(message: string, context?: Record<string, any>): void;
  info(message: string, context?: Record<string, any>): void;
  warn(message: string, context?: Record<string, any>): void;
  error(message: string, context?: Record<string, any>): void;
}

/**
 * Console logger - logs to stdout/stderr and persistent file
 */
export class ConsoleLogger implements ILogger {
  private prefix: string;
  private json: boolean;
  private filePath?: string;

  constructor(prefix = 'jobs-watcher', json = false, filePath?: string) {
    this.prefix = prefix;
    this.json = json;
    this.filePath = filePath;
  }

  private format(level: string, message: string, context?: Record<string, any>) {
    if (this.json) {
      const logObj = { ts: new Date().toISOString(), level, prefix: this.prefix, message, ...context };
      return JSON.stringify(logObj);
    }
    if (context && Object.keys(context).length > 0) {
      return `[${this.prefix}] ${level}: ${message} ${JSON.stringify(context)}`;
    }
    return `[${this.prefix}] ${level}: ${message}`;
  }

  private writeToFile(line: string) {
    const logFilePath = this.getLogFilePath();
    if (!logFilePath) return;
    try {
      fs.appendFileSync(logFilePath, line + '\n', { encoding: 'utf8', mode: 0o644 });
    } catch (err) {
      // fallback: print error to console
      console.error(`[${this.prefix}] ❌ ERROR: Failed to write log to file`, err);
    }
  }

  private getLogFilePath(): string | undefined {
    if (!this.filePath) return undefined;
    // Always use src/db/cache for log file base
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate());
    const base = path.resolve(process.cwd(), 'src/db/cache');
    if (!fs.existsSync(base)) {
      fs.mkdirSync(base, { recursive: true });
    }
    const fname = `jobs-watcher-${y}${m}${d}.log`;
    return path.join(base, fname);
  }

  debug(message: string, context?: Record<string, any>): void {
    const line = this.format('🐛 DEBUG', message, context);
    console.log(line);
    if (this.filePath) this.writeToFile(line);
  }

  info(message: string, context?: Record<string, any>): void {
    const line = this.format('ℹ️  INFO', message, context);
    console.log(line);
    if (this.filePath) this.writeToFile(line);
  }

  warn(message: string, context?: Record<string, any>): void {
    const line = this.format('⚠️  WARN', message, context);
    console.warn(line);
    if (this.filePath) this.writeToFile(line);
  }

  error(message: string, context?: Record<string, any>): void {
    const line = this.format('❌ ERROR', message, context);
    console.error(line);
    if (this.filePath) this.writeToFile(line);
  }
}

/**
 * Silent logger - suppresses all output (useful for tests)
 */
export class SilentLogger implements ILogger {
  debug(_message: string, _context?: Record<string, any>): void {}
  info(_message: string, _context?: Record<string, any>): void {}
  warn(_message: string, _context?: Record<string, any>): void {}
  error(_message: string, _context?: Record<string, any>): void {}
}

// Default log file path for persistent logs (always daily rotated)
function getDefaultLogFilePath(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const base = path.resolve(process.cwd(), 'src/db/cache');
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return path.join(base, `jobs-watcher-${y}${m}${d}.log`);
}
let globalLogger: ILogger = new ConsoleLogger('jobs-watcher', false, getDefaultLogFilePath());


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
export function createLogger(prefix: string): ILogger {
  return new ConsoleLogger(prefix, false, getDefaultLogFilePath());
}

/**
 * Set logger to JSON mode for structured log output
 */
export function setLoggerJsonMode(json: boolean): void {
  if (globalLogger instanceof ConsoleLogger) {
    globalLogger = new ConsoleLogger((globalLogger as any).prefix, json, getDefaultLogFilePath());
  }
}
