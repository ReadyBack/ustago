// pnpm dev:mobile: Expo in this terminal (QR code, keyboard shortcuts:
// a = Android emulator, w = web, r = reload). Builds the shared packages first.
import { fail, PORTS, portOpen, runOrFail, start, step, warn } from './lib.mjs';

if (await portOpen(PORTS.expo)) {
  fail(
    `Port ${PORTS.expo} (Expo) zaten kullanımda.`,
    'Açık kalan başka bir "expo start" penceresini kapatın.',
  );
}
if (!(await portOpen(PORTS.api))) {
  warn('API (3000) çalışmıyor görünüyor. Ayrı bir terminalde "pnpm dev:api" çalıştırın.');
}
step('Paylaşılan paketler derleniyor');
runOrFail(
  'pnpm',
  ['turbo', 'run', 'build', '--filter=@ustago/mobile^...'],
  'Paketler derlenemedi.',
);
const args = ['--filter', '@ustago/mobile', 'exec', 'expo', 'start', ...process.argv.slice(2)];
const child = start('pnpm', args);
child.on('exit', (code) => process.exit(code ?? 0));
