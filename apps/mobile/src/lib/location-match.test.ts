import { matchByName, normalizeName } from './location-match';

describe('location matching', () => {
  it('ignores case, Turkish letters and suffixes', () => {
    expect(normalizeName('ÇUKUROVA')).toBe('cukurova');
    expect(normalizeName('Adana İli')).toBe('adana');
    expect(normalizeName('Seyhan ilçesi')).toBe('seyhan');
  });

  it('matches the first candidate that exists', () => {
    const districts = [
      { id: 'a', name: 'Seyhan' },
      { id: 'b', name: 'Çukurova' },
    ];
    expect(matchByName(districts, [null, 'Unknown', 'cukurova'])).toEqual({
      id: 'b',
      name: 'Çukurova',
    });
    expect(matchByName(districts, ['Kadıköy'])).toBeNull();
  });
});
