import { signedUrlSchema, uuidSchema } from '@ustago/validation';
import { type NextRequest, NextResponse } from 'next/server';

import { apiRequest } from '@/lib/api';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

/**
 * Streams a verification document to a signed-in admin. The API issues a
 * two-minute signed link (and writes an audit entry); the browser never
 * sees it. The response cannot be cached, sniffed, framed or run scripts.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/verifications/[id]/document'>) {
  const { id: rawId } = await ctx.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) return new NextResponse('Bulunamadı', { status: 404 });

  const link = await apiRequest(`/admin/provider-verifications/${id.data}/document-url`, {
    method: 'POST',
    schema: signedUrlSchema,
  });
  if (!link.ok) {
    if (link.status === 401) {
      const refresh = new URL('/auth/refresh', request.url);
      refresh.searchParams.set('next', request.nextUrl.pathname);
      return NextResponse.redirect(refresh);
    }
    return new NextResponse(link.message, { status: link.status === 403 ? 403 : 404 });
  }

  const file = await fetch(link.data.url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const type = file.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!file.ok || !file.body || !ALLOWED_TYPES.has(type)) {
    return new NextResponse('Belge açılamadı', { status: 502 });
  }
  return new NextResponse(file.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
    },
  });
}
