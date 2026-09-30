import { Logger } from '@nestjs/common';

import { redact, redactText } from './redact.js';

/**
 * Where unexpected errors go. Faz 6 ships a console reporter and a no-op;
 * an external service (Sentry etc.) is a DECISION REQUIRED item
 * (docs/runbooks/production-release-checklist.md).
 */
export interface ErrorReporter {
  report(
    error: unknown,
    context: { requestId?: string; route?: string; tags?: Record<string, string> },
  ): void;
}

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');

export class ConsoleErrorReporter implements ErrorReporter {
  private readonly logger = new Logger('ErrorReporter');
  report(
    error: unknown,
    context: { requestId?: string; route?: string; tags?: Record<string, string> },
  ): void {
    const e = error instanceof Error ? error : new Error(String(error));
    this.logger.error(
      {
        msg: 'unhandled_error',
        error: e.name,
        detail: redactText(e.message),
        ...(redact(context) as object),
      },
      e.stack ? redactText(e.stack) : undefined,
    );
  }
}

export class NoopErrorReporter implements ErrorReporter {
  report(): void {
    // Intentionally empty (ERROR_REPORTER=none).
  }
}

let current: ErrorReporter = new ConsoleErrorReporter();

export function setErrorReporter(reporter: ErrorReporter): void {
  current = reporter;
}

export function errorReporter(): ErrorReporter {
  return current;
}
