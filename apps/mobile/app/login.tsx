import { normalizePhone } from '@ustago/validation';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../src/api/client';
import { authApi } from '../src/api/services';
import { useAuth } from '../src/auth/AuthContext';
import { Button } from '../src/components/Button';
import { DevHint } from '../src/components/DevHint';
import { Screen } from '../src/components/Screen';
import { FormError } from '../src/components/States';
import { TextField } from '../src/components/TextField';
import { Body, Title } from '../src/components/Text';
import { useSubmit } from '../src/hooks/useSubmit';
import { formatPhoneInput, phoneDigits } from '../src/lib/format';
import { colors, spacing } from '../src/lib/theme';

export default function Login() {
  const router = useRouter();
  const { notice } = useAuth();
  const [digits, setDigits] = useState('');
  const phone = normalizePhone(`+90${digits}`);

  const [phoneError, setPhoneError] = useState<string | null>(null);

  const { submit, busy, error } = useSubmit(async (valid: string) => {
    try {
      const res = await authApi.requestOtp(valid);
      router.push({
        pathname: '/otp',
        params: {
          phone: res.phone,
          resendAt: res.resendAvailableAt,
          length: String(res.codeLength),
        },
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OTP_RATE_LIMITED') {
        const wait = e.retryAfterSeconds;
        throw new ApiError(
          429,
          e.code,
          wait
            ? `Çok sık kod istendi. Lütfen ${Math.ceil(wait / 60)} dakika sonra tekrar deneyin.`
            : e.message,
        );
      }
      throw e;
    }
  });

  const send = () => {
    if (!phone) {
      setPhoneError('Geçerli bir cep telefonu numarası girin (5XX XXX XX XX).');
      return;
    }
    void submit(phone);
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.hero}>
        <Text style={styles.logo} accessibilityRole="header">
          Usta<Text style={styles.logoAccent}>GO</Text>
        </Text>
        <Text style={styles.slogan}>İşini şimdi çözdür.</Text>
      </View>
      <Title>Giriş yap veya kaydol</Title>
      <Body muted>Cep telefonunuza tek kullanımlık bir doğrulama kodu göndereceğiz.</Body>
      {notice ? <FormError message={notice} /> : null}
      <TextField
        testID="phone-input"
        label="Cep telefonu"
        prefix="+90"
        placeholder="5XX XXX XX XX"
        keyboardType="phone-pad"
        inputMode="tel"
        textContentType="telephoneNumber"
        autoComplete="tel"
        value={formatPhoneInput(digits)}
        onChangeText={(text) => {
          setDigits(phoneDigits(text));
          setPhoneError(null);
        }}
        returnKeyType="send"
        onSubmitEditing={send}
        maxLength={13}
      />
      <FormError message={phoneError ?? error} />
      <Button
        testID="send-code"
        title="Kod Gönder"
        onPress={send}
        loading={busy}
        disabled={digits.length < 10}
      />
      <DevHint>
        Yerelde SMS gönderilmez: kod, API terminalinde “OTP KODU” satırında görünür. Demo
        numaraları: 500 000 00 01 (müşteri), 500 000 00 02 (Demo Klima Ustası).
      </DevHint>
      <Body muted style={styles.legal}>
        Devam ederek UstaGO Kullanım Koşulları ve KVKK Aydınlatma Metni’ni kabul etmiş olursunuz.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  logo: { fontSize: 40, fontWeight: '900', color: colors.textInverse, letterSpacing: -1 },
  logoAccent: { color: '#FFD166' },
  slogan: { fontSize: 16, color: colors.textInverse, marginTop: spacing.xs },
  legal: { fontSize: 12, textAlign: 'center', marginTop: 'auto' },
});
