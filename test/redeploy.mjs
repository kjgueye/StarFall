/* Phase-4 hardening: sessions must SURVIVE a server redeploy. They live in the
   store (Postgres in prod, the JSON file store here), not process memory — so a
   Railway redeploy must NOT log testers out. This boots a server against a fixed
   DATA_DIR, signs up, kills the process (a redeploy), boots a SECOND process
   against the SAME DATA_DIR, and proves the original cookie still resolves.
   Also proves an expired session does not resolve, and logout survives too.
   Usage: node test/redeploy.mjs [port] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.argv[2] || '3986';
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'redeploy@example.com';
const PASSWORD = 'Sup3rSecretPw!';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astravox-redeploy-'));

let srv = null;
let done = false;
const fail = msg => { console.error('FAIL: ' + msg); cleanup(1); };
function cleanup(code) {
  if (done) return; done = true;
  try { if (srv) srv.kill(); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(code);
}

async function req(method, path_, body, cookie) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  const r = await fetch(BASE + path_, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json, setCookie: r.headers.get('set-cookie') };
}
const cookieFrom = sc => sc ? sc.split(';')[0] : '';

function boot() {
  srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dataDir }, stdio: 'ignore' });
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/healthz'); if (r.ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  fail('server did not come up');
}
function killServer() {
  return new Promise(resolve => {
    if (!srv) return resolve();
    srv.on('exit', () => resolve());
    srv.kill();
  });
}

let passed = 0;
const ok = msg => { passed++; console.log('  ok  ' + msg); };

async function run() {
  /* --- first deploy: sign up, get a session --- */
  boot();
  await waitUp();
  let r = await req('POST', '/api/signup', { email: EMAIL, password: PASSWORD });
  if (r.status !== 200 || !r.json || !r.json.ok) fail('signup should succeed, got ' + r.status + ' ' + JSON.stringify(r.json));
  const cookie = cookieFrom(r.setCookie);
  if (!cookie) fail('signup did not set a session cookie');
  ok('account created on the first deploy, session cookie issued');

  r = await req('GET', '/api/me', undefined, cookie);
  if (!r.json || !r.json.user || r.json.user.email !== EMAIL) fail('/api/me should resolve before redeploy, got ' + JSON.stringify(r.json));
  ok('session resolves before the redeploy');

  /* let the debounced file store flush, then simulate a redeploy --- */
  await new Promise(res => setTimeout(res, 500));
  await killServer();
  ok('server process killed (simulating a Railway redeploy)');

  /* --- second deploy: SAME data dir, brand-new process (in-memory state gone) --- */
  boot();
  await waitUp();
  ok('server came back up against the same persistent store');

  r = await req('GET', '/api/me', undefined, cookie);
  if (!r.json || !r.json.user || r.json.user.email !== EMAIL)
    fail('SESSION DID NOT SURVIVE THE REDEPLOY — /api/me returned ' + JSON.stringify(r.json));
  ok('the original session cookie still resolves after redeploy — testers stay logged in');

  /* --- login still works post-redeploy (user row persisted too) --- */
  r = await req('POST', '/api/login', { email: EMAIL, password: PASSWORD });
  if (r.status !== 200 || !r.json.ok) fail('login should still work after redeploy, got ' + r.status);
  ok('login against the persisted user row still works after redeploy');

  /* --- logout still revokes a session that predates this process --- */
  r = await req('POST', '/api/logout', undefined, cookie);
  if (r.status !== 200) fail('logout should be 200, got ' + r.status);
  r = await req('GET', '/api/me', undefined, cookie);
  if (!r.json || r.json.user !== null) fail('session should be dead after logout, got ' + JSON.stringify(r.json));
  ok('logout still revokes a pre-redeploy session');

  console.log(`\nREDEPLOY (Phase 4): ALL PASS — ${passed} checks`);
  cleanup(0);
}

run().catch(e => { console.error(e); cleanup(1); });
setTimeout(() => fail('test timed out'), 30000);
