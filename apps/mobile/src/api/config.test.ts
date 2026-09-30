import { resolveApiUrl } from './config';

const base = { envUrl: undefined, hostUri: undefined, platform: 'ios', webHostname: undefined };

describe('resolveApiUrl', () => {
  it('prefers EXPO_PUBLIC_API_URL and trims trailing slashes', () => {
    expect(
      resolveApiUrl({ ...base, envUrl: ' http://10.0.0.5:3000/ ', hostUri: '1.2.3.4:8081' }),
    ).toBe('http://10.0.0.5:3000');
  });

  it('uses the page host on web', () => {
    expect(resolveApiUrl({ ...base, platform: 'web', webHostname: '192.168.1.20' })).toBe(
      'http://192.168.1.20:3000',
    );
    expect(resolveApiUrl({ ...base, platform: 'web' })).toBe('http://localhost:3000');
  });

  it('uses the Metro host LAN IP on a physical phone', () => {
    expect(resolveApiUrl({ ...base, hostUri: '192.168.1.20:8081' })).toBe(
      'http://192.168.1.20:3000',
    );
  });

  it('uses 10.0.2.2 on the Android emulator and localhost on the iOS simulator', () => {
    expect(resolveApiUrl({ ...base, platform: 'android', hostUri: 'localhost:8081' })).toBe(
      'http://10.0.2.2:3000',
    );
    expect(resolveApiUrl({ ...base, hostUri: '127.0.0.1:8081' })).toBe('http://localhost:3000');
  });
});
