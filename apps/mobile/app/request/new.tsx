import type {
  Address,
  PriceGuide,
  RehireDraft,
  RequestForm,
  ScheduleOption,
  ServiceCategoryNode,
} from '@ustago/types';
import { MAX_REQUEST_PHOTOS } from '@ustago/validation';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError } from '../../src/api/client';
import { requestV2Api } from '../../src/api/customer-v2';
import { addressApi, catalogApi, requestApi } from '../../src/api/services';
import { api } from '../../src/api/session';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Screen } from '../../src/components/Screen';
import { EmptyState, ErrorState, FormError, LoadingState } from '../../src/components/States';
import { TextField } from '../../src/components/TextField';
import { Body, Heading, Small, Title } from '../../src/components/Text';
import { QuestionField } from '../../src/features/customer/QuestionField';
import { priceGuideText } from '../../src/features/customer/text';
import {
  answerLabel,
  type Answers,
  answersPayload,
  photoPolicyError,
  scheduleWindow,
  TIME_WINDOWS,
  type TimeWindow,
  validateAnswers,
  validateBudget,
  windowAvailable,
} from '../../src/features/customer/wizard';
import { useApi } from '../../src/hooks/useApi';
import { useSubmit } from '../../src/hooks/useSubmit';
import { categoryIcon } from '../../src/lib/categories';
import { formatDateRange, formatMoney } from '../../src/lib/format';
import { newIdempotencyKey } from '../../src/lib/id';
import { colors, radii, spacing } from '../../src/lib/theme';

type Step =
  'category' | 'questions' | 'details' | 'photos' | 'address' | 'schedule' | 'budget' | 'summary';

const STEP_TITLE: Record<Step, string> = {
  category: 'Kategori',
  questions: 'Sorular',
  details: 'Açıklama',
  photos: 'Fotoğraflar',
  address: 'Adres',
  schedule: 'Zaman',
  budget: 'Bütçe',
  summary: 'Özet',
};

const SCHEDULE_OPTIONS: { value: ScheduleOption; label: string }[] = [
  { value: 'NOW', label: 'Hemen' },
  { value: 'TODAY', label: 'Bugün' },
  { value: 'TOMORROW', label: 'Yarın' },
  { value: 'DATE', label: 'Tarih seç' },
];

const DEFAULT_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const dayLabel = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

interface Photo {
  uri: string;
  uploadId: string;
}

/**
 * Request wizard V2: kategori → sorular → açıklama → fotoğraflar → adres →
 * zaman → bütçe → özet. State survives moving back and forth. NOW (acil)
 * requests skip the time step. Also the entry for "Bu ustadan teklif iste"
 * (preferredProviderId) and "Bu ustayı tekrar çağır" (rehireJobId).
 */
export default function NewRequest() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    type?: string;
    categoryId?: string;
    preferredProviderId?: string;
    preferredProviderName?: string;
    providerCategoryIds?: string;
    rehireJobId?: string;
  }>();
  const type = params.type === 'NOW' ? 'NOW' : 'QUOTE';
  const steps: Step[] = useMemo(
    () =>
      type === 'NOW'
        ? ['category', 'questions', 'details', 'photos', 'address', 'budget', 'summary']
        : [
            'category',
            'questions',
            'details',
            'photos',
            'address',
            'schedule',
            'budget',
            'summary',
          ],
    [type],
  );
  const rehireJobId = params.rehireJobId ?? null;

  const [stepIndex, setStepIndex] = useState(params.categoryId || rehireJobId ? 1 : 0);
  const [pickedCategoryId, setCategoryId] = useState<string | null>(params.categoryId ?? null);
  const [answers, setAnswers] = useState<Answers>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [titleText, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pickedAddressId, setAddressId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleOption | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('ANY');
  const [dayOffset, setDayOffset] = useState(2);
  const [budgetUnknown, setBudgetUnknown] = useState(false);
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [preferredOnly, setPreferredOnly] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [stepError, setStepError] = useState<string | null>(null);

  const rehire = useApi<RehireDraft>(rehireJobId ? `rehire:${rehireJobId}` : '', () =>
    requestV2Api.rehire(rehireJobId ?? ''),
  );
  const categories = useApi<ServiceCategoryNode[]>('categories', catalogApi.categories);
  const addresses = useApi<Address[]>('addresses', addressApi.list);

  const draft = rehire.data;
  const categoryId = pickedCategoryId ?? draft?.category.id ?? null;
  const title = titleText ?? draft?.title ?? '';
  const preferred =
    draft && draft.provider.available
      ? { id: draft.provider.id, name: draft.provider.displayName }
      : params.preferredProviderId
        ? { id: params.preferredProviderId, name: params.preferredProviderName ?? 'Seçtiğin usta' }
        : null;

  const allowedParam = params.providerCategoryIds ?? '';
  const available = useMemo(() => {
    const allowedIds = allowedParam ? allowedParam.split(',') : null;
    return (categories.data ?? []).filter(
      (c) =>
        (type === 'NOW' ? c.supportsNow : c.supportsQuote) &&
        (!allowedIds ||
          allowedIds.includes(c.id) ||
          c.children.some((ch) => allowedIds.includes(ch.id))),
    );
  }, [categories.data, type, allowedParam]);
  const category = (categories.data ?? []).find((c) => c.id === categoryId) ?? null;
  const categoryName = category?.name ?? draft?.category.name ?? '';

  const form = useApi<RequestForm>(categoryId ? `request-form:${categoryId}` : '', () =>
    requestV2Api.form(categoryId ?? ''),
  );
  const questions = useMemo(
    () =>
      (form.data?.questions ?? [])
        .filter((q) => q.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [form.data],
  );
  const photoPolicy = form.data?.photoPolicy ?? 'OPTIONAL';
  const maxPhotos = form.data?.maxPhotos ?? MAX_REQUEST_PHOTOS;
  const maxPhotoBytes = form.data?.maxPhotoBytes ?? DEFAULT_MAX_PHOTO_BYTES;

  // The rehire address is proposed only while it still exists; the customer confirms it.
  const addressList = addresses.data ?? [];
  const addressId =
    pickedAddressId ??
    (draft?.addressId && addressList.some((a) => a.id === draft.addressId)
      ? draft.addressId
      : null) ??
    (addressList.find((a) => a.isDefault) ?? addressList[0])?.id ??
    null;
  const address = addressList.find((a) => a.id === addressId) ?? null;

  const step = steps[stepIndex] ?? 'category';
  const budget = budgetUnknown
    ? { error: null, minMinor: null, maxMinor: null }
    : validateBudget(budgetMin, budgetMax);
  const scheduleOption: ScheduleOption | null = type === 'NOW' ? 'NOW' : schedule;
  const windowTimes = scheduleOption
    ? scheduleWindow(scheduleOption, timeWindow, dayOffset)
    : { start: null, end: null };

  const guideWanted = step === 'budget' || step === 'summary';
  const priceGuide = useApi<PriceGuide>(
    guideWanted && categoryId ? `price-guide:${categoryId}:${address?.province.id ?? '-'}` : '',
    () => requestV2Api.priceGuide(categoryId ?? '', address?.province.id),
  );

  const selectCategory = (id: string) => {
    if (id !== categoryId) {
      setAnswers({});
      setAnswerErrors({});
    }
    setCategoryId(id);
  };

  const validate = (): string | null => {
    switch (step) {
      case 'category':
        return categoryId ? null : 'Lütfen bir hizmet seçin.';
      case 'questions': {
        if (form.loading) return 'Sorular yükleniyor, lütfen bekleyin.';
        const errors = validateAnswers(questions, answers);
        setAnswerErrors(errors);
        return Object.keys(errors).length > 0 ? 'Lütfen zorunlu soruları cevaplayın.' : null;
      }
      case 'details':
        if (title.trim().length < 3) return 'Başlık en az 3 karakter olmalı.';
        if (description.trim().length < 10) return 'Lütfen işi en az 10 karakterle anlatın.';
        return null;
      case 'photos':
        return photoPolicyError(photoPolicy, photos.length);
      case 'address':
        return addressId ? null : 'Lütfen bir adres seçin veya ekleyin.';
      case 'schedule':
        if (!schedule) return 'Lütfen ne zaman gelinmesini istediğini seç.';
        if (!windowAvailable(schedule, timeWindow))
          return 'Bu zaman aralığı bugün için geçti; başka bir aralık seç.';
        return null;
      case 'budget':
        return budget.error;
      default:
        return null;
    }
  };

  const next = () => {
    const problem = validate();
    setStepError(problem);
    if (!problem) setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const back = () => {
    setStepError(null);
    if (stepIndex === 0) router.back();
    else setStepIndex((i) => i - 1);
  };
  const goTo = (s: Step) => {
    const i = steps.indexOf(s);
    if (i >= 0) {
      setStepError(null);
      setStepIndex(i);
    }
  };

  const addPhoto = useSubmit(async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    const mime =
      asset.mimeType ?? (asset.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
    if (mime !== 'image/jpeg' && mime !== 'image/png') {
      throw new ApiError(
        422,
        'INVALID_REQUEST_PHOTO',
        'Yalnızca JPEG veya PNG fotoğraf ekleyebilirsiniz.',
      );
    }
    const blob = await api.readFile(asset.uri);
    if (blob.size > maxPhotoBytes) {
      const mb = Math.floor(maxPhotoBytes / (1024 * 1024));
      throw new ApiError(422, 'INVALID_REQUEST_PHOTO', `Fotoğraf en fazla ${mb} MB olabilir.`);
    }
    const intent = await requestApi.photoUploadIntent(mime, blob.size);
    await api.upload(intent.uploadUrl, blob, intent.headers);
    setPhotos((list) => [...list, { uri: asset.uri, uploadId: intent.uploadId }]);
  });

  const publish = useSubmit(async () => {
    if (!categoryId || !addressId) return;
    const answerBody = answersPayload(questions, answers);
    const created = await requestV2Api.create({
      type,
      categoryId,
      addressId,
      title: title.trim(),
      description: description.trim(),
      budgetMinor: budget.minMinor,
      budgetMaxMinor: budget.maxMinor,
      preferredStartAt: windowTimes.start,
      preferredEndAt: windowTimes.end,
      photoUploadIds: photos.map((p) => p.uploadId),
      idempotencyKey,
      scheduleOption,
      ...(Object.keys(answerBody).length > 0 ? { answers: answerBody } : {}),
      ...(preferred ? { preferredProviderId: preferred.id, preferredOnly } : {}),
      ...(draft ? { rehireOfJobId: draft.jobId } : {}),
    });
    router.replace(`/request/${created.id}`);
  });

  if (categories.loading || addresses.loading || rehire.loading) return <LoadingState />;
  if (categories.error)
    return <ErrorState message={categories.error} onRetry={categories.refresh} />;
  if (rehire.error) return <ErrorState message={rehire.error} onRetry={rehire.refresh} />;

  const isLast = step === 'summary';
  const footer = (
    <View style={styles.footerRow}>
      <Button
        testID="wizard-back"
        title={stepIndex === 0 ? 'Vazgeç' : 'Geri'}
        variant="secondary"
        onPress={back}
        style={styles.flex}
      />
      {isLast ? (
        <Button
          testID="publish-request"
          title={type === 'NOW' ? '🚨 Acil Talebi Gönder' : 'Talebi Gönder'}
          variant={type === 'NOW' ? 'emergency' : 'primary'}
          onPress={() => void publish.submit()}
          loading={publish.busy}
          style={styles.flex2}
        />
      ) : (
        <Button testID="wizard-next" title="Devam" onPress={next} style={styles.flex2} />
      )}
    </View>
  );

  const guide = priceGuideText(priceGuide.data);

  return (
    <Screen footer={footer}>
      <View style={styles.progressWrap}>
        <Small>
          Adım {stepIndex + 1}/{steps.length} · {STEP_TITLE[step]}
          {type === 'NOW' ? ' · 🚨 Acil talep' : ''}
        </Small>
        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityLabel={`Adım ${stepIndex + 1} / ${steps.length}: ${STEP_TITLE[step]}`}
          accessibilityValue={{ min: 1, max: steps.length, now: stepIndex + 1 }}
        >
          <View
            style={[styles.progressFill, { width: `${((stepIndex + 1) / steps.length) * 100}%` }]}
          />
        </View>
      </View>

      {preferred ? (
        <View style={styles.preferred} testID="preferred-provider-banner">
          <Text style={styles.preferredText}>
            {draft ? '🔁 Tekrar çağır: ' : '⭐ '}
            {preferred.name}
          </Text>
          <Small>Talebin öncelikle bu ustaya gönderilir.</Small>
        </View>
      ) : draft && !draft.provider.available ? (
        <View style={styles.preferred}>
          <Small>
            {draft.provider.displayName} şu an hizmet vermiyor; talebin bölgendeki uygun ustalara
            gönderilecek.
          </Small>
        </View>
      ) : null}

      {step === 'category' ? (
        <>
          <Title>{type === 'NOW' ? 'Acil ne lazım?' : 'Hangi hizmet?'}</Title>
          {type === 'NOW' ? (
            <Body muted>Yalnızca acil hizmet verilen kategoriler listelenir.</Body>
          ) : null}
          {available.length === 0 ? (
            <EmptyState icon="🧰" title="Uygun hizmet bulunamadı" />
          ) : (
            <View style={styles.grid}>
              {available.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`category-${c.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: c.id === categoryId }}
                  accessibilityLabel={c.name}
                  onPress={() => selectCategory(c.id)}
                  style={[styles.tile, c.id === categoryId && styles.tileSelected]}
                >
                  <Text style={styles.tileIcon}>{categoryIcon(c.slug)}</Text>
                  <Text style={styles.tileText}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      ) : null}

      {step === 'questions' ? (
        <>
          <Title>Birkaç soru</Title>
          <Body muted>
            {categoryName}: cevapların ustaların daha doğru fiyat vermesine yardım eder.
          </Body>
          {form.loading ? (
            <LoadingState label="Sorular yükleniyor…" />
          ) : form.error ? (
            <Card>
              <Body muted>Sorular yüklenemedi: {form.error}</Body>
              <Button title="Tekrar dene" variant="secondary" onPress={() => void form.refresh()} />
              <Small>İstersen sorular olmadan da devam edebilirsin.</Small>
            </Card>
          ) : questions.length === 0 ? (
            <Body muted>Bu hizmet için ek soru yok, devam edebilirsin.</Body>
          ) : (
            questions.map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                value={answers[q.key]}
                error={answerErrors[q.key]}
                onChange={(v) => {
                  setAnswers((a) => ({ ...a, [q.key]: v }));
                  setAnswerErrors((e) => {
                    const { [q.key]: _removed, ...rest } = e;
                    return rest;
                  });
                }}
              />
            ))
          )}
        </>
      ) : null}

      {step === 'details' ? (
        <>
          <Title>İşi anlat</Title>
          <Body muted>
            {category ? `${categoryIcon(category.slug)} ` : ''}
            {categoryName}
          </Body>
          <TextField
            testID="request-title"
            label="Başlık"
            placeholder="Örn. Klima soğutmuyor"
            value={title}
            onChangeText={setTitle}
            maxLength={140}
          />
          <TextField
            testID="request-description"
            label="Açıklama"
            placeholder="Sorunu, cihaz markasını, kat bilgisini yaz. Ustalar daha doğru fiyat verir."
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={4000}
          />
          <Small>Telefon numarası veya açık adres yazma; ustayla anlaşınca paylaşılır.</Small>
        </>
      ) : null}

      {step === 'photos' ? (
        <>
          <Title>
            Fotoğraflar
            {photoPolicy === 'REQUIRED'
              ? ' (zorunlu)'
              : photoPolicy === 'RECOMMENDED'
                ? ' (önerilir)'
                : ' (isteğe bağlı)'}
          </Title>
          <Body muted>
            {photoPolicy === 'REQUIRED'
              ? 'Bu hizmette ustaların işi görmesi gerekiyor: en az bir fotoğraf ekle.'
              : photoPolicy === 'RECOMMENDED'
                ? 'Fotoğraf eklemen önerilir; ustalar daha doğru fiyat verir.'
                : 'Fotoğraf, ustaların daha doğru fiyat vermesine yardım eder.'}{' '}
            JPEG veya PNG, en fazla {Math.floor(maxPhotoBytes / (1024 * 1024))} MB, {maxPhotos}{' '}
            adet.
          </Body>
          <View style={styles.photos}>
            {photos.map((p) => (
              <View key={p.uploadId} style={styles.photoWrap}>
                <Image
                  source={{ uri: p.uri }}
                  style={styles.photo}
                  accessibilityLabel="Eklenen fotoğraf"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fotoğrafı kaldır"
                  onPress={() => setPhotos((list) => list.filter((x) => x.uploadId !== p.uploadId))}
                  style={styles.photoRemove}
                >
                  <Text style={styles.photoRemoveText}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
          {photos.length < maxPhotos ? (
            <Button
              title="📷 Fotoğraf ekle"
              variant="secondary"
              onPress={() => void addPhoto.submit()}
              loading={addPhoto.busy}
            />
          ) : null}
          <FormError message={addPhoto.error} />
        </>
      ) : null}

      {step === 'address' ? (
        <>
          <Title>Adres</Title>
          <View style={styles.privacy}>
            <Text style={styles.privacyText}>🔒 Adresin yalnızca anlaştığın ustaya gösterilir</Text>
            <Small>Diğer ustalar sadece il ve ilçeyi görür.</Small>
          </View>
          {addressList.length === 0 ? (
            <EmptyState
              icon="📍"
              title="Kayıtlı adresin yok"
              body="Devam etmek için bir adres ekle."
            />
          ) : (
            addressList.map((a) => (
              <Card
                key={a.id}
                onPress={() => setAddressId(a.id)}
                highlight={a.id === addressId ? 'primary' : undefined}
                accessibilityLabel={`${a.label ?? 'Adres'}, ${a.district.name} ${a.province.name}${a.id === addressId ? ', seçili' : ''}`}
              >
                <Text style={styles.addrTitle}>
                  {a.id === addressId ? '● ' : '○ '}
                  {a.label ?? 'Adres'}
                </Text>
                <Small>
                  {a.addressLine} · {a.district.name} / {a.province.name}
                </Small>
              </Card>
            ))
          )}
          {draft?.addressId && addressId === draft.addressId ? (
            <Small>Önceki işteki adres seçildi; farklıysa değiştir.</Small>
          ) : null}
          <Button
            title="+ Yeni adres ekle"
            variant="ghost"
            onPress={() => router.push('/addresses/edit')}
          />
          <Button
            title="Adres listesini yenile"
            variant="ghost"
            onPress={() => void addresses.refresh()}
          />
        </>
      ) : null}

      {step === 'schedule' ? (
        <>
          <Title>Ne zaman?</Title>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {SCHEDULE_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                selected={schedule === o.value}
                onPress={() => {
                  setSchedule(o.value);
                  setStepError(null);
                }}
              />
            ))}
          </View>
          {schedule === 'NOW' ? (
            <Body muted>
              Uygun ustalar en kısa sürede gelebilecekleri zamanı teklifinde belirtir.
            </Body>
          ) : null}
          {schedule === 'DATE' ? (
            <>
              <Heading>Gün</Heading>
              <View style={styles.chips}>
                {Array.from({ length: 12 }, (_, i) => i + 2).map((d) => {
                  const day = new Date();
                  day.setDate(day.getDate() + d);
                  return (
                    <Chip
                      key={d}
                      label={dayLabel.format(day)}
                      selected={dayOffset === d}
                      onPress={() => setDayOffset(d)}
                    />
                  );
                })}
              </View>
            </>
          ) : null}
          {schedule && schedule !== 'NOW' ? (
            <>
              <Heading>Saat aralığı</Heading>
              <View style={styles.chips}>
                {TIME_WINDOWS.filter((w) => windowAvailable(schedule, w.value)).map((w) => (
                  <Chip
                    key={w.value}
                    label={w.label}
                    selected={timeWindow === w.value}
                    onPress={() => setTimeWindow(w.value)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Body muted>Kesin saati anlaştığın ustayla birlikte belirlersin.</Body>
        </>
      ) : null}

      {step === 'budget' ? (
        <>
          <Title>Bütçe (isteğe bağlı)</Title>
          {guide ? (
            <View style={styles.guide} testID="price-guide">
              <Text style={styles.guideText}>💡 {guide}</Text>
            </View>
          ) : null}
          <View style={styles.budgetRow}>
            <View style={styles.flex}>
              <TextField
                testID="budget-min"
                label="En az"
                prefix="₺"
                placeholder="1.500"
                keyboardType="decimal-pad"
                inputMode="decimal"
                value={budgetMin}
                onChangeText={setBudgetMin}
                editable={!budgetUnknown}
              />
            </View>
            <View style={styles.flex}>
              <TextField
                testID="budget-max"
                label="En çok"
                prefix="₺"
                placeholder="2.000"
                keyboardType="decimal-pad"
                inputMode="decimal"
                value={budgetMax}
                onChangeText={setBudgetMax}
                editable={!budgetUnknown}
              />
            </View>
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Bütçem belli değil</Text>
            <Switch
              testID="budget-unknown"
              value={budgetUnknown}
              onValueChange={(v) => {
                setBudgetUnknown(v);
                setStepError(null);
              }}
              accessibilityLabel="Bütçem belli değil"
            />
          </View>
          <Card style={styles.note}>
            <Body muted>
              Bütçe yalnızca bir tahmindir, teklif tavanı değildir. Ustalar işin gerçek maliyetine
              göre farklı teklif verebilir; sen de karşı teklif yapabilirsin.
            </Body>
          </Card>
        </>
      ) : null}

      {step === 'summary' ? (
        <>
          <Title>Kontrol et</Title>
          <Card highlight={type === 'NOW' ? 'emergency' : undefined}>
            {type === 'NOW' ? <Text style={styles.nowBadge}>🚨 ACİL İŞ</Text> : null}
            <Heading>{title.trim()}</Heading>
            <Body>{description.trim()}</Body>
            <SummaryRow label="Hizmet" value={categoryName} onEdit={() => goTo('category')} />
            {questions.map((q) => (
              <SummaryRow
                key={q.id}
                label={q.label}
                value={answerLabel(q, answers[q.key])}
                onEdit={() => goTo('questions')}
              />
            ))}
            <SummaryRow
              label="Fotoğraf"
              value={photos.length === 0 ? 'Yok' : `${photos.length} adet`}
              onEdit={() => goTo('photos')}
            />
            <SummaryRow
              label="Adres"
              value={
                address
                  ? `${address.label ?? 'Adres'} · ${address.district.name} / ${address.province.name}`
                  : '—'
              }
              onEdit={() => goTo('address')}
            />
            <SummaryRow
              label="Zaman"
              value={
                scheduleOption === 'NOW'
                  ? 'Hemen'
                  : windowTimes.start
                    ? formatDateRange(windowTimes.start, windowTimes.end)
                    : '—'
              }
              onEdit={type === 'NOW' ? undefined : () => goTo('schedule')}
            />
            <SummaryRow
              label="Bütçe"
              value={
                budget.minMinor === null
                  ? 'Belirtilmedi (teklif bekliyorum)'
                  : budget.maxMinor !== null
                    ? `${formatMoney(budget.minMinor)}–${formatMoney(budget.maxMinor)}`
                    : formatMoney(budget.minMinor)
              }
              onEdit={() => goTo('budget')}
            />
          </Card>

          {preferred ? (
            <View style={styles.section} accessibilityRole="radiogroup">
              <Heading>Kime gönderilsin?</Heading>
              <Choice
                testID="send-preferred-only"
                selected={preferredOnly}
                title="Sadece bu ustaya gönder"
                body={`Talebini yalnızca ${preferred.name} görür. Teklif gelmezse aramayı sonradan genişletebilirsin.`}
                onPress={() => setPreferredOnly(true)}
              />
              <Choice
                testID="send-to-others"
                selected={!preferredOnly}
                title="Bu ustaya ve diğer uygun ustalara gönder"
                body={`${preferred.name} öncelikli olarak bilgilendirilir; bölgendeki uygun ustalar da teklif verebilir.`}
                onPress={() => setPreferredOnly(false)}
              />
            </View>
          ) : null}

          {type === 'NOW' ? (
            <Body muted>
              Talebin, bölgende şu an müsait ve acil hizmet veren ustalara iletilir. İlk gelen
              teklifi kabul edebilir veya reddedebilirsin.
            </Body>
          ) : (
            <Body muted>Talebin, bölgende bu hizmeti veren uygun ustalara iletilir.</Body>
          )}
          <FormError message={publish.error} />
        </>
      ) : null}

      <FormError message={stepError} />
    </Screen>
  );
}

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
}) {
  return (
    <View style={styles.previewRow}>
      <View style={styles.flex}>
        <Text style={styles.previewLabel}>{label}</Text>
        <Text style={styles.previewValue}>{value}</Text>
      </View>
      {onEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} düzenle`}
          onPress={onEdit}
          style={styles.edit}
        >
          <Text style={styles.editText}>Düzenle</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Choice({
  selected,
  title,
  body,
  onPress,
  testID,
}: {
  selected: boolean;
  title: string;
  body: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      accessibilityHint={body}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={styles.choiceTitle}>
        {selected ? '● ' : '○ '}
        {title}
      </Text>
      <Small>{body}</Small>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flex2: { flex: 2 },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  progressWrap: { gap: spacing.xs },
  progressTrack: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: colors.primary },
  preferred: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    padding: spacing.sm + 4,
    gap: 2,
  },
  preferredText: { fontSize: 15, fontWeight: '700', color: colors.primaryDark },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '47%',
    flexGrow: 1,
    minHeight: 72,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
  },
  tileSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tileIcon: { fontSize: 24 },
  tileText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  privacy: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.md,
    padding: spacing.sm + 4,
    gap: 2,
  },
  privacyText: { fontSize: 15, fontWeight: '700', color: colors.success },
  addrTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoWrap: { position: 'relative' },
  photo: { width: 96, height: 96, borderRadius: radii.md, backgroundColor: colors.border },
  photoRemove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: colors.textInverse, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  guide: { backgroundColor: colors.warningSoft, borderRadius: radii.md, padding: spacing.sm + 4 },
  guideText: { fontSize: 14, color: '#9A6200', fontWeight: '600' },
  budgetRow: { flexDirection: 'row', gap: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  switchLabel: { fontSize: 16, color: colors.textPrimary, fontWeight: '500' },
  note: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  nowBadge: { color: colors.emergency, fontWeight: '900', fontSize: 13 },
  section: { gap: spacing.sm },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewLabel: { color: colors.textSecondary, fontSize: 13 },
  previewValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  edit: { minHeight: 44, minWidth: 64, alignItems: 'flex-end', justifyContent: 'center' },
  editText: { color: colors.primary, fontWeight: '700' },
  choice: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
    backgroundColor: colors.background,
    minHeight: 48,
  },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
});
