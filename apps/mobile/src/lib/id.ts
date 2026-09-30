/**
 * Random UUID v4 for idempotency keys (not a secret, so Math.random is
 * acceptable; crypto.randomUUID is used when the runtime has it).
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
