/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  // The first render of a full screen transforms and loads most of expo-router and
  // react-native-web on a cold cache; on a busy CI runner that alone can pass 5 s.
  testTimeout: 30_000,
};
