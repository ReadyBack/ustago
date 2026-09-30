/**
 * Small helpers shared by the Server Actions. The state shape matches
 * `ModerationState`, so every action works with `ModerationForm`.
 */
export interface ActionState {
  ok?: boolean;
  error?: string;
}

export const INVALID: ActionState = { error: 'Geçersiz istek.' };

export function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

/** The explicit "I confirm" checkbox (`name="confirm" value="yes"`). */
export function isConfirmed(form: FormData): boolean {
  return form.get('confirm') === 'yes';
}

/**
 * A Turkish message for the first failing field: `fields` maps a field name
 * to its message; otherwise the schema's own message is shown.
 */
export function issueMessage(
  error: { issues: readonly { message: string; path: readonly PropertyKey[] }[] },
  fields: Record<string, string> = {},
): string {
  const issue = error.issues[0];
  if (!issue) return 'Geçersiz istek.';
  const field = issue.path[0];
  if (typeof field === 'string' && Object.hasOwn(fields, field)) return fields[field] as string;
  return issue.message;
}
