import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/session';
import { colors } from '../../lib/theme';

/** Profile photo (signed URL) or the first letter when there is none or it fails to load. */
export function ProviderAvatar({
  name,
  photoUrl,
  size = 52,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl && !failed) {
    return (
      <Image
        source={{ uri: api.reachable(photoUrl) }}
        style={[styles.image, round]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
        accessible={false}
      />
    );
  }
  return (
    <View
      style={[styles.initials, round]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text style={[styles.letter, { fontSize: size * 0.4 }]}>
        {name.trim().slice(0, 1).toLocaleUpperCase('tr-TR') || '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.border },
  initials: {
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { fontWeight: '800', color: colors.primaryDark },
});
