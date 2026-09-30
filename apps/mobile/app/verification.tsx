import type { ProviderVerificationCaseView, VerificationDocumentRequirement } from '@ustago/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { providerApi } from '../src/api/services';
import { api } from '../src/api/session';
import { useAuth } from '../src/auth/AuthContext';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../src/components/States';
import { Body, Heading, Small, Title } from '../src/components/Text';
import { useApi } from '../src/hooks/useApi';
import { type DocumentUploadState, useDocumentUpload } from '../src/hooks/useDocumentUpload';
import { useSubmit } from '../src/hooks/useSubmit';
import { formatDate, formatDateTime } from '../src/lib/format';
import { VERIFICATION_TYPE_LABEL } from '../src/lib/labels';
import { colors, radii, spacing } from '../src/lib/theme';
import {
  ACCOUNT_STATUS,
  accountNotice,
  canContinue,
  documentSatisfied,
  documentStateLabel,
  extraRequirements,
  identityRequirement,
  initialStep,
  LAST_STEP,
  missingBasics,
  nextStep,
  previousStep,
  rejectedDocuments,
  uploadProgress,
  VERIFICATION_STATUS,
  VERIFICATION_STEPS,
  VERIFIED_BADGE_LABEL,
  type VerificationStep,
} from '../src/lib/verification';

/**
 * "Hesabımı Doğrula": intro → identity document → extra documents →
 * review → status. Only documents are asked for; the app never asks for
 * the TC Kimlik number itself.
 */
export default function Verification() {
  const router = useRouter();
  const { user } = useAuth();
  if (!user?.providerProfile) {
    return (
      <Screen scroll={false}>
        <EmptyState
          icon="🔧"
          title="Usta hesabınız yok"
          body="Hesap doğrulaması usta hesapları içindir. Önce kısa bir başvuru yapın."
          action={{ title: 'Usta Ol', onPress: () => router.push('/provider-onboarding') }}
        />
      </Screen>
    );
  }
  return <Loader />;
}

function Loader() {
  const view = useApi<ProviderVerificationCaseView>(
    'provider:verification',
    providerApi.verificationCase,
  );
  if (view.loading) return <LoadingState />;
  if (view.error || !view.data) {
    return (
      <ErrorState message={view.error ?? 'Doğrulama bilgisi yüklenemedi.'} onRetry={view.refresh} />
    );
  }
  return <Flow view={view.data} refresh={view.refresh} setView={view.setData} />;
}

function Flow({
  view,
  refresh,
  setView,
}: {
  view: ProviderVerificationCaseView;
  refresh: () => Promise<void>;
  setView: (v: ProviderVerificationCaseView) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<VerificationStep>(() => initialStep(view));
  const upload = useDocumentUpload(refresh);
  const submit = useSubmit(async () => {
    setView(await providerApi.submitVerificationCase());
    setStep(LAST_STEP);
  });

  const back = previousStep(step);
  const footer =
    step === LAST_STEP ? (
      <Button
        title="Tamam"
        variant="secondary"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/provider'))}
      />
    ) : (
      <View style={styles.footer}>
        {back ? (
          <Button
            title="Geri"
            variant="secondary"
            style={styles.flex}
            onPress={() => setStep(back)}
          />
        ) : null}
        {step === 4 ? (
          <Button
            testID="submit-verification"
            title="İncelemeye Gönder"
            style={styles.flex}
            loading={submit.busy}
            disabled={!canContinue(4, view)}
            onPress={() => void submit.submit()}
          />
        ) : (
          <Button
            testID="verification-next"
            title="Devam"
            style={styles.flex}
            disabled={!canContinue(step, view) || upload.busyType !== null}
            onPress={() => setStep(nextStep(step))}
          />
        )}
      </View>
    );

  return (
    <Screen onRefresh={() => void refresh()} footer={footer}>
      <StepIndicator step={step} />
      {step === 1 ? <IntroStep view={view} /> : null}
      {step === 2 ? <IdentityStep view={view} upload={upload} /> : null}
      {step === 3 ? <ExtraStep view={view} upload={upload} /> : null}
      {step === 4 ? <ReviewStep view={view} error={submit.error} /> : null}
      {step === 5 ? <StatusStep view={view} onEdit={() => setStep(1)} /> : null}
    </Screen>
  );
}

function StepIndicator({ step }: { step: VerificationStep }) {
  const current = VERIFICATION_STEPS[step - 1];
  return (
    <View
      style={styles.steps}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Adım ${step}/${VERIFICATION_STEPS.length}: ${current?.title ?? ''}`}
      accessibilityValue={{ min: 1, max: VERIFICATION_STEPS.length, now: step }}
    >
      <Small>
        Adım {step}/{VERIFICATION_STEPS.length} · {current?.title}
      </Small>
      <View style={styles.segments}>
        {VERIFICATION_STEPS.map((s, i) => (
          <View key={s.key} style={[styles.segment, i < step && styles.segmentDone]} />
        ))}
      </View>
    </View>
  );
}

function ReasonBox({ view }: { view: ProviderVerificationCaseView }) {
  const rejected = rejectedDocuments(view);
  if (!view.userVisibleReason && rejected.length === 0) return null;
  return (
    <View style={styles.reason} testID="revision-reason">
      <Text style={styles.reasonTitle}>
        {view.status === 'REJECTED' ? 'Başvurunuz reddedildi' : 'Düzeltmeniz istenenler'}
      </Text>
      {view.userVisibleReason ? <Body>{view.userVisibleReason}</Body> : null}
      {rejected.map((d) => (
        <Body key={d.type}>
          • {VERIFICATION_TYPE_LABEL[d.type]}: reddedildi
          {d.current?.rejectionReason ? ` (${d.current.rejectionReason})` : ''}
        </Body>
      ))}
    </View>
  );
}

function IntroStep({ view }: { view: ProviderVerificationCaseView }) {
  const router = useRouter();
  const status = VERIFICATION_STATUS[view.status];
  const basics = missingBasics(view);
  const notice = accountNotice(view);
  return (
    <>
      <Card>
        <View style={styles.row}>
          <Title>Hesabımı Doğrula</Title>
          <Badge label={status.label} tone={status.tone} />
        </View>
        <Body muted>
          Doğrulanan ustaların profilinde “Kimliği/hesabı doğrulanmıştır” rozeti görünür; acil işler
          ve para çekme de doğrulamadan sonra açılır.
        </Body>
      </Card>
      <ReasonBox view={view} />
      <Card>
        <Heading>Neler gerekli?</Heading>
        <Body>
          1. Kimlik belgenizin fotoğrafı veya PDF’i (kimlik kartı, ehliyet ya da pasaport)
        </Body>
        <Body>2. Hizmet verdiğiniz kategorilerin istediği belgeler (varsa)</Body>
        <Body>3. Tamamlanmış profil, hizmet ve bölge bilgileri</Body>
        <Small>
          TC Kimlik numaranızı yazmanızı istemiyoruz. Belgeler yalnızca inceleme ekibine, kısa
          süreli güvenli bağlantıyla gösterilir. JPEG, PNG veya PDF; en fazla 10 MB.
        </Small>
      </Card>
      {basics.length > 0 ? (
        <Card>
          <Heading>Önce başvuru bilgilerini tamamlayın</Heading>
          {basics.map((b) => (
            <Body key={b}>• {b}</Body>
          ))}
          <Button
            title="Başvuru bilgilerine git"
            variant="secondary"
            onPress={() => router.push('/provider-onboarding')}
          />
        </Card>
      ) : null}
      {!view.canEditDocuments ? (
        <FormError
          message={
            notice
              ? `${notice.title}. Bu sürede belge gönderemezsiniz.`
              : 'Başvurunuz incelenirken belgeleri değiştiremezsiniz.'
          }
        />
      ) : null}
    </>
  );
}

type Upload = ReturnType<typeof useDocumentUpload>;

function IdentityStep({ view, upload }: { view: ProviderVerificationCaseView; upload: Upload }) {
  const identity = identityRequirement(view);
  return (
    <>
      <Card>
        <Heading>Kimlik belgesi</Heading>
        <Body muted>
          Kimlik kartınızın ön yüzünün net bir fotoğrafını veya taranmış PDF’ini yükleyin. Dört
          köşesi görünsün, yansıma olmasın.
        </Body>
        <Small>Numara veya başka bir bilgi yazmanız gerekmez; belge yeterlidir.</Small>
      </Card>
      <ReasonBox view={view} />
      {identity ? (
        <DocumentRow req={identity} view={view} upload={upload} />
      ) : (
        <Body muted>Kimlik belgesi bu hesap için istenmiyor.</Body>
      )}
    </>
  );
}

function ExtraStep({ view, upload }: { view: ProviderVerificationCaseView; upload: Upload }) {
  const extras = extraRequirements(view);
  const required = extras.filter((d) => d.required);
  const optional = extras.filter((d) => !d.required);
  return (
    <>
      <Card>
        <Heading>Ek belgeler</Heading>
        <Body muted>
          {required.length > 0
            ? 'Hizmet verdiğiniz kategoriler aşağıdaki belgeleri istiyor. İsteğe bağlı belgeler müşterilere güven verir.'
            : 'Kategorileriniz ek belge istemiyor. İsterseniz güven veren belgeler ekleyebilirsiniz.'}
        </Body>
      </Card>
      {required.map((d) => (
        <DocumentRow key={d.type} req={d} view={view} upload={upload} />
      ))}
      {optional.length > 0 ? <Heading>İsteğe bağlı</Heading> : null}
      {optional.map((d) => (
        <DocumentRow key={d.type} req={d} view={view} upload={upload} />
      ))}
    </>
  );
}

function DocumentRow({
  req,
  view,
  upload,
}: {
  req: VerificationDocumentRequirement;
  view: ProviderVerificationCaseView;
  upload: Upload;
}) {
  const doc = req.current;
  const state = documentStateLabel(doc);
  const u: DocumentUploadState = upload.stateOf(req.type);
  const running = u.stage === 'preparing' || u.stage === 'uploading' || u.stage === 'confirming';
  const progress = uploadProgress(u.stage);
  // A document waiting for review cannot be replaced (the server refuses a second one).
  const replaceable = view.canEditDocuments && doc?.status !== 'PENDING';
  const open = useSubmit(async () => {
    if (!doc) return;
    const signed = await providerApi.verificationUrl(doc.id);
    await Linking.openURL(api.reachable(signed.url));
  });

  return (
    <Card testID={`document-${req.type}`}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.docTitle}>{VERIFICATION_TYPE_LABEL[req.type]}</Text>
          <Small>{req.required ? `Zorunlu · ${req.reason}` : req.reason}</Small>
        </View>
        <Badge label={state.label} tone={state.tone} />
      </View>
      {doc ? (
        <Small>
          {doc.originalFileName ?? 'Belge'} · {formatDate(doc.submittedAt)}
        </Small>
      ) : null}
      {doc?.status === 'REJECTED' && doc.rejectionReason ? (
        <View style={styles.reason}>
          <Text style={styles.reasonTitle}>Reddedilme nedeni</Text>
          <Body>{doc.rejectionReason}</Body>
        </View>
      ) : null}
      {running || u.stage === 'done' ? (
        <View
          style={styles.progress}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${u.fileName ?? 'Dosya'}: ${progress.label}`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.value * 100) }}
        >
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress.value * 100}%` }]} />
          </View>
          <Small>
            {u.fileName ? `${u.fileName} · ` : ''}
            {progress.label}
          </Small>
        </View>
      ) : null}
      {u.stage === 'failed' ? (
        <>
          <FormError message={u.error} />
          {u.canRetry ? (
            <Button
              testID={`retry-${req.type}`}
              title="Tekrar dene"
              onPress={() => void upload.retry(req.type)}
              loading={upload.busyType === req.type}
              disabled={upload.busyType !== null}
            />
          ) : null}
        </>
      ) : null}
      <View style={styles.actions}>
        {replaceable ? (
          <Button
            testID={`upload-${req.type}`}
            title={!doc ? 'Yükle' : doc.status === 'REJECTED' ? 'Yeni belge yükle' : 'Değiştir'}
            variant={!doc || doc.status === 'REJECTED' ? 'primary' : 'secondary'}
            style={styles.flex}
            loading={running}
            disabled={upload.busyType !== null}
            onPress={() => void upload.pick(req.type)}
          />
        ) : null}
        {doc ? (
          <Button
            title="Görüntüle"
            variant="ghost"
            style={styles.flex}
            loading={open.busy}
            onPress={() => void open.submit()}
          />
        ) : null}
      </View>
      <FormError message={open.error} />
    </Card>
  );
}

function ReviewStep({ view, error }: { view: ProviderVerificationCaseView; error: string | null }) {
  return (
    <>
      <Card>
        <Heading>Göndermeden önce kontrol edin</Heading>
        {view.checklist
          .filter((c) => c.key !== 'SUBMIT')
          .map((c) => (
            <View key={c.key} style={styles.row}>
              <Body>{c.label}</Body>
              <Badge label={c.done ? '✓ Tamam' : 'Eksik'} tone={c.done ? 'success' : 'warning'} />
            </View>
          ))}
      </Card>
      <Card>
        <Heading>Belgeler</Heading>
        {view.documents
          .filter((d) => d.required || d.current)
          .map((d) => {
            const state = documentStateLabel(d.current);
            return (
              <View key={d.type} style={styles.row}>
                <View style={styles.flex}>
                  <Body>{VERIFICATION_TYPE_LABEL[d.type]}</Body>
                  <Small>{d.required ? 'Zorunlu' : 'İsteğe bağlı'}</Small>
                </View>
                <Badge
                  label={state.label}
                  tone={d.required && !documentSatisfied(d) ? 'danger' : state.tone}
                />
              </View>
            );
          })}
      </Card>
      <Small>
        Gönderdikten sonra ekibimiz belgelerinizi inceler. Sonuç bildirim olarak gelir ve bu ekranda
        görünür.
      </Small>
      {!view.canSubmit ? (
        <FormError message="Göndermek için eksik adımları tamamlayın. Hesabınız kısıtlıyken başvuru gönderilemez." />
      ) : null}
      <FormError message={error} />
    </>
  );
}

const STATUS_TEXT: Record<ProviderVerificationCaseView['status'], string> = {
  NOT_STARTED: 'Henüz doğrulama başvurusu yapmadınız.',
  IN_PROGRESS: 'Belgelerinizi yükleyip incelemeye gönderin.',
  SUBMITTED: 'Başvurunuz alındı. Ekibimiz en kısa sürede inceleyecek.',
  UNDER_REVIEW: 'Başvurunuz inceleniyor. Sonuç bildirim olarak gelir.',
  NEEDS_REVISION: 'Ekibimiz bazı düzeltmeler istedi. Belgeleri yenileyip tekrar gönderin.',
  VERIFIED: 'Hesabınız doğrulandı.',
  REJECTED: 'Doğrulama başvurunuz reddedildi. Gerekçeyi inceleyip yeniden başvurabilirsiniz.',
  SUSPENDED: 'Hesabınız askıdayken doğrulama işlemleri durduruldu.',
};

function StatusStep({ view, onEdit }: { view: ProviderVerificationCaseView; onEdit: () => void }) {
  const status = VERIFICATION_STATUS[view.status];
  const account = ACCOUNT_STATUS[view.accountStatus];
  const editable =
    view.canEditDocuments &&
    (view.status === 'NOT_STARTED' ||
      view.status === 'IN_PROGRESS' ||
      view.status === 'NEEDS_REVISION' ||
      view.status === 'REJECTED');
  return (
    <>
      <Card highlight={view.status === 'VERIFIED' ? 'success' : undefined}>
        <View style={styles.row}>
          <Heading>Doğrulama durumu</Heading>
          <Badge label={status.label} tone={status.tone} />
        </View>
        <Body>{STATUS_TEXT[view.status]}</Body>
        {view.capabilities.showVerifiedBadge ? (
          <Text style={styles.verified}>{VERIFIED_BADGE_LABEL}</Text>
        ) : null}
        {view.submittedAt ? <Small>Gönderildi: {formatDateTime(view.submittedAt)}</Small> : null}
        {view.verifiedAt ? <Small>Doğrulandı: {formatDateTime(view.verifiedAt)}</Small> : null}
        <View style={styles.row}>
          <Small>Hesap durumu</Small>
          <Badge label={account.label} tone={account.tone} />
        </View>
        {editable ? (
          <Button
            title={view.status === 'NOT_STARTED' ? 'Başla' : 'Belgeleri düzenle'}
            variant="secondary"
            onPress={onEdit}
          />
        ) : null}
      </Card>
      <ReasonBox view={view} />
      {view.timeline.length > 0 ? (
        <Card>
          <Heading>Geçmiş</Heading>
          {[...view.timeline].reverse().map((e) => (
            <View key={e.id} style={styles.event}>
              <Body>{VERIFICATION_STATUS[e.toStatus].label}</Body>
              <Small>{formatDateTime(e.createdAt)}</Small>
              {e.userVisibleReason ? <Small>{e.userVisibleReason}</Small> : null}
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: { flex: 1 },
  footer: { flexDirection: 'row', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  steps: { gap: spacing.xs },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
  segmentDone: { backgroundColor: colors.primary },
  reason: {
    backgroundColor: colors.emergencySoft,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
  },
  reasonTitle: { fontWeight: '700', color: colors.emergency },
  docTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  progress: { gap: 4 },
  track: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.success },
  verified: { fontSize: 15, fontWeight: '700', color: colors.success },
  event: { gap: 2, paddingVertical: spacing.xs },
});
