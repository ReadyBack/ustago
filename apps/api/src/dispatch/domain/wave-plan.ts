/**
 * Wave dispatch (docs/adr/0028). A request is not broadcast to every
 * eligible provider: wave 1 goes to the best few nearby, later waves widen
 * the radius and the count until enough quotes arrive. Pure and unit
 * tested; DispatchService applies it inside the request's row lock.
 */
export interface WaveConfig {
  sizes: readonly number[];
  /** Km per wave; 0 = no distance limit. */
  radiiKm: readonly number[];
}

export interface WaveCandidate {
  providerId: string;
  distanceKm: number | null;
  /** DISTRICT = serves the request's district explicitly. */
  areaFit?: 'DISTRICT' | 'REGION';
}

export interface WaveInput<C extends WaveCandidate> {
  /** Wave being planned, 1-based. */
  wave: number;
  /** Ranked best first; already excludes providers dispatched before or who quoted. */
  ranked: readonly C[];
  preferredProviderId: string | null;
  preferredOnly: boolean;
  config: WaveConfig;
}

export interface WavePlan<C extends WaveCandidate> {
  selected: (C & { isPreferred: boolean })[];
  /** Whether a further wave can be scheduled after this one. */
  hasMoreWaves: boolean;
}

export function waveSize(config: WaveConfig, wave: number): number {
  const i = Math.min(Math.max(wave, 1), config.sizes.length) - 1;
  return config.sizes[i] ?? 10;
}

export function waveRadius(config: WaveConfig, wave: number): number {
  const i = Math.min(Math.max(wave, 1), config.radiiKm.length) - 1;
  return config.radiiKm[i] ?? 0;
}

export function planWave<C extends WaveCandidate>(input: WaveInput<C>): WavePlan<C> {
  const { wave, ranked, preferredProviderId, preferredOnly, config } = input;
  const preferred = preferredProviderId
    ? ranked.find((c) => c.providerId === preferredProviderId)
    : undefined;

  if (preferredOnly && preferredProviderId) {
    // "Sadece bu ustaya gönder": no other provider until the customer widens the search.
    return {
      selected: preferred ? [{ ...preferred, isPreferred: true }] : [],
      hasMoreWaves: false,
    };
  }

  const size = waveSize(config, wave);
  const radius = waveRadius(config, wave);
  const selected: (C & { isPreferred: boolean })[] = [];
  if (preferred) selected.push({ ...preferred, isPreferred: true });
  for (const c of ranked) {
    if (selected.length >= size) break;
    if (c.providerId === preferredProviderId) continue;
    // A provider who serves the district itself is always "near". Otherwise an
    // unknown distance (no service centre) only goes out in the unbounded wave.
    if (radius > 0 && c.areaFit !== 'DISTRICT') {
      if (c.distanceKm === null || c.distanceKm > radius) continue;
    }
    selected.push({ ...c, isPreferred: false });
  }
  const remaining = ranked.length - selected.length;
  return { selected, hasMoreWaves: wave < config.sizes.length && remaining > 0 };
}
