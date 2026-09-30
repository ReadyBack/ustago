import type { PrismaClient, ProviderVerificationStatus } from '../generated/prisma/client.js';
import { writeDemoDocument } from './seed-dev.js';

/**
 * DEMO verification and account states (Faz 6, development only; see
 * main.ts). Every demo provider gets a verification case the first time;
 * a later run changes nothing, so an admin's decisions in the demo stay.
 *
 *  VERIFIED        klima, elektrik, tesisat, Mehmet Usta
 *  SUBMITTED       usta-bekleyen (waits in "Doğrulama Talepleri")
 *  NEEDS_REVISION  usta-revizyon (identity photo unreadable)
 *  SUSPENDED       usta-askida (account suspended, case suspended)
 *
 * Cases are marked source=DEMO_SEED and every reason says DEMO.
 */
const ADMIN_EMAIL = 'dogrulama@ustago.test';

type Target = 'VERIFIED' | 'SUBMITTED' | 'NEEDS_REVISION' | 'SUSPENDED';

const TARGETS: Record<string, Target> = {
  'usta-klima@ustago.test': 'VERIFIED',
  'usta-elektrik@ustago.test': 'VERIFIED',
  'usta-tesisat@ustago.test': 'VERIFIED',
  'usta@ustago.test': 'VERIFIED',
  'usta-bekleyen@ustago.test': 'SUBMITTED',
  'usta-revizyon@ustago.test': 'NEEDS_REVISION',
  'usta-askida@ustago.test': 'SUSPENDED',
};

const REVISION_REASON =
  'DEMO: Kimlik belgesinin fotoğrafı okunamıyor. Lütfen net bir fotoğraf yükleyin.';
const SUSPENSION_REASON =
  'DEMO: Müşteri şikâyetleri inceleniyor. İnceleme süresince yeni iş alamazsınız.';

export async function seedDemoTrust(
  prisma: PrismaClient,
  storageDir = process.env['STORAGE_LOCAL_DIR'] || '.data/storage',
): Promise<number> {
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  let created = 0;
  for (const [email, target] of Object.entries(TARGETS)) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { providerProfile: { include: { verificationCase: true } } },
    });
    const profile = user?.providerProfile;
    if (!profile || profile.verificationCase) continue;

    const now = new Date();
    const caseStatus: ProviderVerificationStatus = target;
    const decided = target !== 'SUBMITTED';
    const verification = await prisma.providerVerificationCase.create({
      data: {
        providerId: profile.id,
        status: caseStatus,
        source: 'DEMO_SEED',
        submittedAt: now,
        submissionCount: 1,
        reviewStartedAt: decided ? now : null,
        reviewedByAdminId: decided ? (admin?.id ?? null) : null,
        decidedAt: decided ? now : null,
        decisionByAdminId: decided ? (admin?.id ?? null) : null,
        verifiedAt: target === 'VERIFIED' || target === 'SUSPENDED' ? now : null,
        decisionReasonCode: target === 'NEEDS_REVISION' ? 'DOCUMENT_UNREADABLE' : null,
        userVisibleReason: target === 'NEEDS_REVISION' ? REVISION_REASON : null,
      },
    });
    await prisma.providerVerificationEvent.create({
      data: {
        caseId: verification.id,
        providerId: profile.id,
        event: 'provider.verification.demo_seed',
        fromStatus: null,
        toStatus: caseStatus,
        actorType: 'SYSTEM',
        userVisibleReason: target === 'NEEDS_REVISION' ? REVISION_REASON : null,
        internalNote: 'DEMO DATA: seed ile oluşturuldu.',
      },
    });

    // Documents: attach the existing ones and add the identity document
    // the state implies.
    await prisma.providerVerification.updateMany({
      where: { providerId: profile.id, caseId: null },
      data: { caseId: verification.id },
    });
    const identity = await prisma.providerVerification.count({
      where: { providerId: profile.id, type: 'IDENTITY' },
    });
    if (identity === 0 && target !== 'SUBMITTED') {
      const file = await writeDemoDocument(storageDir, profile.id);
      const approved = target === 'VERIFIED' || target === 'SUSPENDED';
      await prisma.providerVerification.create({
        data: {
          providerId: profile.id,
          caseId: verification.id,
          type: 'IDENTITY',
          status: approved ? 'APPROVED' : 'REJECTED',
          documentKey: file.key,
          mimeType: 'image/png',
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          scanStatus: 'NOT_SCANNED',
          originalFileName: 'DEMO-kimlik-belgesi.png',
          reviewedAt: now,
          reviewedById: admin?.id ?? null,
          rejectionReason: approved ? null : REVISION_REASON,
        },
      });
    }

    if (target === 'SUSPENDED') {
      await prisma.providerSuspension.create({
        data: {
          providerId: profile.id,
          status: 'ACTIVE',
          level: 'SUSPENDED',
          reasonCode: 'QUALITY_ISSUES',
          internalNote: 'DEMO DATA: askı ekranını göstermek için.',
          userVisibleReason: SUSPENSION_REASON,
          startsAt: now,
          createdById: admin?.id ?? null,
        },
      });
      await prisma.providerProfile.update({
        where: { id: profile.id },
        data: { accountStatus: 'SUSPENDED', accountStatusChangedAt: now, isAvailableNow: false },
      });
    }
    if (target === 'NEEDS_REVISION') {
      await prisma.providerProfile.update({
        where: { id: profile.id },
        data: { statusReason: REVISION_REASON },
      });
    }
    created += 1;
  }
  return created;
}
