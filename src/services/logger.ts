
import util from 'util';
import fs from 'fs';
import path from 'path';

/**
 * Logger interface and implementations
 * Supports pluggable logging backends
 */

export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}


const URGENCY_SYMBOLS = {
  info: '[*]',
  warn: '[!]',
  error: '[!]',
  debug: '[*]',
  success: '[✓]',
};

function getOrigin(): string {
  const stackRaw = new Error().stack;
  if (!stackRaw) return 'unknown-origin';
  const stack = stackRaw.split('\n');
  // Find the first stack frame outside logger.ts
  let originFrame = '';
  for (let i = 2; i < stack.length; i++) {
    if (stack[i] && !stack[i].includes('logger.ts')) {
      originFrame = stack[i];
      break;
    }
  }
  // Fallback to 3rd frame if not found
  if (!originFrame && stack.length > 3) originFrame = stack[3];
  const match = originFrame.match(/at (.+?) \((.+?):([0-9]+):([0-9]+)\)/) || originFrame.match(/at (.+?):([0-9]+):([0-9]+)/);
  if (match) {
    // match[1]: function or file, match[2]: file, match[3]: line
    if (match.length === 5) {
      return `${match[1]}@${match[2]}:${match[3]}`;
    } else if (match.length === 4) {
      return `${match[1]}:${match[2]}`;
    }
  }
  return 'unknown-origin';
}

function getTimestamp() {
  return new Date().toISOString();
}

function logWithAudit(level: keyof typeof URGENCY_SYMBOLS, ...args: unknown[]) {
  const symbol = URGENCY_SYMBOLS[level] || '[*]';
  const origin = getOrigin();
  const msg = util.format(...args);
  const out = `${getTimestamp()} ${symbol} [${origin}] ${msg}`;
  if (level === 'error') {
    console.error(out);
  } else if (level === 'warn') {
    console.warn(out);
  } else {
    console.log(out);
  }
}


class AuditLogger implements ILogger {
  debug(message: string, _context?: Record<string, unknown>) { logWithAudit('debug', message); }
  info(message: string, _context?: Record<string, unknown>) { logWithAudit('info', message); }
  warn(message: string, _context?: Record<string, unknown>) { logWithAudit('warn', message); }
  error(message: string, _context?: Record<string, unknown>) { logWithAudit('error', message); }
}

let globalLogger: ILogger = new AuditLogger();

export class ConsoleLogger implements ILogger {
  private prefix: string;
    public getPrefix(): string {
      return this.prefix;
    }
  private json: boolean;
  private filePath?: string;

  constructor(prefix = 'jobs-watcher', json = false, filePath?: string) {
    this.prefix = prefix;
    this.json = json;
    this.filePath = filePath;
  }

  private format(level: string, message: string, context?: Record<string, unknown>) {
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

  debug(message: string, context?: Record<string, unknown>): void {
    const line = this.format('🐛 DEBUG', message, context);
    console.log(line);
    if (this.filePath) this.writeToFile(line);
  }

  info(message: string, context?: Record<string, unknown>): void {
    const line = this.format('ℹ️  INFO', message, context);
    console.log(line);
    if (this.filePath) this.writeToFile(line);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    const line = this.format('⚠️  WARN', message, context);
    console.warn(line);
    if (this.filePath) this.writeToFile(line);
  }

  error(message: string, context?: Record<string, unknown>): void {
    const line = this.format('❌ ERROR', message, context);
    console.error(line);
    if (this.filePath) this.writeToFile(line);
  }
}

/**
 * Silent logger - suppresses all output (useful for tests)
 */
export class SilentLogger implements ILogger {
  debug(_message: string, _context?: Record<string, unknown>): void {}
  info(_message: string, _context?: Record<string, unknown>): void {}
  warn(_message: string, _context?: Record<string, unknown>): void {}
  error(_message: string, _context?: Record<string, unknown>): void {}
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
    globalLogger = new ConsoleLogger(globalLogger.getPrefix(), json, getDefaultLogFilePath());
  }
}
