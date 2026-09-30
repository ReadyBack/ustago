/**
 * Port for push delivery (docs/adr/0017). The notification domain only
 * knows this interface; Expo is one adapter, a direct FCM/APNs adapter
 * could replace it without touching the outbox.
 */
export interface PushMessage {
  /** Device push token (for Expo: "ExponentPushToken[...]"). */
  to: string;
  title: string;
  body: string;
  /** Ids the app needs to open the right screen. Never personal data. */
  data?: Record<string, string>;
}

export type PushTicketResult =
  | { status: 'ok'; ticketId: string | null }
  | {
      status: 'error';
      /** Provider error code, e.g. "DeviceNotRegistered". */
      error: string;
      message: string;
    };

export type PushReceiptResult =
  { status: 'ok' } | { status: 'error'; error: string; message: string };

export interface PushProvider {
  /** "expo", "console" or "disabled". */
  readonly name: string;
  /**
   * True only for adapters that hand messages to a real push service.
   * Console and disabled adapters never claim a delivery.
   */
  readonly delivers: boolean;
  /** One ticket per message, in order. Throws PushTransportError when the call itself failed. */
  send(messages: PushMessage[]): Promise<PushTicketResult[]>;
  /** Receipts by ticket id; ids the service does not know yet are missing from the map. */
  receipts(ticketIds: string[]): Promise<Map<string, PushReceiptResult>>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export class PushTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PushTransportError';
  }
}

/** The token is dead: stop sending to it (Expo "DeviceNotRegistered"). */
export function isDeadTokenError(error: string): boolean {
  return error === 'DeviceNotRegistered' || error === 'InvalidExpoPushToken';
}

/** Errors worth another attempt later (rate limits, temporary outages). */
export function isRetryableTicketError(error: string): boolean {
  return error === 'MessageRateExceeded' || error === 'TooManyRequests';
}
