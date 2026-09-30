// pnpm dev:reset: wipes the LOCAL development database and seeds it again.
// Asks first unless called with --yes. Never touches anything but the
// Docker database named in .env, and refuses production settings.
import { createInterface } from 'node:readline/promises';

import { bold, fail, migrateAndSeed, ok, readEnv, runOrFail, startInfra, step } from './lib.mjs';

const env = readEnv();
if (!env) fail('.env bulunamadı.', 'Önce "pnpm dev:setup" çalıştırın.');
if (env.NODE_ENV === 'production') fail('NODE_ENV=production iken sıfırlama yapılmaz.');
const url = env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1|postgres)(:\d+)?\//.test(url)) {
  fail('DATABASE_URL yerel bir veritabanını göstermiyor; sıfırlama iptal edildi.');
}

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `${bold('Yerel')} veritabanındaki TÜM veriler silinip demo verisi yeniden yüklenecek. Devam? (e/H) `,
  );
  rl.close();
  if (!/^(e|evet|y|yes)$/i.test(answer.trim())) {
    console.log('İptal edildi.');
    process.exit(0);
  }
}

startInfra();
step('Yerel veritabanı sıfırlanıyor');
runOrFail(
  'pnpm',
  ['--filter', '@ustago/api', 'exec', 'prisma', 'migrate', 'reset', '--force'],
  'Veritabanı sıfırlanamadı.',
);
ok('Veritabanı boşaltıldı');
migrateAndSeed();
