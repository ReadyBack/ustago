import type {
  PushMessage,
  PushProvider,
  PushReceiptResult,
  PushTicketResult,
} from './push-provider.js';
import { PushTransportError } from './push-provider.js';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo accepts at most 100 messages per send and 1000 ids per receipt call. */
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 300;
const TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

type Fetch = typeof fetch;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}
interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Expo Push API over plain HTTPS (no SDK dependency). Called by the push
 * worker after the business transaction committed, never inside one.
 */
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  readonly delivers = true;

  constructor(
    private readonly accessToken: string | undefined,
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
    private readonly timeoutMs = 10_000,
  ) {}

  async send(messages: PushMessage[]): Promise<PushTicketResult[]> {
    const results: PushTicketResult[] = [];
    for (let i = 0; i < messages.length; i += SEND_CHUNK) {
      const chunk = messages.slice(i, i + SEND_CHUNK);
      // A malformed token never reaches Expo; it is reported like a dead one.
      const valid = chunk.filter((m) => TOKEN.test(m.to));
      const tickets = valid.length > 0 ? await this.sendChunk(valid) : [];
      let next = 0;
      for (const m of chunk) {
        if (!TOKEN.test(m.to)) {
          results.push({
            status: 'error',
            error: 'InvalidExpoPushToken',
            message: 'Not an Expo push token',
          });
          continue;
        }
        const t = tickets[next++];
        results.push(toTicket(t));
      }
    }
    return results;
  }

  async receipts(ticketIds: string[]): Promise<Map<string, PushReceiptResult>> {
    const out = new Map<string, PushReceiptResult>();
    for (let i = 0; i < ticketIds.length; i += RECEIPT_CHUNK) {
      const ids = ticketIds.slice(i, i + RECEIPT_CHUNK);
      const body = await this.post(RECEIPTS_URL, { ids });
      const data = (body as { data?: Record<string, ExpoReceipt> }).data ?? {};
      for (const [id, r] of Object.entries(data)) {
        out.set(
          id,
          r.status === 'ok'
            ? { status: 'ok' }
            : {
                status: 'error',
                error: r.details?.error ?? 'UnknownError',
                message: r.message ?? '',
              },
        );
      }
    }
    return out;
  }

  private async sendChunk(messages: PushMessage[]): Promise<ExpoTicket[]> {
    const body = await this.post(
      SEND_URL,
      messages.map((m) => ({
        to: m.to,
        title: m.title,
        body: m.body,
        sound: 'default',
        priority: 'high',
        ...(m.data ? { data: m.data } : {}),
      })),
    );
    const data = (body as { data?: ExpoTicket[] }).data;
    if (!Array.isArray(data) || data.length !== messages.length) {
      throw new PushTransportError('Unexpected Expo push response', true);
    }
    return data;
  }

  private async post(url: string, payload: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new PushTransportError(
        `Expo push request failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
    const text = await res.text();
    if (!res.ok) {
      // 429 and 5xx are temporary; 4xx (bad credentials, bad payload) are not.
      const retryable = res.status === 429 || res.status >= 500;
      throw new PushTransportError(
        `Expo push HTTP ${res.status}: ${text.slice(0, 200)}`,
        retryable,
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new PushTransportError('Expo push response is not JSON', true);
    }
  }
}

function toTicket(t: ExpoTicket | undefined): PushTicketResult {
  if (!t) return { status: 'error', error: 'MissingTicket', message: 'No ticket returned' };
  if (t.status === 'ok') return { status: 'ok', ticketId: t.id ?? null };
  return {
    status: 'error',
    error: t.details?.error ?? 'UnknownError',
    message: t.message ?? '',
  };
}
