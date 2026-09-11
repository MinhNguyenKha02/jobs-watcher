import pino from 'pino';

import type { LoggerPort } from '../../../application/ports/logger.port.js';

export class PinoLogger implements LoggerPort {
  private logger: pino.Logger;

  constructor(logger: pino.Logger) {
    this.logger = logger;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (meta && Object.keys(meta).length > 0) {
      this.logger.debug(meta, message);
    } else {
      this.logger.debug(message);
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (meta && Object.keys(meta).length > 0) {
      this.logger.info(meta, message);
    } else {
      this.logger.info(message);
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (meta && Object.keys(meta).length > 0) {
      this.logger.warn(meta, message);
    } else {
      this.logger.warn(message);
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (meta && Object.keys(meta).length > 0) {
      this.logger.error(meta, message);
    } else {
      this.logger.error(message);
    }
  }
}

function createPinoLogger(): pino.Logger {
  // STD hygiene: logs → stderr (fd 2) so PA stdout stays render-only, PE tails $LOG via 2>$LOG
  // Always JSON to stderr; PE does `tail|pino-pretty` for display. Avoid pino-pretty transport here
  // (transport would bypass dest and write to stdout, breaking 2>$LOG).
  const dest = pino.destination({ dest: 2, sync: false });
  return pino({ level: process.env.LOG_LEVEL ?? 'info' }, dest);
}

let pinoRoot: pino.Logger | undefined;

export function createLogger(prefix: string): LoggerPort {
  const root = pinoRoot ?? createPinoLogger();
  return new PinoLogger(root.child({ prefix }));
}

export function initLogger(): void {
  pinoRoot = createPinoLogger();
}
