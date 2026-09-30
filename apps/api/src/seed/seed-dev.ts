import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { hash } from '@node-rs/argon2';

import type {
  AdminPermission,
  PrismaClient,
  ProviderStatus,
  Role,
} from '../generated/prisma/client.js';

/** Adana (plate 1) is the local demo market; İstanbul keeps the Faz 1 provider. */
export const DEMO_PROVINCE_ID = 1;
const ISTANBUL = 34;

interface DemoProvider {
  displayName: string;
  bio: string;
  provinceId: number;
  categories: string[];
  districts: string[];
  status: ProviderStatus;
  nowEnabled: boolean;
  isAvailableNow: boolean;
  /** Seeds a PENDING identity document so the admin review queue has a file. */
  pendingDocument?: boolean;
}

interface DevUser {
  email: string;
  /**
   * Prefix 500 is not allocated to any Turkish operator, so these numbers
   * belong to no one. In development SMS only goes to the API console.
   */
  phone?: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  /** Faz 6 staff permissions (docs/adr/0024); SUPER_ADMIN implies all. */
  adminPermissions?: AdminPermission[];
  address?: { district: string; neighborhood: string; addressLine: string };
  provider?: DemoProvider;
}

const DEMO_BIO =
  'DEMO DATA: yerel geliştirme için oluşturulmuş örnek usta. Gerçek bir kişi değildir.';

/** `.test` is a reserved TLD, so these addresses can never reach a real inbox. */
export const DEV_USERS: readonly DevUser[] = [
  {
    email: 'admin@ustago.test',
    firstName: 'Dev',
    lastName: 'Admin',
    roles: ['CUSTOMER', 'SUPER_ADMIN'],
  },
  // Faz 6 staff accounts, one per permission (DEMO; docs/adr/0024).
  {
    email: 'destek@ustago.test',
    firstName: 'Destek',
    lastName: 'Demo',
    roles: ['ADMIN'],
    adminPermissions: ['ADMIN_SUPPORT'],
  },
  {
    email: 'finans@ustago.test',
    firstName: 'Finans',
    lastName: 'Demo',
    roles: ['ADMIN'],
    adminPermissions: ['ADMIN_FINANCE'],
  },
  {
    email: 'dogrulama@ustago.test',
    firstName: 'Doğrulama',
    lastName: 'Demo',
    roles: ['ADMIN'],
    adminPermissions: ['ADMIN_VERIFICATION'],
  },
  {
    email: 'musteri@ustago.test',
    phone: '+905000000001',
    firstName: 'Ayşe',
    lastName: 'Demo',
    roles: ['CUSTOMER'],
    address: {
      district: 'seyhan',
      neighborhood: 'Reşatbey Mah. (DEMO)',
      addressLine: 'Demo Sokak No: 1 (DEMO DATA)',
    },
  },
  ...(['Zeynep', 'Ali', 'Elif'] as const).map((firstName, i): DevUser => ({
    email: `demo-musteri-${firstName.toLowerCase()}@ustago.test`,
    phone: `+90500000001${i + 1}`,
    firstName,
    lastName: 'Demo',
    roles: ['CUSTOMER'],
    address: {
      district: i === 1 ? 'cukurova' : 'seyhan',
      neighborhood: 'DEMO Mahallesi',
      addressLine: `Demo Caddesi No: ${i + 10} (DEMO DATA)`,
    },
  })),
  {
    email: 'usta-klima@ustago.test',
    phone: '+905000000002',
    firstName: 'Kemal',
    lastName: 'Demo',
    roles: ['CUSTOMER', 'PROVIDER'],
    provider: {
      displayName: 'Demo Klima Ustası',
      bio: DEMO_BIO,
      provinceId: DEMO_PROVINCE_ID,
      categories: ['klima', 'beyaz-esya'],
      districts: ['seyhan', 'cukurova'],
      status: 'ACTIVE',
      nowEnabled: true,
      isAvailableNow: true,
    },
  },
  {
    email: 'usta-elektrik@ustago.test',
    phone: '+905000000003',
    firstName: 'Hakan',
    lastName: 'Demo',
    roles: ['CUSTOMER', 'PROVIDER'],
    provider: {
      displayName: 'Demo Elektrik Ustası',
      bio: DEMO_BIO,
      provinceId: DEMO_PROVINCE_ID,
      categories: ['elektrik', 'klima'],
      districts: ['seyhan', 'cukurova', 'yuregir'],
      status: 'ACTIVE',
      nowEnabled: true,
      isAvailableNow: false,
    },
  },
  {
    email: 'usta-tesisat@ustago.test',
    phone: '+905000000004',
    firstName: 'Serkan',
    lastName: 'Demo',
    roles: ['CUSTOMER', 'PROVIDER'],
    provider: {
      displayName: 'Demo Tesisat Ustası',
      bio: DEMO_BIO,
      provinceId: DEMO_PROVINCE_ID,
      categories: ['su-tesisati', 'boya-badana'],
      districts: ['cukurova'],
      status: 'ACTIVE',
      nowEnabled: false,
      isAvailableNow: false,
    },
  },
  {
    email: 'usta-bekleyen@ustago.test',
    phone: '+905000000005',
    firstName: 'Deniz',
    lastName: 'Demo',
    roles: ['CUSTOMER', 'PROVIDER'],
    provider: {
      displayName: 'Demo Bekleyen Usta',
      bio: DEMO_BIO,
      provinceId: DEMO_PROVINCE_ID,
      categories: ['klima'],
      districts: ['seyhan'],
      status: 'PENDING_REVIEW',
      nowEnabled: false,
      isAvailableNow: false,
      pendingDocument: true,
    },
  },
  {
    email: 'usta-revizyon@ustago.test',
    phone: '+905000000006',
    firstName: 'Burak',
    lastName: 'Demo',
    roles: ['CUSTOMER', 'PROVIDER'],
    provider: {
      displayName: 'Demo Revizyon Bekleyen Usta',
      bio: DEMO_BIO,
      provinceId: DEMO_PROVINCE_ID,
      categories: ['boya-badana'],
      districts: ['seyhan'],
      status: 'DRAFT',
      nowEnabled: false,
      isAvailableNow: false,
    },
  },
  {
    email: 'usta-askida@ustago.test',
    phone: '+905000000007',
    firstName: 'Cem',
    lastName: 'Demo',
    roles: ['CUSTOMER', 'PROVIDER'],
    provider: {
      displayName: 'Demo Askıdaki Usta',
      bio: DEMO_BIO,
      provinceId: DEMO_PROVINCE_ID,
      categories: ['su-tesisati'],
      districts: ['seyhan', 'yuregir'],
      status: 'ACTIVE',
      nowEnabled: false,
      isAvailableNow: false,
    },
  },
  {
    email: 'usta@ustago.test',
    firstName: 'Mehmet',
    lastName: 'Usta',
    roles: ['CUSTOMER', 'PROVIDER'],
    provider: {
      displayName: 'Mehmet Usta Elektrik & Tesisat',
      bio: DEMO_BIO,
      provinceId: ISTANBUL,
      categories: ['elektrik', 'su-tesisati'],
      districts: ['kadikoy', 'uskudar', 'atasehir'],
      status: 'ACTIVE',
      nowEnabled: true,
      isAvailableNow: false,
    },
  },
];

export interface DevSeedResult {
  created: string[];
  existing: string[];
  /** Only set when the seed generated the password itself. */
  generatedPassword: string | null;
}

type Db = PrismaClient;

/**
 * Development-only demo data (never run in production, see main.ts).
 * Idempotent: a second run creates nothing and keeps what an admin or a
 * tester changed (an approved pending provider stays approved). The
 * password comes from SEED_DEV_PASSWORD or is generated once and printed by
 * the caller; it is never stored in the repository.
 */
export async function seedDevData(
  prisma: PrismaClient,
  passwordFromEnv: string | undefined,
  storageDir = process.env['STORAGE_LOCAL_DIR'] || '.data/storage',
): Promise<DevSeedResult> {
  const generatedPassword = passwordFromEnv ? null : randomBytes(12).toString('base64url');
  const password = passwordFromEnv ?? generatedPassword ?? '';
  if (password.length < 10) throw new Error('SEED_DEV_PASSWORD must be at least 10 characters.');
  const passwordHash = await hash(password, { algorithm: 2, memoryCost: 19_456, timeCost: 2 });

  // Dev convenience: open the demo provinces.
  await prisma.province.updateMany({
    where: { id: { in: [DEMO_PROVINCE_ID, ISTANBUL] } },
    data: { isActive: true },
  });
  // Air-conditioning breakdowns are urgent in an Adana summer: the demo
  // offers Klima as NOW (reference data now says so for new databases too).
  await prisma.serviceCategory.updateMany({
    where: { slug: 'klima' },
    data: { supportsNow: true },
  });

  const result: DevSeedResult = { created: [], existing: [], generatedPassword: null };
  for (const devUser of DEV_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: devUser.email } });
    let userId: string;
    if (existing) {
      result.existing.push(devUser.email);
      userId = existing.id;
      if (passwordFromEnv) {
        await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
      }
      if (devUser.phone && !existing.phone) {
        const taken = await prisma.user.findUnique({ where: { phone: devUser.phone } });
        if (!taken) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { phone: devUser.phone, phoneVerifiedAt: new Date() },
          });
        }
      }
    } else {
      const user = await prisma.user.create({
        data: {
          email: devUser.email,
          phone: devUser.phone ?? null,
          passwordHash,
          firstName: devUser.firstName,
          lastName: devUser.lastName,
          emailVerifiedAt: new Date(),
          phoneVerifiedAt: devUser.phone ? new Date() : null,
          customerProfile: { create: {} },
        },
      });
      userId = user.id;
      result.created.push(devUser.email);
    }
    await prisma.userRole.createMany({
      data: devUser.roles.map((role) => ({ userId, role })),
      skipDuplicates: true,
    });
    if (devUser.adminPermissions) {
      await prisma.adminPermissionGrant.createMany({
        data: devUser.adminPermissions.map((permission) => ({ userId, permission })),
        skipDuplicates: true,
      });
    }
    await prisma.customerProfile.upsert({ where: { userId }, create: { userId }, update: {} });
    if (devUser.address) await ensureAddress(prisma, userId, devUser.address);
    if (devUser.provider) await ensureProvider(prisma, userId, devUser.provider, storageDir);
  }

  if (result.created.length > 0) result.generatedPassword = generatedPassword;
  return result;
}

async function ensureAddress(
  prisma: Db,
  userId: string,
  address: NonNullable<DevUser['address']>,
): Promise<void> {
  const count = await prisma.address.count({ where: { userId, deletedAt: null } });
  if (count > 0) return;
  const district = await prisma.district.findUniqueOrThrow({
    where: { provinceId_slug: { provinceId: DEMO_PROVINCE_ID, slug: address.district } },
  });
  await prisma.address.create({
    data: {
      userId,
      label: 'Ev (DEMO)',
      provinceId: DEMO_PROVINCE_ID,
      districtId: district.id,
      neighborhood: address.neighborhood,
      addressLine: address.addressLine,
      buildingNo: '1',
      apartmentNo: '3',
      isDefault: true,
    },
  });
}

async function ensureProvider(
  prisma: Db,
  userId: string,
  p: DemoProvider,
  storageDir: string,
): Promise<void> {
  const active = p.status === 'ACTIVE';
  const profile =
    (await prisma.providerProfile.findUnique({ where: { userId } })) ??
    (await prisma.providerProfile.create({
      data: {
        userId,
        displayName: p.displayName,
        bio: p.bio,
        status: p.status,
        approvedAt: active ? new Date() : null,
        submittedAt: new Date(),
        nowEnabled: p.nowEnabled,
        isAvailableNow: active && p.isAvailableNow,
        yearsOfExperience: 10,
      },
    }));

  const categories = await prisma.serviceCategory.findMany({
    where: { slug: { in: p.categories } },
    select: { id: true },
  });
  await prisma.providerService.createMany({
    data: categories.map((c) => ({ providerId: profile.id, categoryId: c.id })),
    skipDuplicates: true,
  });
  const districts = await prisma.district.findMany({
    where: { provinceId: p.provinceId, slug: { in: p.districts } },
    select: { id: true },
  });
  await prisma.providerServiceArea.createMany({
    data: districts.map((d) => ({ providerId: profile.id, districtId: d.id })),
    skipDuplicates: true,
  });
  if (p.pendingDocument) {
    const documents = await prisma.providerVerification.count({
      where: { providerId: profile.id },
    });
    if (documents === 0) {
      const file = await writeDemoDocument(storageDir, profile.id);
      await prisma.providerVerification.create({
        data: {
          providerId: profile.id,
          type: 'IDENTITY',
          status: 'PENDING',
          documentKey: file.key,
          mimeType: 'image/png',
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          scanStatus: 'NOT_SCANNED',
          originalFileName: 'DEMO-kimlik-belgesi.png',
        },
      });
    }
  }
}

/** Writes a DEMO placeholder document the way LocalObjectStorage stores uploads. */
export async function writeDemoDocument(
  storageDir: string,
  providerId: string,
): Promise<{ key: string; sizeBytes: number; sha256: string }> {
  const key = `verifications/${providerId}/${randomUUID()}.png`;
  // A per-provider shade, so demo files never look like shared duplicates.
  const png = demoPng(createHash('sha256').update(providerId).digest()[0] ?? 0);
  const path = resolve(storageDir, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, png);
  await writeFile(`${path}.meta.json`, JSON.stringify({ contentType: 'image/png' }));
  return { key, sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex') };
}

/** A plain 240×150 PNG placeholder (grey card with an orange band), built without dependencies. */
function demoPng(variant = 0): Buffer {
  const width = 240;
  const height = 150;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const band = y < 30;
      const [r, g, b] = band ? [249, 115 - (variant % 40), 22] : [229, 231, 235];
      row.set([r, g, b], 1 + x * 3);
    }
    rows.push(row);
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
