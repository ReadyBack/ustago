import type { Job, Review } from '@ustago/types';
import { REVIEW_COMMENT_MAX_LENGTH } from '@ustago/validation';
import { useState } from 'react';

import { jobApi, reviewApi } from '../../api/services';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { StarInput, Stars } from '../../components/StarRating';
import { FormError } from '../../components/States';
import { Body, Heading, Small } from '../../components/Text';
import { TextField } from '../../components/TextField';
import type { ApiState } from '../../hooks/useApi';
import { formatDate } from '../../lib/format';
import { useJobAction } from './useJobAction';

type Ratings = {
  rating: number | null;
  qualityRating: number | null;
  communicationRating: number | null;
  punctualityRating: number | null;
  valueRating: number | null;
};

const DETAILS: readonly { key: Exclude<keyof Ratings, 'rating'>; label: string }[] = [
  { key: 'qualityRating', label: 'İşçilik kalitesi' },
  { key: 'communicationRating', label: 'İletişim' },
  { key: 'punctualityRating', label: 'Dakiklik' },
  { key: 'valueRating', label: 'Fiyat / performans' },
];

function fromReview(r: Review | null): Ratings {
  return {
    rating: r?.rating ?? null,
    qualityRating: r?.qualityRating ?? null,
    communicationRating: r?.communicationRating ?? null,
    punctualityRating: r?.punctualityRating ?? null,
    valueRating: r?.valueRating ?? null,
  };
}

/** The customer's review: write once, edit for 30 days. */
export function ReviewSection({ job }: { job: ApiState<Job> }) {
  const j = job.data;
  const [editing, setEditing] = useState(false);
  if (!j) return null;
  const review = j.review;

  if (review && !editing) {
    return (
      <Card testID="review-card">
        <Heading>
          {j.viewerRole === 'CUSTOMER' ? 'Değerlendirmeniz' : 'Müşterinin değerlendirmesi'}
        </Heading>
        <Stars value={review.rating} size={22} />
        {review.comment ? <Body>“{review.comment}”</Body> : null}
        {review.status === 'HIDDEN' ? (
          <Small>Bu değerlendirme UstaBulHemen ekibi tarafından gizlendi.</Small>
        ) : null}
        {j.actions.editReview ? (
          <>
            <Small>{formatDate(review.editableUntil)} tarihine kadar düzenleyebilirsiniz.</Small>
            <Button title="Düzenle" variant="secondary" onPress={() => setEditing(true)} />
          </>
        ) : null}
      </Card>
    );
  }
  if (!review && !j.actions.review) return null;
  return <ReviewForm job={job} review={review} onDone={() => setEditing(false)} />;
}

function ReviewForm({
  job,
  review,
  onDone,
}: {
  job: ApiState<Job>;
  review: Review | null;
  onDone: () => void;
}) {
  const [ratings, setRatings] = useState<Ratings>(fromReview(review));
  const [comment, setComment] = useState(review?.comment ?? '');
  const j = job.data;
  const save = useJobAction(job, async () => {
    if (!j || ratings.rating === null) return null;
    const body = { ...ratings, rating: ratings.rating, comment: comment.trim() || null };
    if (review) await reviewApi.update(review.id, body);
    else await reviewApi.create(j.id, body);
    onDone();
    return jobApi.get(j.id);
  });
  const set = (key: keyof Ratings) => (value: number) =>
    setRatings((r) => ({ ...r, [key]: value }));

  return (
    <Card testID="review-form" highlight="success">
      <Heading>{review ? 'Değerlendirmeyi düzenle' : 'Ustayı değerlendirin'}</Heading>
      <Small>Puanınız ustanın profilinde gerçek bir işe dayalı olarak görünür.</Small>
      <StarInput
        testID="rating-overall"
        label="Genel puan"
        required
        value={ratings.rating}
        onChange={set('rating')}
      />
      {DETAILS.map((d) => (
        <StarInput key={d.key} label={d.label} value={ratings[d.key]} onChange={set(d.key)} />
      ))}
      <TextField
        testID="review-comment"
        label="Yorumunuz (isteğe bağlı)"
        value={comment}
        onChangeText={setComment}
        multiline
        maxLength={REVIEW_COMMENT_MAX_LENGTH}
        hint={`${comment.length}/${REVIEW_COMMENT_MAX_LENGTH}`}
        placeholder="İş nasıl geçti?"
      />
      <FormError message={save.error} />
      <Button
        testID="send-review"
        title={review ? 'Kaydet' : 'Değerlendirmeyi gönder'}
        loading={save.busy}
        disabled={ratings.rating === null}
        onPress={() => void save.submit()}
      />
      {review ? <Button title="Vazgeç" variant="ghost" onPress={onDone} /> : null}
    </Card>
  );
}
