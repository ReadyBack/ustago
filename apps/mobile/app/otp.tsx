import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '../src/api/client';
import { authApi } from '../src/api/services';
import { useAuth } from '../src/auth/AuthContext';
import { Button } from '../src/components/Button';
import { DevHint } from '../src/components/DevHint';
import { OtpInput } from '../src/components/OtpInput';
import { Screen } from '../src/components/Screen';
import { FormError } from '../src/components/States';
import { Body, Small, Title } from '../src/components/Text';
import { useSubmit } from '../src/hooks/useSubmit';
import { formatPhone } from '../src/lib/format';
import { spacing } from '../src/lib/theme';

function secondsUntil(iso: string | undefined, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

const OTP_MESSAGES: Record<string, string> = {
  OTP_INVALID: 'Kod hatalı. Lütfen SMS’teki kodu kontrol edin.',
  OTP_EXPIRED: 'Kodun süresi doldu. Yeni kod isteyin.',
  OTP_TOO_MANY_ATTEMPTS: 'Çok fazla hatalı deneme yapıldı. Yeni kod isteyin.',
};

export default function Otp() {
  const router = useRouter();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{ phone: string; resendAt?: string; length?: string }>();
  const length = Number(params.length) || 6;
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(params.resendAt);
  const [now, setNow] = useState(() => Date.now());
  const wait = secondsUntil(resendAt, now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const verify = useSubmit(async (value: string) => {
    try {
      const res = await authApi.verifyOtp(params.phone, value, {});
      if (!res.tokens) throw new ApiError(500, 'NO_TOKENS', 'Giriş tamamlanamadı.');
      await signIn(res.tokens, res.user);
      router.replace(res.user.firstName ? '/' : '/profile-setup');
    } catch (e) {
      setCode('');
      if (e instanceof ApiError && OTP_MESSAGES[e.code]) {
        throw new ApiError(e.status, e.code, OTP_MESSAGES[e.code] ?? e.message);
      }
      throw e;
    }
  });

  const resend = useSubmit(async () => {
    try {
      const res = await authApi.requestOtp(params.phone);
      setResendAt(res.resendAvailableAt);
      setCode('');
      verify.setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OTP_RATE_LIMITED' && e.retryAfterSeconds) {
        setResendAt(new Date(Date.now() + e.retryAfterSeconds * 1000).toISOString());
        throw new ApiError(429, e.code, 'Çok sık kod istendi. Süre dolunca tekrar deneyin.');
      }
      throw e;
    }
  });

  return (
    <Screen>
      <Title>Kodu girin</Title>
      <Body muted>
        {formatPhone(params.phone)} numarasına gönderilen {length} haneli kodu yazın.
      </Body>
      <OtpInput
        value={code}
        onChange={(v) => {
          setCode(v);
          verify.setError(null);
        }}
        length={length}
        onComplete={(v) => void verify.submit(v)}
        error={Boolean(verify.error)}
        autoFocus
      />
      <FormError message={verify.error ?? resend.error} />
      <Button
        testID="verify-code"
        title="Doğrula ve Devam Et"
        onPress={() => void verify.submit(code)}
        loading={verify.busy}
        disabled={code.length !== length}
      />
      <View style={styles.resend}>
        {wait > 0 ? (
          <Small>Yeni kod {wait} sn sonra istenebilir.</Small>
        ) : (
          <Button
            title="Kodu tekrar gönder"
            variant="ghost"
            onPress={() => void resend.submit()}
            loading={resend.busy}
          />
        )}
      </View>
      <DevHint>
        Kod SMS ile gitmez; API terminalinde “[DEV SMS → …] OTP KODU: ……” satırındadır.
      </DevHint>
    </Screen>
  );
}

const styles = StyleSheet.create({
  resend: { alignItems: 'center', minHeight: 48, justifyContent: 'center', marginTop: spacing.xs },
});
