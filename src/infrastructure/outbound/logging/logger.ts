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
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true } },
  });
}

let pinoRoot: pino.Logger | undefined;

export function createLogger(prefix: string): LoggerPort {
  const root = pinoRoot ?? createPinoLogger();
  return new PinoLogger(root.child({ prefix }));
}

export function initLogger(): void {
  pinoRoot = createPinoLogger();
}
