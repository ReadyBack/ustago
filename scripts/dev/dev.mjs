// pnpm dev [api|admin|mobile ...]: checks the environment, makes sure
// PostgreSQL + Redis run, then starts the apps through Turborepo.
//   pnpm dev            API + Admin + Expo
//   pnpm dev:api        API only (also used by dev:admin's API calls)
import {
  bold,
  dockerAvailable,
  fail,
  lanAddresses,
  ok,
  PORTS,
  portOpen,
  readEnv,
  start,
  startInfra,
  step,
  warn,
} from './lib.mjs';

const APPS = {
  api: { filter: '@ustago/api', port: PORTS.api, label: 'API' },
  admin: { filter: '@ustago/admin', port: PORTS.admin, label: 'Admin' },
  mobile: { filter: '@ustago/mobile', port: PORTS.expo, label: 'Expo' },
};
const requested = process.argv.slice(2).filter((a) => a in APPS);
const apps = requested.length > 0 ? requested : Object.keys(APPS);

const env = readEnv();
if (!env) fail('.env bulunamadı.', 'Önce "pnpm dev:setup" çalıştırın (tek seferlik).');

step('Portlar kontrol ediliyor');
for (const name of apps) {
  const app = APPS[name];
  if (await portOpen(app.port)) {
    fail(
      `Port ${app.port} (${app.label}) zaten kullanımda.`,
      process.platform === 'win32'
        ? `Kullanan işlemi bulun: netstat -ano | findstr :${app.port}   Kapatın: taskkill /PID <PID> /F`
        : `Kullanan işlemi bulun: lsof -i :${app.port}   Kapatın: kill <PID>`,
    );
  }
}
ok(`Boş: ${apps.map((n) => APPS[n].port).join(', ')}`);

if (apps.includes('api')) {
  step('Veritabanı ve Redis');
  const [pg, redis] = await Promise.all([portOpen(PORTS.postgres), portOpen(PORTS.redis)]);
  if (pg && redis) {
    ok('PostgreSQL ve Redis zaten çalışıyor');
  } else if (dockerAvailable()) {
    startInfra();
  } else {
    fail(
      'PostgreSQL/Redis çalışmıyor ve Docker erişilemiyor.',
      'Docker Desktop’ı açın ve "pnpm dev" komutunu tekrar çalıştırın.',
    );
  }
}

const lan = lanAddresses();
console.log(`
${bold('UstaGO yerel ortam başlıyor')}
${apps.includes('api') ? '  API ........ http://localhost:3000/api/v1\n  Swagger .... http://localhost:3000/api/docs\n' : ''}${
  apps.includes('admin') ? '  Admin ...... http://localhost:3001\n' : ''
}${apps.includes('mobile') ? '  Expo web ... http://localhost:8081  (telefon: Expo Go ile QR kodu okutun)\n' : ''}${
  lan.length > 0 ? `  Aynı Wi-Fi’deki telefon için bilgisayar IP’si: ${lan.join(', ')}\n` : ''
}
  OTP kodları API çıktısında "[DEV SMS → ...] OTP KODU: ......" satırında görünür.
  Durdurmak için: Ctrl+C
`);
if (apps.includes('mobile') && !apps.includes('api')) {
  warn('Mobil uygulama API’ye ihtiyaç duyar; ayrı bir terminalde "pnpm dev:api" çalıştırın.');
}

const filters = apps.map((n) => `--filter=${APPS[n].filter}`);
const child = start('pnpm', ['turbo', 'run', 'dev', ...filters]);
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
