#!/usr/bin/env node
/**
 * run-smoke-with-services.mjs
 *
 * Ensures the backend (port 4000) and frontend (port 3002) are running
 * before executing the smoke tests.  Any service that is not already up
 * is started automatically and stopped again when the tests finish.
 *
 * Usage (wired to `npm test`):
 *   node scripts/run-smoke-with-services.mjs
 */

import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', grey: '\x1b[90m', cyan: '\x1b[36m' };
const bold   = (s) => `${C.bold}${s}${C.reset}`;
const green  = (s) => `${C.green}${s}${C.reset}`;
const red    = (s) => `${C.red}${s}${C.reset}`;
const yellow = (s) => `${C.yellow}${s}${C.reset}`;
const grey   = (s) => `${C.grey}${s}${C.reset}`;
const cyan   = (s) => `${C.cyan}${s}${C.reset}`;

function log(msg) { process.stdout.write(msg + '\n'); }

// ── Service definitions ───────────────────────────────────────────────────────
const SERVICES = [
  {
    name:       'Backend',
    pingUrl:    'http://localhost:4000/api',
    script:     'backend:dev',
    env:        {},
    timeoutMs:  90_000,
  },
  {
    name:       'Frontend',
    pingUrl:    'http://localhost:3002',
    script:     'frontend:start',
    env:        { BROWSER: 'none' },
    timeoutMs:  120_000,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function ping(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => { res.resume(); resolve(res.statusCode < 600); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

function waitForService(service) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + service.timeoutMs;
    let dots = 0;

    const check = async () => {
      if (await ping(service.pingUrl)) {
        process.stdout.write('\n');
        return resolve();
      }
      if (Date.now() > deadline) {
        process.stdout.write('\n');
        return reject(new Error(`${service.name} did not become reachable within ${service.timeoutMs / 1000}s`));
      }
      dots++;
      if (dots % 5 === 0) {
        const elapsed = Math.round((service.timeoutMs - (deadline - Date.now())) / 1000);
        process.stdout.write(grey(`\r  Waiting for ${service.name}… ${elapsed}s`));
      }
      setTimeout(check, 1000);
    };
    check();
  });
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const spawned = [];

function startService(service) {
  log(yellow(`  ⚡  Starting ${service.name} (npm run ${service.script})…`));
  const child = spawn(npmCmd, ['run', service.script], {
    cwd: ROOT,
    detached: false,
    stdio: 'ignore',
    env: { ...process.env, ...service.env },
  });
  child.unref();
  spawned.push(child);
  return child;
}

function stopSpawned() {
  for (const child of spawned) {
    try { child.kill('SIGTERM'); } catch (_) { /* already dead */ }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const W = 70;
log('');
log(cyan('╔' + '═'.repeat(W) + '╗'));
log(cyan('║') + bold('  SGarden Hackathon — Smoke Test Launcher'.padEnd(W)) + cyan('║'));
log(cyan('╚' + '═'.repeat(W) + '╝'));
log('');

for (const service of SERVICES) {
  process.stdout.write(grey(`  Checking ${service.name}… `));
  const up = await ping(service.pingUrl);
  if (up) {
    log(green('already running ✓'));
  } else {
    log(yellow('not running — will start'));
    startService(service);
    try {
      await waitForService(service);
      log(green(`  ${service.name} is ready ✓`));
    } catch (err) {
      log(red(`  ✖  ${err.message}`));
      stopSpawned();
      process.exit(1);
    }
  }
}

log('');
log(grey('  All services ready — launching smoke tests…'));
log('');

// Run the smoke test script, inheriting stdio so output is visible
const smoke = spawn(npmCmd, ['run', 'smoke:test'], {
  cwd:   ROOT,
  stdio: 'inherit',
  env:   process.env,
});

smoke.on('close', (code) => {
  stopSpawned();
  process.exit(code ?? 0);
});

process.on('SIGINT',  () => { stopSpawned(); process.exit(130); });
process.on('SIGTERM', () => { stopSpawned(); process.exit(143); });
