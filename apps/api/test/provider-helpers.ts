import type { AuthTokens, UploadIntentResponse } from '@ustago/types';
import { uploadIntentResponseSchema } from '@ustago/validation';

import { bearer, phoneLogin, RUN_ID, type TestContext } from './helpers.js';

/** Smallest byte strings the magic-byte check accepts. */
export const FILES = {
  png: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
  ]),
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]),
  pdf: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 3)]),
  html: Buffer.from('<html><script>alert(1)</script></html>'),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
} as const;

export interface Actor {
  tokens: AuthTokens;
  userId: string;
}

export const asActor = (auth: { tokens: AuthTokens; user: { id: string } }): Actor => ({
  tokens: auth.tokens,
  userId: auth.user.id,
});

export const PROFILE = {
  displayName: 'Test Usta Elektrik',
  bio: 'Yirmi yıllık tecrübeyle elektrik ve tesisat işleri yapıyorum.',
  yearsOfExperience: 12,
} as const;

/** Path part of a signed URL (the test server listens on a random port). */
export const pathOf = (url: string) => new URL(url).pathname;

/** A provider signed in with a verified phone and an empty DRAFT profile. */
export async function draftProvider(ctx: TestContext): Promise<Actor & { providerId: string }> {
  const auth = await phoneLogin(ctx, undefined, { firstName: 'Test', lastName: 'Usta' });
  const res = await ctx
    .http()
    .post('/api/v1/providers/me')
    .set('Authorization', bearer(auth))
    .send({ displayName: PROFILE.displayName })
    .expect(201);
  return { ...asActor(auth), providerId: res.body.id };
}

export interface Catalog {
  nowCategoryId: string;
  plainCategoryId: string;
  provinceId: number;
  districtIds: string[];
  otherProvinceDistrictId: string;
}

/** Test-owned categories (removed by cleanup) and districts of one province. */
export async function catalog(ctx: TestContext, provinceId = 81): Promise<Catalog> {
  const tag = `e2e-${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;
  const now = await ctx.prisma.serviceCategory.create({
    data: { slug: `${tag}-now`, name: `E2E Acil ${tag}`, supportsNow: true },
  });
  const plain = await ctx.prisma.serviceCategory.create({
    data: { slug: `${tag}-plain`, name: `E2E Normal ${tag}`, supportsNow: false },
  });
  const districts = await ctx.prisma.district.findMany({
    where: { provinceId },
    take: 2,
    orderBy: { name: 'asc' },
  });
  const other = await ctx.prisma.district.findFirstOrThrow({
    where: { provinceId: provinceId === 1 ? 2 : 1 },
  });
  return {
    nowCategoryId: now.id,
    plainCategoryId: plain.id,
    provinceId,
    districtIds: districts.map((d) => d.id),
    otherProvinceDistrictId: other.id,
  };
}

export async function createUploadIntent(
  ctx: TestContext,
  actor: Actor,
  body: Partial<{ type: string; fileName: string; mimeType: string; sizeBytes: number }> = {},
): Promise<UploadIntentResponse> {
  const res = await ctx
    .http()
    .post('/api/v1/providers/me/verifications/upload-intent')
    .set('Authorization', bearer(actor))
    .send({
      type: 'IDENTITY',
      fileName: 'kimlik-on-yuz.png',
      mimeType: 'image/png',
      sizeBytes: FILES.png.length,
      ...body,
    })
    .expect(201);
  return uploadIntentResponseSchema.parse(res.body);
}

export function putFile(
  ctx: TestContext,
  intent: UploadIntentResponse,
  bytes: Buffer,
  contentType = intent.headers['Content-Type'] ?? 'application/octet-stream',
) {
  return ctx.http().put(pathOf(intent.uploadUrl)).set('Content-Type', contentType).send(bytes);
}

/** Upload intent → PUT → submit, returning the verification id. */
export async function uploadVerification(
  ctx: TestContext,
  actor: Actor,
  type = 'IDENTITY',
): Promise<string> {
  const intent = await createUploadIntent(ctx, actor, { type });
  await putFile(ctx, intent, FILES.png).expect(204);
  const res = await ctx
    .http()
    .post('/api/v1/providers/me/verifications')
    .set('Authorization', bearer(actor))
    .send({ type, uploadId: intent.uploadId })
    .expect(201);
  return res.body.id;
}

/** Fills every onboarding step (profile, services, areas, identity document). */
export async function completeOnboarding(ctx: TestContext, actor: Actor, c: Catalog) {
  const auth = bearer(actor);
  await ctx
    .http()
    .patch('/api/v1/providers/me')
    .set('Authorization', auth)
    .send(PROFILE)
    .expect(200);
  await ctx
    .http()
    .put('/api/v1/providers/me/services')
    .set('Authorization', auth)
    .send({ categoryIds: [c.nowCategoryId, c.plainCategoryId] })
    .expect(200);
  await ctx
    .http()
    .put('/api/v1/providers/me/service-areas')
    .set('Authorization', auth)
    .send({ areas: [{ provinceId: c.provinceId, districtIds: c.districtIds }] })
    .expect(200);
  const verificationId = await uploadVerification(ctx, actor);
  return { verificationId };
}

/** A provider whose application is waiting for review. */
export async function pendingProvider(ctx: TestContext, c: Catalog) {
  const provider = await draftProvider(ctx);
  const { verificationId } = await completeOnboarding(ctx, provider, c);
  await ctx
    .http()
    .post('/api/v1/providers/me/submit')
    .set('Authorization', bearer(provider))
    .expect(200);
  return { ...provider, verificationId };
}
