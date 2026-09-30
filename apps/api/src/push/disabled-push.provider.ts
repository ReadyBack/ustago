import type { PushProvider, PushReceiptResult, PushTicketResult } from './push-provider.js';

/** Push turned off: the worker skips deliveries; in-app notifications still work. */
export class DisabledPushProvider implements PushProvider {
  readonly name = 'disabled';
  readonly delivers = false;

  send(): Promise<PushTicketResult[]> {
    return Promise.reject(new Error('Push is disabled'));
  }

  receipts(): Promise<Map<string, PushReceiptResult>> {
    return Promise.resolve(new Map());
  }
}
