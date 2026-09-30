import type { ChatMessage, ConversationDetail } from '@ustago/types';
import { looksLikeContactInfo, MAX_MESSAGE_LENGTH } from '@ustago/validation';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { chatApi } from '../../api/chat';
import { Button } from '../../components/Button';
import { ErrorState, FormError, LoadingState } from '../../components/States';
import { Small } from '../../components/Text';
import { useSubmit } from '../../hooks/useSubmit';
import { confirm } from '../../lib/confirm';
import { pickImage } from '../../lib/image-upload';
import { colors, radii, spacing, typography } from '../../lib/theme';
import { cannotSendText, CONTACT_REMINDER, messageTime, POLLING_NOTE, PRICE_NOTE } from './labels';
import { MessageImage } from './MessageImage';
import { ReportSheet } from './ReportSheet';
import { type PendingMessage, useChat } from './useChat';
import { useScreenActive } from './useScreenActive';

type Row = { kind: 'message'; m: ChatMessage } | { kind: 'pending'; p: PendingMessage };

/** Shared by customers and providers: one conversation about one request/job. */
export function ChatScreen({ conversationId }: { conversationId: string }) {
  const active = useScreenActive();
  const chat = useChat(conversationId, active);
  const insets = useSafeAreaInsets();
  const [reportId, setReportId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const d = chat.detail;

  // Newest first for the inverted list: pending messages are the newest.
  const rows = useMemo<Row[]>(
    () => [
      ...[...chat.pending].reverse().map((p) => ({ kind: 'pending' as const, p })),
      ...[...chat.messages].reverse().map((m) => ({ kind: 'message' as const, m })),
    ],
    [chat.messages, chat.pending],
  );

  /** The newest of my messages gets "Okundu" / "Gönderildi" under it. */
  const myLatestId = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      if (m && m.mine && m.type !== 'SYSTEM') return m.id;
    }
    return null;
  }, [chat.messages]);

  if (chat.loading) return <LoadingState />;
  if (chat.error || !d) {
    return <ErrorState message={chat.error ?? 'Sohbet bulunamadı.'} onRetry={chat.reload} />;
  }

  const isRead = (m: ChatMessage) =>
    m.state === 'READ' ||
    (d.counterpartLastReadAt !== null && m.createdAt <= d.counterpartLastReadAt);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: d.counterpart.name }} />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      >
        <View style={styles.subheader}>
          <View style={styles.fill}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {d.title}
            </Text>
            <Small>
              {d.category.name} · {d.counterpart.name} (
              {d.counterpart.role === 'PROVIDER' ? 'usta' : 'müşteri'})
            </Small>
          </View>
          <Pressable
            testID="chat-menu"
            accessibilityRole="button"
            accessibilityLabel="Sohbet menüsü"
            onPress={() => setMenuOpen(true)}
            style={styles.menuButton}
            hitSlop={6}
          >
            <Text style={styles.menuIcon}>⋯</Text>
          </Pressable>
        </View>
        <View style={styles.notes}>
          <Small>{PRICE_NOTE}</Small>
          <Small>{POLLING_NOTE}</Small>
        </View>

        <FlatList
          testID="chat-messages"
          style={styles.fill}
          inverted
          data={rows}
          keyExtractor={(r) => (r.kind === 'message' ? r.m.id : `pending-${r.p.clientMessageId}`)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => void chat.loadOlder()}
          onEndReachedThreshold={0.2}
          ListFooterComponent={
            chat.loadingOlder ? (
              <ActivityIndicator color={colors.primary} />
            ) : chat.hasMoreBefore ? (
              <Button
                title="Önceki mesajlar"
                variant="ghost"
                onPress={() => void chat.loadOlder()}
              />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Small style={styles.centerText}>
                Henüz mesaj yok. İşle ilgili sorularını buradan sorabilirsin.
              </Small>
            </View>
          }
          renderItem={({ item }) =>
            item.kind === 'pending' ? (
              <PendingBubble
                p={item.p}
                onRetry={() => void chat.retry(item.p.clientMessageId)}
                onDiscard={() => chat.discard(item.p.clientMessageId)}
              />
            ) : (
              <MessageBubble
                m={item.m}
                status={
                  item.m.id === myLatestId ? (isRead(item.m) ? 'Okundu' : 'Gönderildi') : null
                }
                onReport={() => setReportId(item.m.id)}
              />
            )
          }
        />

        <Composer detail={d} onSendText={chat.sendText} onSendImage={chat.sendImage} />
      </KeyboardAvoidingView>

      <ChatMenu
        visible={menuOpen}
        detail={d}
        onClose={() => setMenuOpen(false)}
        onChanged={chat.setDetail}
      />
      <ReportSheet messageId={reportId} onClose={() => setReportId(null)} />
    </SafeAreaView>
  );
}

function MessageBubble({
  m,
  status,
  onReport,
}: {
  m: ChatMessage;
  status: string | null;
  onReport: () => void;
}) {
  if (m.type === 'SYSTEM') {
    return (
      <View style={styles.system} accessibilityRole="text">
        <Text style={styles.systemText}>{m.body}</Text>
        <Text style={styles.systemTime}>{messageTime(m.createdAt)}</Text>
      </View>
    );
  }
  const reportable = !m.mine;
  const label = `${m.mine ? 'Sen' : 'Karşı taraf'}: ${
    m.deletedAt ? 'Mesaj silindi' : m.type === 'IMAGE' ? 'Fotoğraf' : (m.body ?? '')
  }, ${messageTime(m.createdAt)}${status ? `, ${status}` : ''}`;
  return (
    <View style={[styles.bubbleRow, m.mine ? styles.rowMine : styles.rowTheirs]}>
      <Pressable
        testID={`message-${m.id}`}
        accessibilityLabel={label}
        accessibilityHint={reportable ? 'Bildirmek için basılı tutun' : undefined}
        accessibilityActions={reportable ? [{ name: 'report', label: 'Mesajı bildir' }] : undefined}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'report') onReport();
        }}
        onLongPress={reportable ? onReport : undefined}
        style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}
      >
        {m.deletedAt ? (
          <Text style={[styles.body, styles.deleted]}>Mesaj silindi</Text>
        ) : m.type === 'IMAGE' ? (
          <MessageImage messageId={m.id} />
        ) : (
          <Text style={[styles.body, m.mine && styles.bodyMine]}>{m.body}</Text>
        )}
        <Text style={[styles.time, m.mine && styles.timeMine]}>{messageTime(m.createdAt)}</Text>
      </Pressable>
      {m.containsContactInfo && !m.deletedAt ? (
        <Text style={styles.reminderInline} testID={`contact-note-${m.id}`}>
          {CONTACT_REMINDER}
        </Text>
      ) : null}
      {status ? (
        <Text style={styles.status} testID="message-status">
          {status}
        </Text>
      ) : null}
    </View>
  );
}

function PendingBubble({
  p,
  onRetry,
  onDiscard,
}: {
  p: PendingMessage;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const failed = p.status === 'failed';
  return (
    <View style={[styles.bubbleRow, styles.rowMine]} testID={`pending-${p.clientMessageId}`}>
      <View style={[styles.bubble, styles.mine, styles.pendingBubble]}>
        {p.type === 'IMAGE' && p.image ? (
          <MessageImage localUri={p.image.uri} />
        ) : (
          <Text style={[styles.body, styles.bodyMine]}>{p.body}</Text>
        )}
      </View>
      {failed ? (
        <View style={styles.failedRow}>
          <Text style={styles.failedText} accessibilityRole="alert">
            Gönderilemedi{p.error ? `: ${p.error}` : ''}
          </Text>
          <Pressable
            testID="retry-message"
            accessibilityRole="button"
            accessibilityLabel="Mesajı tekrar gönder"
            onPress={onRetry}
            style={styles.smallAction}
          >
            <Text style={styles.smallActionText}>Tekrar dene</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Gönderilemeyen mesajı sil"
            onPress={onDiscard}
            style={styles.smallAction}
          >
            <Text style={styles.smallActionText}>Sil</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.status} accessibilityLiveRegion="polite">
          gönderiliyor…
        </Text>
      )}
    </View>
  );
}

function Composer({
  detail,
  onSendText,
  onSendImage,
}: {
  detail: ConversationDetail;
  onSendText: (body: string) => Promise<void>;
  onSendImage: ReturnType<typeof useChat>['sendImage'];
}) {
  const [draft, setDraft] = useState('');
  const photo = useSubmit(async () => {
    const image = await pickImage();
    if (image) void onSendImage(image);
  });
  const blocked = cannotSendText(detail);
  if (blocked) {
    return (
      <View style={styles.cannotSend} testID="cannot-send" accessibilityRole="alert">
        <Text style={styles.cannotSendText}>{blocked}</Text>
      </View>
    );
  }
  const text = draft.trim();
  const send = () => {
    if (!text) return;
    setDraft('');
    void onSendText(text);
  };
  return (
    <View style={styles.composerWrap}>
      {looksLikeContactInfo(draft) ? (
        <View style={styles.reminder} testID="contact-reminder" accessibilityLiveRegion="polite">
          <Text style={styles.reminderText}>{CONTACT_REMINDER}</Text>
        </View>
      ) : null}
      <FormError message={photo.error} />
      <View style={styles.composer}>
        <Pressable
          testID="send-photo"
          accessibilityRole="button"
          accessibilityLabel="Fotoğraf gönder"
          onPress={() => void photo.submit()}
          disabled={photo.busy}
          style={styles.iconButton}
        >
          {photo.busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.icon}>📷</Text>
          )}
        </Pressable>
        <TextInput
          testID="chat-input"
          accessibilityLabel="Mesaj yaz"
          placeholder="Mesaj yaz…"
          placeholderTextColor={colors.muted}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={MAX_MESSAGE_LENGTH}
          style={styles.input}
        />
        <Pressable
          testID="chat-send"
          accessibilityRole="button"
          accessibilityLabel="Gönder"
          accessibilityState={{ disabled: !text }}
          disabled={!text}
          onPress={send}
          style={[styles.sendButton, !text && styles.sendDisabled]}
        >
          <Text style={styles.sendText}>Gönder</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ChatMenu({
  visible,
  detail,
  onClose,
  onChanged,
}: {
  visible: boolean;
  detail: ConversationDetail;
  onClose: () => void;
  onChanged: (d: ConversationDetail) => void;
}) {
  const router = useRouter();
  const toggleBlock = useSubmit(async () => {
    const next = detail.blockedByMe
      ? await chatApi.unblock(detail.id)
      : await chatApi.block(detail.id);
    onChanged(next);
    onClose();
  });
  const target = detail.jobId
    ? `/job/${detail.jobId}`
    : detail.myRole === 'CUSTOMER'
      ? `/request/${detail.serviceRequestId}`
      : `/opportunity/${detail.serviceRequestId}`;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Menüyü kapat">
        <Pressable style={styles.menu} onPress={() => undefined}>
          <Button
            title={detail.jobId ? 'İşe git' : 'Talebe git'}
            variant="ghost"
            onPress={() => {
              onClose();
              router.push(target);
            }}
          />
          <Button
            testID="toggle-block"
            title={detail.blockedByMe ? 'Engeli kaldır' : 'Engelle'}
            variant={detail.blockedByMe ? 'secondary' : 'danger'}
            loading={toggleBlock.busy}
            onPress={() =>
              detail.blockedByMe
                ? void toggleBlock.submit()
                : confirm(
                    'Engelle',
                    `${detail.counterpart.name} bu sohbetten sana mesaj gönderemez. Engeli istediğin zaman kaldırabilirsin.`,
                    () => void toggleBlock.submit(),
                    { yes: 'Engelle', destructive: true },
                  )
            }
          />
          <Small>Bir mesajı bildirmek için mesajın üzerine basılı tut.</Small>
          <FormError message={toggleBlock.error} />
          <Button title="Kapat" variant="ghost" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  fill: { flex: 1 },
  subheader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  menuButton: {
    minWidth: typography.minTouchTarget,
    minHeight: typography.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIcon: { fontSize: 24, color: colors.textPrimary, fontWeight: '800' },
  notes: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  empty: { padding: spacing.lg },
  centerText: { textAlign: 'center' },
  system: { alignSelf: 'center', alignItems: 'center', maxWidth: '85%', paddingVertical: 4 },
  systemText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  systemTime: { fontSize: 11, color: colors.muted },
  bubbleRow: { maxWidth: '85%', gap: 2 },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: radii.md, padding: spacing.sm + 2, gap: 4 },
  mine: { backgroundColor: colors.primary },
  theirs: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pendingBubble: { opacity: 0.7 },
  body: { fontSize: 15, lineHeight: 21, color: colors.textPrimary },
  bodyMine: { color: colors.textInverse },
  deleted: { fontStyle: 'italic', color: colors.textSecondary },
  time: { fontSize: 11, color: colors.textSecondary, alignSelf: 'flex-end' },
  timeMine: { color: colors.primarySoft },
  status: { fontSize: 12, color: colors.textSecondary },
  reminderInline: { fontSize: 12, color: '#9A6200' },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  failedText: { fontSize: 12, color: colors.emergency },
  smallAction: {
    minHeight: typography.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  smallActionText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  composerWrap: {
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  iconButton: {
    minWidth: typography.minTouchTarget,
    minHeight: typography.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 22 },
  input: {
    flex: 1,
    minHeight: typography.minTouchTarget,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
  },
  sendButton: {
    minHeight: typography.minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
  reminder: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  reminderText: { fontSize: 13, color: '#9A6200', fontWeight: '600' },
  cannotSend: {
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: spacing.md,
  },
  cannotSendText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  menu: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
});
