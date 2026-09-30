/** Case- and accent-insensitive Turkish name comparison ("Çukurova" = "cukurova"). */
export function normalizeName(name: string): string {
  return name
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+(ili|ilcesi|merkez)$/g, '')
    .trim();
}

/** Finds the list entry whose name matches any of the candidates (reverse-geocoding result fields). */
export function matchByName<T extends { name: string }>(
  items: readonly T[],
  candidates: (string | null | undefined)[],
): T | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const wanted = normalizeName(candidate);
    const hit = items.find((i) => normalizeName(i.name) === wanted);
    if (hit) return hit;
  }
  return null;
}
