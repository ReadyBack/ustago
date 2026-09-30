/**
 * A failed page-level API read. The admin app cannot see an admin's
 * permission grants (GET /me carries roles only), so pages rely on the API:
 * a 403 here means the grant is missing and reads as a permission notice,
 * not as a broken page.
 */
export function ApiErrorNotice({
  error,
  what,
}: {
  error: { status: number; message: string };
  /** What could not be loaded, e.g. "Pazar yeri özeti". */
  what: string;
}) {
  if (error.status === 403) {
    return (
      <p role="alert" className="notice">
        {what} için yetkiniz yok. Yetki gerekiyorsa bir süper yöneticiye başvurun.
      </p>
    );
  }
  return (
    <p role="alert" className="notice">
      {what} alınamadı: {error.message}
    </p>
  );
}
