/* Phase-1 accounts/auth checklist, end to end against a throwaway file-store
   server. Verifies: signup+login via the HTTP API; password stored HASHED
   (never readable); generic error for both bad password and unknown email;
   logout invalidates the session; rate-limit triggers; and NO password or
   hash ever lands in the server logs.
   Usage: node test/auth.mjs [port] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.argv[2] || '3992';
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'Sup3rSecretPw!';                 // must never appear in logs or the store
const EMAIL = 'Tester@Example.COM';                // mixed case → must be normalized
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astravox-auth-'));

let logs = '';
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dataDir } });
srv.stdout.on('data', d => { logs += d; });
srv.stderr.on('data', d => { logs += d; });

const fail = msg => { console.error('FAIL: ' + msg); cleanup(1); };
let done = false;
function cleanup(code) {
  if (done) return; done = true;
  try { srv.kill(); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(code);
}

/* tiny cookie-aware request helper */
async function req(method, path_, body, cookie) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  const r = await fetch(BASE + path_, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (e) {}
  const setCookie = r.headers.get('set-cookie');
  return { status: r.status, json, setCookie };
}
const cookieFrom = sc => sc ? sc.split(';')[0] : '';

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/healthz'); if (r.ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  fail('server did not come up');
}

let passed = 0;
const ok = msg => { passed++; console.log('  ok: ' + msg); };

async function run() {
  await waitUp();

  /* --- signup --- */
  let r = await req('POST', '/api/signup', { email: EMAIL, password: PASSWORD });
  if (r.status !== 200 || !r.json || !r.json.ok) fail('signup should succeed (got ' + r.status + ' ' + JSON.stringify(r.json) + ')');
  if (r.json.email !== 'tester@example.com') fail('signup should normalize email, got ' + r.json.email);
  if (!r.setCookie || !/HttpOnly/i.test(r.setCookie)) fail('signup should set an httpOnly session cookie');
  if (!/SameSite=Lax/i.test(r.setCookie)) fail('session cookie should be SameSite=Lax');
  const signupCookie = cookieFrom(r.setCookie);
  ok('signup creates account, normalizes email, sets httpOnly cookie');

  /* --- duplicate email rejected --- */
  r = await req('POST', '/api/signup', { email: 'TESTER@example.com', password: 'anotherPw123' });
  if (r.status !== 409) fail('duplicate signup should be 409, got ' + r.status);
  ok('duplicate email rejected (409)');

  /* --- weak password rejected --- */
  r = await req('POST', '/api/signup', { email: 'short@example.com', password: 'short' });
  if (r.status !== 400) fail('short password should be 400, got ' + r.status);
  ok('short password rejected (400)');

  /* --- session-check resolves via cookie --- */
  r = await req('GET', '/api/me', undefined, signupCookie);
  if (!r.json || !r.json.user || r.json.user.email !== 'tester@example.com') fail('/api/me should resolve the session, got ' + JSON.stringify(r.json));
  ok('/api/me resolves logged-in user from cookie');

  /* --- stored password is HASHED, not plaintext --- */
  await new Promise(r => setTimeout(r, 400));        // let the file store's debounced write flush
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const users = Object.values(db.users || {});
  if (users.length !== 1) fail('expected exactly 1 user row, got ' + users.length);
  const u = users[0];
  if (!u.passwordHash || !/^\$2[aby]\$/.test(u.passwordHash)) fail('password must be a bcrypt hash, got ' + JSON.stringify(u.passwordHash));
  if (u.passwordHash.includes(PASSWORD) || JSON.stringify(db).includes(PASSWORD)) fail('plaintext password found in the store!');
  ok('password stored as bcrypt hash; plaintext nowhere in the store');

  /* --- login with correct credentials --- */
  r = await req('POST', '/api/login', { email: 'tester@example.com', password: PASSWORD });
  if (r.status !== 200 || !r.json.ok) fail('login should succeed, got ' + r.status + ' ' + JSON.stringify(r.json));
  if (!r.setCookie || !/HttpOnly/i.test(r.setCookie)) fail('login should set an httpOnly cookie');
  const loginCookie = cookieFrom(r.setCookie);
  ok('login with correct password succeeds, sets session');

  /* --- wrong password and unknown email return the SAME generic error --- */
  const bad1 = await req('POST', '/api/login', { email: 'tester@example.com', password: 'wrongpassword' });
  const bad2 = await req('POST', '/api/login', { email: 'nobody@example.com', password: 'whatever123' });
  if (bad1.status !== 401 || bad2.status !== 401) fail('bad logins should be 401 (got ' + bad1.status + '/' + bad2.status + ')');
  if (JSON.stringify(bad1.json) !== JSON.stringify(bad2.json)) fail('wrong-password and unknown-email must return identical responses; got ' + JSON.stringify(bad1.json) + ' vs ' + JSON.stringify(bad2.json));
  ok('wrong password and unknown email return identical generic error');

  /* --- logout invalidates the session --- */
  r = await req('POST', '/api/logout', undefined, loginCookie);
  if (r.status !== 200) fail('logout should be 200, got ' + r.status);
  r = await req('GET', '/api/me', undefined, loginCookie);
  if (!r.json || r.json.user !== null) fail('session should be dead after logout, got ' + JSON.stringify(r.json));
  ok('logout revokes the session (server-side)');

  /* --- rate limit triggers on repeated bad logins (8 fails → 429) --- */
  let got429 = false;
  for (let i = 0; i < 12; i++) {
    const a = await req('POST', '/api/login', { email: 'ratelimit@example.com', password: 'nope' + i });
    if (a.status === 429) { got429 = true; break; }
  }
  if (!got429) fail('rate limit never triggered after repeated bad logins');
  ok('rate limit triggers (429) after repeated bad logins');

  /* --- NO password or hash in the server logs --- */
  await new Promise(r => setTimeout(r, 150));
  if (logs.includes(PASSWORD)) fail('the plaintext password appeared in server logs!');
  if (/\$2[aby]\$/.test(logs)) fail('a bcrypt hash appeared in server logs!');
  ok('no password or hash in server logs');

  console.log(`\nPASS — ${passed} auth checks green`);
  cleanup(0);
}

run().catch(e => { console.error(e); cleanup(1); });
setTimeout(() => fail('test timed out'), 30000);
