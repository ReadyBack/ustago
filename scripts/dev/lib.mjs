// Shared helpers for the local development scripts (pnpm dev:*).
// Plain Node, no dependencies, so they run the same in PowerShell, cmd,
// macOS and Linux shells.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ENV_PATH = resolve(ROOT, '.env');
export const ENV_EXAMPLE_PATH = resolve(ROOT, '.env.example');
const isWindows = process.platform === 'win32';

export const PORTS = { api: 3000, admin: 3001, expo: 8081, postgres: 5432, redis: 6379 };

const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
export const bold = color('1');
export const green = color('32');
export const yellow = color('33');
export const red = color('31');

export function step(text) {
  console.log(`\n${bold('›')} ${text}`);
}
export function ok(text) {
  console.log(`  ${green('✓')} ${text}`);
}
export function warn(text) {
  console.log(`  ${yellow('!')} ${text}`);
}
export function fail(text, hint) {
  console.error(`\n${red('✗')} ${text}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

/** Parses KEY=value lines (no interpolation), the same subset Node's loadEnvFile reads. */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

export function readEnv() {
  return existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, 'utf8')) : null;
}

/** Runs a command, streaming its output; returns the exit code. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.quiet ? 'pipe' : 'inherit',
    shell: isWindows,
    env: { ...process.env, ...options.env },
  });
  if (result.error && result.error.code === 'ENOENT') return 127;
  return result.status ?? 1;
}

export function runOrFail(command, args, message, hint, options) {
  if (run(command, args, options) !== 0) fail(message, hint);
}

export function start(command, args, options = {}) {
  return spawn(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWindows,
    env: { ...process.env, ...options.env },
  });
}

export function dockerAvailable() {
  return run('docker', ['info'], { quiet: true }) === 0;
}

export function requireDocker() {
  if (run('docker', ['--version'], { quiet: true }) !== 0) {
    fail(
      'Docker bulunamadı.',
      'Windows 11: Docker Desktop kurun (https://www.docker.com/products/docker-desktop/) ve açın.',
    );
  }
  if (!dockerAvailable()) {
    fail(
      'Docker çalışmıyor.',
      'Docker Desktop uygulamasını açın, sol altta "Engine running" yazana kadar bekleyin ve tekrar deneyin.',
    );
  }
}

/** Resolves true when something accepts TCP connections on the port. */
export function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolvePort) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(700);
    socket.once('connect', () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolvePort(false);
    });
    socket.once('error', () => resolvePort(false));
  });
}

/** IPv4 addresses a phone on the same Wi-Fi can reach this computer at. */
export function lanAddresses() {
  const skip = /^(docker|br-|veth|vEthernet \(WSL|vmnet|vboxnet|utun|lo)/i;
  return Object.entries(networkInterfaces())
    .filter(([name]) => !skip.test(name))
    .flatMap(([, list]) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address);
}

export function nodeMajor() {
  return Number(process.versions.node.split('.')[0]);
}

/** Starts PostgreSQL and Redis in Docker and waits until they are healthy. */
export function startInfra() {
  if (!existsSync(ENV_PATH)) {
    fail('.env bulunamadı.', 'Önce "pnpm dev:setup" çalıştırın.');
  }
  step('PostgreSQL ve Redis başlatılıyor (Docker)');
  requireDocker();
  runOrFail(
    'docker',
    ['compose', 'up', '-d', '--wait', 'postgres', 'redis'],
    'Docker servisleri başlatılamadı.',
    'Port 5432 veya 6379 başka bir uygulama tarafından kullanılıyor olabilir. README > Troubleshooting bölümüne bakın.',
  );
  ok('PostgreSQL (5432) ve Redis (6379) hazır');
}

/** Applies migrations and seeds reference + demo data (idempotent). */
export function migrateAndSeed() {
  step('Veritabanı şeması uygulanıyor (prisma migrate deploy)');
  runOrFail(
    'pnpm',
    ['--filter', '@ustago/api', 'exec', 'prisma', 'migrate', 'deploy'],
    'Migration uygulanamadı.',
    'PostgreSQL çalışıyor mu? "pnpm dev:infra" ile başlatın. Şifre hatası (P1000) için README > Troubleshooting.',
  );
  ok('Şema güncel');
  step('Demo verisi yükleniyor (Adana, DEMO DATA)');
  runOrFail('pnpm', ['--filter', '@ustago/api', 'prisma:seed'], 'Seed çalıştırılamadı.');
  ok('Demo verisi hazır');
}
