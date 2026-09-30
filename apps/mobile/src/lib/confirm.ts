import { Alert, Platform } from 'react-native';

/** Yes/no confirmation that also works on the web build. */
export function confirm(
  title: string,
  message: string,
  onYes: () => void,
  options: { yes?: string; destructive?: boolean } = {},
): void {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Vazgeç', style: 'cancel' },
    {
      text: options.yes ?? 'Evet',
      style: options.destructive ? 'destructive' : 'default',
      onPress: onYes,
    },
  ]);
}
