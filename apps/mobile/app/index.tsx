import { Redirect } from 'expo-router';

import { useAuth } from '../src/auth/AuthContext';
import { Splash } from '../src/components/Splash';

/** Entry router: login, name setup, or the current mode's home. */
export default function Index() {
  const { status, user, mode, offlineError, retry } = useAuth();

  if (status === 'signedOut') return <Redirect href="/login" />;
  if (status === 'signedIn' && user) {
    if (!user.firstName) return <Redirect href="/profile-setup" />;
    return <Redirect href={mode === 'provider' ? '/provider' : '/customer'} />;
  }
  return <Splash error={status === 'offline' ? offlineError : null} onRetry={retry} />;
}
