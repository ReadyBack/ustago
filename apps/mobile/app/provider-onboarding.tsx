import type {
  District,
  ProviderOnboardingStatus,
  ProviderProfile,
  ProviderServiceAreaGroup,
  ProviderServiceItem,
  ProviderVerification,
  Province,
  ServiceCategoryNode,
  VerificationType,
} from '@ustago/types';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError } from '../src/api/client';
import { catalogApi, providerApi } from '../src/api/services';
import { api } from '../src/api/session';
import { useAuth } from '../src/auth/AuthContext';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import { Screen } from '../src/components/Screen';
import { ErrorState, FormError, LoadingState } from '../src/components/States';
import { SelectField } from '../src/components/SelectField';
import { TextField } from '../src/components/TextField';
import { Body, Heading, Small, Title } from '../src/components/Text';
import { useApi } from '../src/hooks/useApi';
import { useSubmit } from '../src/hooks/useSubmit';
import { categoryIcon } from '../src/lib/categories';
import { PROVIDER_STATUS, VERIFICATION_TYPE_LABEL } from '../src/lib/labels';
import { colors, radii, spacing } from '../src/lib/theme';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DOC_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

/** Provider application: create → profile → services → areas → documents → submit; status afterwards. */
export default function ProviderOnboarding() {
  const { user, refreshUser, setMode } = useAuth();
  if (!user?.providerProfile)
    return (
      <StartApplication
        onCreated={async () => {
          await refreshUser();
          await setMode('provider');
        }}
      />
    );
  return <Application />;
}

function StartApplication({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const create = useSubmit(async () => {
    await providerApi.create(name.trim());
    await onCreated();
  });
  return (
    <Screen
      footer={
        <Button
          title="Başvuruya Başla"
          onPress={() => void create.submit()}
          loading={create.busy}
          disabled={name.trim().length < 2}
        />
      }
    >
      <Title>Usta olarak başvurun</Title>
      <Body muted>
        Başvurunuz; profil, hizmetler, hizmet bölgesi ve kimlik belgesinden oluşur. Ekibimiz
        onayladıktan sonra bölgenizdeki işleri görüp teklif verebilirsiniz.
      </Body>
      <TextField
        label="Görünen ad"
        placeholder="Örn. Kemal Usta Klima"
        value={name}
        onChangeText={setName}
        maxLength={120}
      />
      <FormError message={create.error} />
    </Screen>
  );
}

function Application() {
  const { refreshUser } = useAuth();
  const onboarding = useApi<ProviderOnboardingStatus>('onboarding', providerApi.onboarding);
  const profile = useApi<ProviderProfile>('provider:me', providerApi.me);
  const refreshAll = async () => {
    await Promise.all([onboarding.refresh(), profile.refresh(), refreshUser()]);
  };

  const submit = useSubmit(async () => {
    await providerApi.submit();
    await refreshAll();
  });
  const reapply = useSubmit(async () => {
    await providerApi.reapply();
    await refreshAll();
  });

  if (onboarding.loading || profile.loading) return <LoadingState />;
  if (onboarding.error || !onboarding.data || !profile.data) {
    return (
      <ErrorState
        message={onboarding.error ?? profile.error ?? 'Başvuru yüklenemedi.'}
        onRetry={() => void refreshAll()}
      />
    );
  }
  const o = onboarding.data;
  const p = profile.data;
  const status = PROVIDER_STATUS[p.status];
  const editable = p.status === 'DRAFT';

  return (
    <Screen onRefresh={() => void refreshAll()} refreshing={onboarding.refreshing}>
      <Card>
        <View style={styles.row}>
          <Heading>{p.displayName}</Heading>
          <Badge label={status.label} tone={status.tone} />
        </View>
        <Small>
          Adım {o.completedSteps}/{o.totalSteps} tamamlandı
        </Small>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: o.totalSteps, now: o.completedSteps }}
        >
          <View style={[styles.fill, { width: `${(o.completedSteps / o.totalSteps) * 100}%` }]} />
        </View>
        {o.statusReason ? (
          <View style={styles.reason}>
            <Text style={styles.reasonTitle}>Gerekçe</Text>
            <Body>{o.statusReason}</Body>
          </View>
        ) : null}
        {p.status === 'PENDING_REVIEW' ? (
          <Body muted>Başvurunuz inceleniyor. Sonuç bu ekranda görünür.</Body>
        ) : null}
        {p.status === 'ACTIVE' ? (
          <Body muted>Onaylı ustasınız. İşler sekmesinden uygun işlere teklif verebilirsiniz.</Body>
        ) : null}
        {p.status === 'REJECTED' ? (
          <Button
            title="Düzenleyip yeniden başvur"
            variant="secondary"
            loading={reapply.busy}
            onPress={() => void reapply.submit()}
          />
        ) : null}
        <FormError message={reapply.error} />
      </Card>

      <ProfileSection
        profile={p}
        editable={editable}
        done={o.profileComplete}
        onSaved={refreshAll}
      />
      <ServicesSection editable={editable} done={o.servicesComplete} onSaved={refreshAll} />
      <AreasSection editable={editable} done={o.serviceAreasComplete} onSaved={refreshAll} />
      <DocumentsSection
        required={o.requiredVerificationTypes}
        done={o.requiredVerificationsComplete}
        editable={editable}
        onSaved={refreshAll}
      />
      <NowSection profile={p} onSaved={refreshAll} />

      {editable ? (
        <>
          <FormError message={submit.error} />
          <Button
            testID="submit-application"
            title="İncelemeye Gönder"
            onPress={() => void submit.submit()}
            loading={submit.busy}
            disabled={!o.canSubmit}
            accessibilityHint={o.canSubmit ? undefined : 'Önce tüm adımları tamamlayın'}
          />
          {!o.canSubmit ? <Small>Göndermek için tüm adımları tamamlayın.</Small> : null}
        </>
      ) : null}
    </Screen>
  );
}

function SectionHeader({ title, done }: { title: string; done: boolean }) {
  return (
    <View style={styles.row}>
      <Heading>{title}</Heading>
      <Badge label={done ? '✓ Tamam' : 'Eksik'} tone={done ? 'success' : 'warning'} />
    </View>
  );
}

function ProfileSection({
  profile,
  editable,
  done,
  onSaved,
}: {
  profile: ProviderProfile;
  editable: boolean;
  done: boolean;
  onSaved: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [years, setYears] = useState(profile.yearsOfExperience?.toString() ?? '');
  const save = useSubmit(async () => {
    await providerApi.update({
      displayName: displayName.trim(),
      bio: bio.trim() || null,
      yearsOfExperience: years ? Number.parseInt(years, 10) : null,
    });
    await onSaved();
  });
  return (
    <Card>
      <SectionHeader title="1. Profil" done={done} />
      <TextField
        label="Görünen ad"
        value={displayName}
        onChangeText={setDisplayName}
        editable={editable}
        maxLength={120}
      />
      <TextField
        label="Hakkınızda"
        value={bio}
        onChangeText={setBio}
        editable={editable}
        multiline
        maxLength={2000}
        placeholder="Deneyiminizi ve uzmanlık alanlarınızı yazın"
      />
      <TextField
        label="Tecrübe (yıl)"
        value={years}
        onChangeText={(t) => setYears(t.replace(/\D/g, '').slice(0, 2))}
        editable={editable}
        keyboardType="number-pad"
      />
      <FormError message={save.error} />
      {editable ? (
        <Button
          title="Profili Kaydet"
          variant="secondary"
          onPress={() => void save.submit()}
          loading={save.busy}
        />
      ) : null}
    </Card>
  );
}

function ServicesSection(props: {
  editable: boolean;
  done: boolean;
  onSaved: () => Promise<void>;
}) {
  const categories = useApi<ServiceCategoryNode[]>('categories', catalogApi.categories);
  const mine = useApi<ProviderServiceItem[]>('provider:services', providerApi.services);
  if (categories.loading || mine.loading) return <LoadingState />;
  return (
    <ServicesForm
      {...props}
      categories={categories.data ?? []}
      initial={(mine.data ?? []).map((s) => s.categoryId)}
    />
  );
}

function ServicesForm({
  editable,
  done,
  onSaved,
  categories,
  initial,
}: {
  editable: boolean;
  done: boolean;
  onSaved: () => Promise<void>;
  categories: ServiceCategoryNode[];
  initial: string[];
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const save = useSubmit(async () => {
    await providerApi.setServices(selected);
    await onSaved();
  });
  return (
    <Card>
      <SectionHeader title="2. Hizmetler" done={done} />
      <View style={styles.chips}>
        {categories.map((c) => (
          <Chip
            key={c.id}
            label={`${categoryIcon(c.slug)} ${c.name}`}
            selected={selected.includes(c.id)}
            onPress={() =>
              editable &&
              setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))
            }
          />
        ))}
      </View>
      <FormError message={save.error} />
      {editable ? (
        <Button
          title="Hizmetleri Kaydet"
          variant="secondary"
          onPress={() => void save.submit()}
          loading={save.busy}
          disabled={selected.length === 0}
        />
      ) : null}
    </Card>
  );
}

function AreasSection(props: { editable: boolean; done: boolean; onSaved: () => Promise<void> }) {
  const provinces = useApi<Province[]>('provinces:active', catalogApi.provinces);
  const mine = useApi<ProviderServiceAreaGroup[]>('provider:areas', providerApi.areas);
  if (provinces.loading || mine.loading) return <LoadingState />;
  const first = mine.data?.[0];
  return (
    <AreasForm
      {...props}
      provinces={provinces.data ?? []}
      initialProvince={first?.province.id ?? null}
      initialDistricts={first?.districts.map((d) => d.id) ?? []}
    />
  );
}

function AreasForm({
  editable,
  done,
  onSaved,
  provinces,
  initialProvince,
  initialDistricts,
}: {
  editable: boolean;
  done: boolean;
  onSaved: () => Promise<void>;
  provinces: Province[];
  initialProvince: number | null;
  initialDistricts: string[];
}) {
  const [provinceId, setProvinceId] = useState<number | null>(initialProvince);
  const [selected, setSelected] = useState<string[]>(initialDistricts);
  const districts = useApi<District[]>(
    provinceId ? `districts:${provinceId}` : '',
    () => (provinceId ? catalogApi.districts(provinceId) : Promise.resolve([])),
    { enabled: provinceId !== null },
  );
  const save = useSubmit(async () => {
    if (!provinceId) throw new ApiError(400, 'INVALID', 'Önce il seçin.');
    await providerApi.setAreas(provinceId, selected);
    await onSaved();
  });
  return (
    <Card>
      <SectionHeader title="3. Hizmet bölgesi" done={done} />
      <SelectField
        label="İl"
        placeholder="İl seçin"
        options={provinces.map((p) => ({ value: p.id, label: p.name }))}
        value={provinceId}
        onChange={(v) => {
          setProvinceId(v);
          setSelected([]);
        }}
        disabled={!editable}
      />
      {provinceId ? (
        <>
          <Small>Hizmet verdiğiniz ilçeleri seçin:</Small>
          <View style={styles.chips}>
            {(districts.data ?? []).map((d) => (
              <Chip
                key={d.id}
                label={d.name}
                selected={selected.includes(d.id)}
                onPress={() =>
                  editable &&
                  setSelected((s) =>
                    s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id],
                  )
                }
              />
            ))}
          </View>
        </>
      ) : null}
      <FormError message={save.error} />
      {editable ? (
        <Button
          title="Bölgeyi Kaydet"
          variant="secondary"
          onPress={() => void save.submit()}
          loading={save.busy}
          disabled={selected.length === 0}
        />
      ) : null}
    </Card>
  );
}

function DocumentsSection({
  required,
  done,
  editable,
  onSaved,
}: {
  required: VerificationType[];
  done: boolean;
  editable: boolean;
  onSaved: () => Promise<void>;
}) {
  const docs = useApi<ProviderVerification[]>('provider:verifications', providerApi.verifications);
  const upload = useSubmit(async (type: VerificationType) => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: [...DOC_TYPES],
      copyToCacheDirectory: true,
      multiple: false,
    });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    const blob = await api.readFile(asset.uri);
    const mimeType = asset.mimeType ?? blob.type;
    if (!DOC_TYPES.includes(mimeType as (typeof DOC_TYPES)[number])) {
      throw new ApiError(422, 'INVALID_FILE', 'Yalnızca JPEG, PNG veya PDF yükleyebilirsiniz.');
    }
    if (blob.size > MAX_DOCUMENT_BYTES)
      throw new ApiError(422, 'FILE_TOO_LARGE', 'Dosya en fazla 10 MB olabilir.');
    const intent = await providerApi.verificationIntent({
      type,
      fileName: asset.name,
      mimeType,
      sizeBytes: blob.size,
    });
    await api.upload(intent.uploadUrl, blob, intent.headers);
    await providerApi.submitVerification(type, intent.uploadId);
    await docs.refresh();
    await onSaved();
  });
  return (
    <Card>
      <SectionHeader title="4. Belgeler" done={done} />
      <Small>
        JPEG, PNG veya PDF; en fazla 10 MB. Belgeler yalnızca inceleme ekibine, kısa süreli güvenli
        bağlantıyla gösterilir.
      </Small>
      {required.map((type) => {
        const latest = docs.data?.find((d) => d.type === type);
        return (
          <View key={type} style={styles.doc}>
            <View style={styles.flex}>
              <Text style={styles.docTitle}>{VERIFICATION_TYPE_LABEL[type]}</Text>
              <Small>
                {latest
                  ? `${latest.originalFileName ?? 'Belge'} · ${latest.status === 'PENDING' ? 'İnceleniyor' : latest.status === 'APPROVED' ? 'Onaylandı' : latest.status === 'REJECTED' ? `Reddedildi: ${latest.rejectionReason ?? ''}` : 'Süresi doldu'}`
                  : 'Yüklenmedi'}
              </Small>
            </View>
            {editable ? (
              <Button
                title={latest ? 'Değiştir' : 'Yükle'}
                variant="secondary"
                onPress={() => void upload.submit(type)}
                loading={upload.busy}
              />
            ) : null}
          </View>
        );
      })}
      <FormError message={upload.error} />
    </Card>
  );
}

function NowSection({
  profile,
  onSaved,
}: {
  profile: ProviderProfile;
  onSaved: () => Promise<void>;
}) {
  const toggle = useSubmit(async (nowEnabled: boolean) => {
    await providerApi.availability({ nowEnabled });
    await onSaved();
  });
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Heading>🚨 Acil Usta (isteğe bağlı)</Heading>
          <Small>Açarsanız, müsait olduğunuz anlarda bölgenizdeki acil işler size gelir.</Small>
        </View>
        <Switch
          value={profile.nowEnabled}
          onValueChange={(v) => void toggle.submit(v)}
          disabled={toggle.busy}
          accessibilityLabel="Acil Usta"
        />
      </View>
      <FormError message={toggle.error} />
    </Card>
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
  track: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.success },
  reason: {
    backgroundColor: colors.emergencySoft,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
  },
  reasonTitle: { fontWeight: '700', color: colors.emergency },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  doc: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  docTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
});
