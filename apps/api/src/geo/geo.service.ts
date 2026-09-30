import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { DISTANCE_CALCULATOR, type DistanceCalculator, type GeoPoint } from './distance.js';

interface DistrictCentre extends GeoPoint {
  provinceId: number;
}

const CACHE_MS = 10 * 60 * 1000;

/**
 * District centres (docs/adr/0029) cached in memory: 973 rows that change
 * only when an admin corrects a coordinate. Distances are always between
 * centres (or a request's coarse point), never a home address.
 */
@Injectable()
export class GeoService {
  private centres: Map<string, DistrictCentre> | null = null;
  private provinceCentres: Map<number, GeoPoint> | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DISTANCE_CALCULATOR) readonly calculator: DistanceCalculator,
  ) {}

  private async load(): Promise<void> {
    if (this.centres && Date.now() - this.loadedAt < CACHE_MS) return;
    this.loading ??= (async () => {
      const [districts, provinces] = await Promise.all([
        this.prisma.district.findMany({
          where: { latitude: { not: null }, longitude: { not: null } },
          select: { id: true, provinceId: true, latitude: true, longitude: true },
        }),
        this.prisma.province.findMany({
          where: { latitude: { not: null }, longitude: { not: null } },
          select: { id: true, latitude: true, longitude: true },
        }),
      ]);
      this.centres = new Map(
        districts.map((d) => [
          d.id,
          { provinceId: d.provinceId, lat: Number(d.latitude), lng: Number(d.longitude) },
        ]),
      );
      this.provinceCentres = new Map(
        provinces.map((p) => [p.id, { lat: Number(p.latitude), lng: Number(p.longitude) }]),
      );
      this.loadedAt = Date.now();
    })().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  /** Drops the cache after an admin edits coordinates. */
  invalidate(): void {
    this.loadedAt = 0;
  }

  async districtCentre(districtId: string | null | undefined): Promise<GeoPoint | null> {
    if (!districtId) return null;
    await this.load();
    const c = this.centres?.get(districtId);
    return c ? { lat: c.lat, lng: c.lng } : null;
  }

  async provinceCentre(provinceId: number): Promise<GeoPoint | null> {
    await this.load();
    return this.provinceCentres?.get(provinceId) ?? null;
  }

  /** Synchronous lookup after `ready()`; for scoring loops over many providers. */
  async ready(): Promise<(districtId: string | null | undefined) => GeoPoint | null> {
    await this.load();
    const map = this.centres;
    return (id) => {
      if (!id || !map) return null;
      const c = map.get(id);
      return c ? { lat: c.lat, lng: c.lng } : null;
    };
  }

  distanceKm(a: GeoPoint | null, b: GeoPoint | null): number | null {
    if (!a || !b) return null;
    return this.calculator.distanceKm(a, b);
  }

  async districtDistanceKm(fromDistrictId: string | null, toDistrictId: string | null) {
    const [a, b] = await Promise.all([
      this.districtCentre(fromDistrictId),
      this.districtCentre(toDistrictId),
    ]);
    return this.distanceKm(a, b);
  }
}
