import type { ProfileCompleteness, ProfileCompletenessKey } from '@ustago/types';

/**
 * Deterministic profile checklist. It helps customers trust the profile;
 * it is not a ranking input (MATCH_V1 ignores it, docs/adr/0028), so the
 * app never says "profilini tamamla, üst sıralara çık".
 */
export interface CompletenessInput {
  hasPhoto: boolean;
  bioLength: number;
  serviceCount: number;
  areaCount: number;
  portfolioCount: number;
  weeklyHoursCount: number;
  hasServiceCenter: boolean;
  verified: boolean;
}

const LABELS: Record<ProfileCompletenessKey, string> = {
  photo: 'Profil fotoğrafı',
  bio: 'Kendini tanıtan kısa yazı',
  services: 'Hizmet kategorileri',
  areas: 'Hizmet bölgeleri',
  portfolio: 'Önceki işlerden fotoğraflar',
  availability: 'Çalışma saatleri ve hizmet merkezi',
  verification: 'Hesap doğrulaması',
};

export function profileCompleteness(i: CompletenessInput): ProfileCompleteness {
  const done: Record<ProfileCompletenessKey, boolean> = {
    photo: i.hasPhoto,
    bio: i.bioLength >= 20,
    services: i.serviceCount > 0,
    areas: i.areaCount > 0,
    portfolio: i.portfolioCount > 0,
    availability: i.weeklyHoursCount > 0 && i.hasServiceCenter,
    verification: i.verified,
  };
  const keys = Object.keys(LABELS) as ProfileCompletenessKey[];
  const items = keys.map((key) => ({ key, done: done[key], label: LABELS[key] }));
  return {
    percent: Math.round((items.filter((x) => x.done).length / items.length) * 100),
    items,
  };
}
