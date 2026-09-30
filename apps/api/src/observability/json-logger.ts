import type { LoggerService, LogLevel } from '@nestjs/common';

import { redact, redactText } from './redact.js';

const LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

/**
 * One JSON object per line on stdout (staging/production). Every message
 * and field goes through redaction; stack traces are kept only for errors
 * and are redacted too.
 */
export class JsonLogger implements LoggerService {
  private enabled: Set<LogLevel>;

  constructor(
    level: LogLevel = 'log',
    private readonly write: (line: string) => void = (line) => process.stdout.write(line + '\n'),
  ) {
    this.enabled = new Set(LEVELS.slice(0, LEVELS.indexOf(level) + 1));
  }

  setLogLevels(levels: LogLevel[]): void {
    this.enabled = new Set(levels);
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.emit('log', message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('verbose', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]): void {
    this.emit('fatal', message, rest);
  }

  private emit(level: LogLevel, message: unknown, rest: unknown[]): void {
    if (!this.enabled.has(level)) return;
    // Nest passes (message, context) or (message, stack, context).
    const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    const stack =
      level === 'error' || level === 'fatal'
        ? rest.find((r, i) => typeof r === 'string' && i < rest.length - 1)
        : undefined;
    const base: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: level === 'log' ? 'info' : level,
      ...(context ? { context } : {}),
    };
    if (typeof message === 'object' && message !== null && !(message instanceof Error)) {
      Object.assign(base, redact(message) as Record<string, unknown>);
    } else {
      base['msg'] = redactText(message instanceof Error ? message.message : String(message));
    }
    if (typeof stack === 'string') base['stack'] = redactText(stack).slice(0, 4000);
    this.write(JSON.stringify(base));
  }
}
