/** One audit trail entry as shown to admins. Metadata never holds secrets. */
export interface AuditEvent {
  id: string;
  action: string;
  actor: { id: string; displayName: string } | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
