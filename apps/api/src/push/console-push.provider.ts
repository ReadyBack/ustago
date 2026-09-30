import { Logger } from '@nestjs/common';

import type { PushMessage, PushProvider, PushReceiptResult, PushTicketResult } from './push-provider.js';

/**
 * Development only: prints each push to the API log and sends nothing.
 * The worker records these attempts as DEV_LOGGED, never as SENT, so no
 * screen or report can mistake them for a real delivery. The env schema
 * refuses this adapter in production and the constructor double-checks.
 */
export class ConsolePushProvider implements PushProvider {
  readonly name = 'console';
  readonly delivers = false;
  private readonly logger = new Logger('ConsolePush');

  constructor(nodeEnv: string) {
    if (nodeEnv === 'production') {
      throw new Error('ConsolePushProvider must not be used in production.');
    }
  }

  send(messages: PushMessage[]): Promise<PushTicketResult[]> {
    for (const m of messages) {
      this.logger.log(
        `[DEV PUSH] (gönderilmedi, yalnızca geliştirme günlüğü)\n` +
          `  to: ${maskToken(m.to)}\n  title: ${m.title}\n  body: ${m.body}` +
          (m.data ? `\n  data: ${JSON.stringify(m.data)}` : ''),
      );
    }
    return Promise.resolve(messages.map(() => ({ status: 'ok', ticketId: null })));
  }

  receipts(): Promise<Map<string, PushReceiptResult>> {
    return Promise.resolve(new Map());
  }
}

/** "ExponentPushToken[abcdefgh1234]" → "ExponentPushToken[abcd…]": tokens are credentials. */
export function maskToken(token: string): string {
  const open = token.indexOf('[');
  if (open === -1) return `${token.slice(0, 6)}…`;
  return `${token.slice(0, open + 5)}…]`;
}
