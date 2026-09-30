import { serviceAreaLabels } from './service-area-labels.js';

const d = (provinceId: number, provinceName: string, districtName: string, isActive = true) => ({
  provinceId,
  provinceName,
  districtName,
  isActive,
});

describe('serviceAreaLabels', () => {
  it('groups districts by province in plate order, names in Turkish order', () => {
    expect(
      serviceAreaLabels(
        [
          d(33, 'Mersin', 'Yenişehir'),
          d(1, 'Adana', 'Seyhan'),
          d(1, 'Adana', 'Çukurova'),
          d(1, 'Adana', 'Ceyhan'),
        ],
        [],
      ),
    ).toEqual(['Adana: Ceyhan, Çukurova, Seyhan', 'Mersin: Yenişehir']);
  });

  it('shows whole provinces once and drops their district list', () => {
    expect(
      serviceAreaLabels(
        [d(1, 'Adana', 'Seyhan'), d(33, 'Mersin', 'Tarsus')],
        [
          {
            kind: 'PROVINCE',
            provinceId: 33,
            provinceName: 'Mersin',
            centerDistrictName: null,
            radiusKm: null,
          },
        ],
      ),
    ).toEqual(['Adana: Seyhan', 'Mersin (tüm il)']);
  });

  it('labels radius regions and skips inactive rows', () => {
    expect(
      serviceAreaLabels(
        [d(1, 'Adana', 'Kozan', false)],
        [
          {
            kind: 'RADIUS',
            provinceId: 1,
            provinceName: 'Adana',
            centerDistrictName: 'Seyhan',
            radiusKm: 25,
          },
          {
            kind: 'PROVINCE',
            provinceId: 6,
            provinceName: 'Ankara',
            centerDistrictName: null,
            radiusKm: null,
            active: false,
          },
        ],
      ),
    ).toEqual(['Seyhan merkezli 25 km']);
  });

  it('is empty without coverage', () => {
    expect(serviceAreaLabels([], [])).toEqual([]);
  });
});
