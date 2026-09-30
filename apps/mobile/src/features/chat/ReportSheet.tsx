import type { MessageReportReason } from '@ustago/types';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { chatApi } from '../../api/chat';
import { Button } from '../../components/Button';
import { FormError } from '../../components/States';
import { Body, Heading, Small } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useSubmit } from '../../hooks/useSubmit';
import { colors, radii, spacing, typography } from '../../lib/theme';
import { REPORT_REASONS } from './labels';

/** "Mesajı bildir": a reason, an optional note; support reviews it. */
export function ReportSheet({
  messageId,
  onClose,
}: {
  messageId: string | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<MessageReportReason | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const send = useSubmit(async () => {
    if (!messageId || !reason) return;
    await chatApi.report(messageId, { reason, ...(note.trim() ? { note: note.trim() } : {}) });
    setDone(true);
  });
  const close = () => {
    setReason(null);
    setNote('');
    setDone(false);
    onClose();
  };

  return (
    <Modal visible={messageId !== null} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Heading>Mesajı bildir</Heading>
          {done ? (
            <>
              <Body>Bildirimin alındı. Destek ekibi mesajı inceleyecek.</Body>
              <Button title="Kapat" onPress={close} />
            </>
          ) : (
            <>
              <Small>
                Bildirdiğin mesaj ve sohbet, yalnızca destek ekibi tarafından ve gerekçe kaydıyla
                incelenir.
              </Small>
              <View style={styles.list} accessibilityRole="radiogroup">
                {REPORT_REASONS.map((r) => (
                  <Pressable
                    key={r.value}
                    testID={`report-reason-${r.value}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: reason === r.value }}
                    onPress={() => setReason(r.value)}
                    style={[styles.option, reason === r.value && styles.optionSelected]}
                  >
                    <Text style={styles.radio}>{reason === r.value ? '◉' : '○'}</Text>
                    <Text style={styles.optionText}>{r.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextField
                label="Not (isteğe bağlı)"
                value={note}
                onChangeText={setNote}
                maxLength={500}
                multiline
              />
              <FormError message={send.error} />
              <Button
                testID="report-send"
                title="Bildir"
                variant="danger"
                disabled={!reason}
                loading={send.busy}
                onPress={() => void send.submit()}
              />
              <Button title="Vazgeç" variant="ghost" onPress={close} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  list: { gap: spacing.sm },
  option: {
    minHeight: typography.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  radio: { fontSize: 18, color: colors.primary },
  optionText: { fontSize: 15, color: colors.textPrimary, flex: 1 },
});
