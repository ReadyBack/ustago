/** Standard error body returned by every API endpoint. */
export interface ApiErrorResponse {
  statusCode: number;
  /** Stable machine-readable code, e.g. `VALIDATION_FAILED`. */
  code: string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
  requestId?: string;
}
