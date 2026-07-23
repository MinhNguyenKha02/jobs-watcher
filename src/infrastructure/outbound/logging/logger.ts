import pino from 'pino';

export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface StructLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

class PinoLogger implements ILogger {
  private logger: pino.Logger;

  constructor(logger: pino.Logger) {
    this.logger = logger;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (context && Object.keys(context).length > 0) {
      this.logger.debug(context, message);
    } else {
      this.logger.debug(message);
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (context && Object.keys(context).length > 0) {
      this.logger.info(context, message);
    } else {
      this.logger.info(message);
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (context && Object.keys(context).length > 0) {
      this.logger.warn(context, message);
    } else {
      this.logger.warn(message);
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (context && Object.keys(context).length > 0) {
      this.logger.error(context, message);
    } else {
      this.logger.error(message);
    }
  }

  struct(bindings: Record<string, unknown>): StructLogger {
    const child = this.logger.child(bindings);
    return {
      debug: (message: string, context?: Record<string, unknown>) => {
        if (context && Object.keys(context).length > 0) {
          child.debug(context, message);
        } else {
          child.debug(message);
        }
      },
      info: (message: string, context?: Record<string, unknown>) => {
        if (context && Object.keys(context).length > 0) {
          child.info(context, message);
        } else {
          child.info(message);
        }
      },
      warn: (message: string, context?: Record<string, unknown>) => {
        if (context && Object.keys(context).length > 0) {
          child.warn(context, message);
        } else {
          child.warn(message);
        }
      },
      error: (message: string, context?: Record<string, unknown>) => {
        if (context && Object.keys(context).length > 0) {
          child.error(context, message);
        } else {
          child.error(message);
        }
      },
    };
  }
}

export class SilentLogger implements ILogger {
  debug(_message: string, _context?: Record<string, unknown>): void {}
  info(_message: string, _context?: Record<string, unknown>): void {}
  warn(_message: string, _context?: Record<string, unknown>): void {}
  error(_message: string, _context?: Record<string, unknown>): void {}
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
let globalLogger: PinoLogger | SilentLogger = new SilentLogger();

export function getLogger(): ILogger {
  return globalLogger;
}

export function setLogger(logger: ILogger): void {
  globalLogger = logger;
}

export function createLogger(prefix: string): ILogger {
  const root = pinoRoot ?? createPinoLogger();
  return new PinoLogger(root.child({ prefix }));
}

export function initLogger(): void {
  pinoRoot = createPinoLogger();
  globalLogger = new PinoLogger(pinoRoot);
}
