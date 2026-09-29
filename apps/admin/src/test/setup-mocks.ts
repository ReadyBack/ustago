import { vi } from 'vitest';

/** In-memory cookie jar standing in for next/headers in unit tests. */
export interface CookieCall {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

export function mockCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const sets: CookieCall[] = [];
  const deletes: string[] = [];
  const store = {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.set(name, value);
      sets.push({ name, value, options });
    },
    delete: (name: string) => {
      jar.delete(name);
      deletes.push(name);
    },
  };
  return { store, jar, sets, deletes };
}

export class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const fetchMock = vi.fn<typeof fetch>();
