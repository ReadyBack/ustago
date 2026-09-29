const TURKISH_MAP: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  i̇: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/** "Şereflikoçhisar" → "sereflikochisar", "Boya / Badana" → "boya-badana". */
export function slugify(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/i̇|[çğıöşüâîû]/g, (ch) => TURKISH_MAP[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
