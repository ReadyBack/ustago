import type { ProviderReviewReply, PublicReview } from '@ustago/types';
import { replyToReviewSchema } from '@ustago/validation';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../../api/client';
import { providerV2Api } from '../../api/provider-v2';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Stars } from '../../components/StarRating';
import { FormError } from '../../components/States';
import { Body, Small } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useSubmit } from '../../hooks/useSubmit';
import { formatDate } from '../../lib/format';
import { colors, radii, spacing } from '../../lib/theme';

export const REPLY_MAX = 1000;

/** One review with the provider's single public reply ("Yanıtla" once). */
export function ReviewReplyCard({
  review,
  onReplied,
}: {
  review: PublicReview;
  onReplied: (reply: ProviderReviewReply) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const send = useSubmit(async () => {
    const parsed = replyToReviewSchema.safeParse({ body: text });
    if (!parsed.success) {
      throw new ApiError(
        400,
        'INVALID_REPLY',
        parsed.error.issues[0]?.message ?? 'Cevabı kontrol et.',
      );
    }
    onReplied(await providerV2Api.replyToReview(review.id, parsed.data.body));
    setOpen(false);
  });

  return (
    <Card testID={`review-${review.id}`}>
      <View style={styles.rowBetween}>
        <Stars value={review.rating} />
        <Small>{formatDate(review.createdAt)}</Small>
      </View>
      <Small>
        {review.authorName} · {review.categoryName}
      </Small>
      {review.comment ? <Body>{review.comment}</Body> : <Small>Yorum yazılmamış.</Small>}

      {review.reply ? (
        <View style={styles.reply} testID={`reply-${review.id}`}>
          <Text style={styles.replyTitle}>Yanıtın · {formatDate(review.reply.createdAt)}</Text>
          <Body>{review.reply.body}</Body>
        </View>
      ) : open ? (
        <>
          <TextField
            testID={`reply-input-${review.id}`}
            label="Yanıtın (herkese açık, bir kez yazılır)"
            value={text}
            onChangeText={setText}
            maxLength={REPLY_MAX}
            multiline
            hint={`${text.length}/${REPLY_MAX}`}
          />
          <FormError message={send.error} />
          <Button
            testID={`reply-send-${review.id}`}
            title="Yanıtı yayınla"
            loading={send.busy}
            disabled={text.trim().length === 0}
            onPress={() => void send.submit()}
          />
          <Button title="Vazgeç" variant="ghost" onPress={() => setOpen(false)} />
        </>
      ) : (
        <Button
          testID={`reply-open-${review.id}`}
          title="Yanıtla"
          variant="secondary"
          accessibilityHint="Bu yoruma bir kez, herkese açık yanıt verebilirsin"
          onPress={() => setOpen(true)}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reply: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
    gap: 2,
  },
  replyTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
});
