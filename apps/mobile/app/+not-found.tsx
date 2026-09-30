import { Redirect, Stack, usePathname } from 'expo-router';

import { parseDeepLink } from '../src/lib/deep-link';
import { UnavailableScreen } from '../src/screens/UnavailableScreen';

/**
 * Links opened from outside the app (ustago://jobs/<id>) use the API's
 * paths, which differ from the app's routes: known ones are redirected,
 * anything else shows the "unavailable" screen.
 */
export default function NotFound() {
  const pathname = usePathname();
  const result = parseDeepLink(pathname);
  if (result.kind === 'route' && result.href !== pathname) return <Redirect href={result.href} />;
  return (
    <>
      <Stack.Screen options={{ title: 'Bulunamadı' }} />
      <UnavailableScreen />
    </>
  );
}
