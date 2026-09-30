/** Emoji per category slug; the list itself always comes from the API. */
const ICONS: Record<string, string> = {
  klima: '❄️',
  elektrik: '⚡',
  'su-tesisati': '🚰',
  cilingir: '🔑',
  'beyaz-esya': '🧺',
  'boya-badana': '🎨',
  temizlik: '🧹',
  montaj: '🛠️',
};

export const categoryIcon = (slug: string) => ICONS[slug] ?? '🧰';
