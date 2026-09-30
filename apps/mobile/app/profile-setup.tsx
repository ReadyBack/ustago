import { useRouter } from 'expo-router';
import { useState } from 'react';

import { authApi } from '../src/api/services';
import { useAuth } from '../src/auth/AuthContext';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { FormError } from '../src/components/States';
import { TextField } from '../src/components/TextField';
import { Body, Title } from '../src/components/Text';
import { useSubmit } from '../src/hooks/useSubmit';

export default function ProfileSetup() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const save = useSubmit(async () => {
    await authApi.updateMe({ firstName: firstName.trim(), lastName: lastName.trim() });
    await refreshUser();
    router.replace('/');
  });
  const valid = firstName.trim().length >= 2 && lastName.trim().length >= 2;

  return (
    <Screen
      footer={
        <Button
          title="Devam Et"
          onPress={() => void save.submit()}
          loading={save.busy}
          disabled={!valid}
        />
      }
    >
      <Title>Size nasıl hitap edelim?</Title>
      <Body muted>Adınız, anlaştığınız ustaya veya müşteriye gösterilir.</Body>
      <TextField
        label="Ad"
        value={firstName}
        onChangeText={setFirstName}
        autoComplete="given-name"
        textContentType="givenName"
        autoFocus
      />
      <TextField
        label="Soyad"
        value={lastName}
        onChangeText={setLastName}
        autoComplete="family-name"
        textContentType="familyName"
      />
      <FormError message={save.error} />
    </Screen>
  );
}
