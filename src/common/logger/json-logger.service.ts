import { LoggerService } from '@nestjs/common';

type LogLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal';

const LOG_LEVELS: Record<LogLevel, number> = {
  verbose: 0,
  debug: 1,
  log: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

export class JsonLogger implements LoggerService {
  private readonly minLevel: number;

  constructor(minLevel: LogLevel = 'log') {
    this.minLevel = LOG_LEVELS[minLevel];
  }

  verbose(message: string, context?: string) {
    this.write('verbose', message, context);
  }

  debug(message: string, context?: string) {
    this.write('debug', message, context);
  }

  log(message: string, context?: string) {
    this.write('log', message, context);
  }

  warn(message: string, context?: string) {
    this.write('warn', message, context);
  }

  error(message: string, trace?: string, context?: string) {
    if (LOG_LEVELS.error >= this.minLevel) {
      const entry = {
        level: 'error',
        timestamp: new Date().toISOString(),
        message,
        ...(trace ? { trace } : {}),
        ...(context ? { context } : {}),
      };
      console.error(JSON.stringify(entry));
    }
  }

  fatal(message: string, context?: string) {
    this.write('fatal', message, context);
  }

  private write(level: LogLevel, message: string, context?: string) {
    if (LOG_LEVELS[level] < this.minLevel) return;
    const entry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      ...(context ? { context } : {}),
    };
    const logFn = level === 'error' || level === 'fatal' ? console.error : console.log;
    logFn(JSON.stringify(entry));
  }
}
