/**
 * Human-readable coverage for the public profile (Faz 7):
 *
 * - whole-province regions:  "Mersin (tüm il)"
 * - districts of a province: "Adana: Seyhan, Çukurova"
 *   (left out when the whole province is covered anyway)
 * - radius regions:          "Seyhan merkezli 25 km"
 *
 * Provinces in plate order, district names in Turkish alphabetical order.
 * Only active districts and regions count. Pure: no I/O.
 */
export interface AreaDistrictInput {
  provinceId: number;
  provinceName: string;
  districtName: string;
  isActive?: boolean;
}

export interface AreaRegionInput {
  kind: 'PROVINCE' | 'RADIUS';
  provinceId: number;
  provinceName: string;
  centerDistrictName: string | null;
  radiusKm: number | null;
  active?: boolean;
}

const collator = new Intl.Collator('tr');

export function serviceAreaLabels(
  districts: readonly AreaDistrictInput[],
  regions: readonly AreaRegionInput[],
): string[] {
  const liveRegions = regions.filter((r) => r.active !== false);
  const wholeProvinces = new Map<number, string>();
  for (const r of liveRegions) {
    if (r.kind === 'PROVINCE') wholeProvinces.set(r.provinceId, r.provinceName);
  }

  const byProvince = new Map<number, { name: string; districts: Set<string> }>();
  for (const d of districts) {
    if (d.isActive === false || wholeProvinces.has(d.provinceId)) continue;
    const group = byProvince.get(d.provinceId) ?? { name: d.provinceName, districts: new Set() };
    group.districts.add(d.districtName);
    byProvince.set(d.provinceId, group);
  }

  const provinceIds = [...new Set([...wholeProvinces.keys(), ...byProvince.keys()])].sort(
    (a, b) => a - b,
  );
  const labels: string[] = [];
  for (const id of provinceIds) {
    const whole = wholeProvinces.get(id);
    if (whole !== undefined) {
      labels.push(`${whole} (tüm il)`);
      continue;
    }
    const group = byProvince.get(id);
    if (group && group.districts.size > 0) {
      labels.push(`${group.name}: ${[...group.districts].sort(collator.compare).join(', ')}`);
    }
  }

  const radius = liveRegions
    .filter(
      (r): r is AreaRegionInput & { centerDistrictName: string; radiusKm: number } =>
        r.kind === 'RADIUS' &&
        r.centerDistrictName !== null &&
        r.radiusKm !== null &&
        !wholeProvinces.has(r.provinceId),
    )
    .sort(
      (a, b) =>
        a.provinceId - b.provinceId ||
        collator.compare(a.centerDistrictName, b.centerDistrictName) ||
        a.radiusKm - b.radiusKm,
    );
  for (const r of radius) labels.push(`${r.centerDistrictName} merkezli ${r.radiusKm} km`);

  return [...new Set(labels)];
}
