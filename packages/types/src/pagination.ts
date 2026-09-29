/** Cursor-paginated list. Pass `nextCursor` back as `cursor` for the next page. */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
