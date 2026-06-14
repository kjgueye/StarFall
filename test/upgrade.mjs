/* Phase 3 guest-upgrade checklist, as code. Against one server on a temp file
   store:
   1. a GUEST (no cookie) hosts a world and makes progress under a guest token.
   2. a new account signs up, then POST /api/claim-guest (with the guest creds)
      migrates the guest's world + progress into the account.
   3. GET /api/worlds for the account now lists the claimed world.
   4. the account, on a FRESH device (cookie, no guest creds), rejoins by code
      and finds the migrated progress -> the upgrade payoff.
   5. claim-guest is guarded: no session -> 401; a bogus/foreign guest token
      claims nothing (you can only claim a guest you can authenticate).
   6. no password or bcrypt hash ever appears in the logs.
     Usage: node test/upgrade.mjs [port] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket as WS } from 'ws';
import { terrainH, PLANETS } from '../shared/world.js';

const PORT = process.argv[2] || process.env.PORT || 3988;
const BASE = `http://127.0.0.1:${PORT}`;
const URL = 'ws://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : 'FAIL  ') + msg); if (!cond) fails++; };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astravox-upgrade-'));
let logs = '';
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dataDir } });
srv.stdout.on('data', d => { logs += d; });
srv.stderr.on('data', d => { logs += d; });

let done = false;
function cleanup(code) {
  if (done) return; done = true;
  try { srv.kill('SIGTERM'); } catch (e) {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(code);
}

async function api(method, path_, body, cookie) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  const r = await fetch(BASE + path_, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (e) {}
  const setCookie = r.headers.get('set-cookie');
  const cookiePair = setCookie ? setCookie.split(';')[0] : null;
  return { status: r.status, json, cookie: cookiePair };
}

function device(cookie) {
  const ws = new WS(URL, cookie ? { headers: { cookie } } : undefined);
  const c = { ws, welcome: null, prog: null, errs: [] };
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'welcome') c.welcome = m;
    if (m.t === 'prog') c.prog = m;
    if (m.t === 'err') c.errs.push(m.msg);
  });
  ws.on('error', () => {});
  c.send = o => ws.send(JSON.stringify(o));
  c.ready = new Promise(r => ws.on('open', r));
  c.close = () => { try { ws.close(); } catch (e) {} };
  return c;
}

(async () => {
  await sleep(1200);

  /* ---------- 1. guest hosts + makes progress ---------- */
  const G = device(null); await G.ready;
  G.send({ t: 'host', name: 'GUESTY' });
  await sleep(500);
  ok(G.welcome && G.welcome.guest && G.welcome.guest.id, 'guest mints an identity on host');
  const code = G.welcome.code, worldId = G.welcome.worldId;
  const gauth = { id: G.welcome.guest.id, tok: G.welcome.guest.tok };
  const gy = terrainH(6, 0, PLANETS.rust);
  G.send({ t: 'progRestore', prog: { tier: 3, res: { fe: 400, cy: 80, bio: 20, ch: 0, pe: 0 } } });
  G.send({ t: 'pu', pos: [0, terrainH(0, 0, PLANETS.rust) + 0.1, 0], yaw: 0, pitch: 0, mode: 'surface', pl: 'rust' });
  await sleep(150);
  G.send({ t: 'place', st: { t: 'crate', pl: 'rust', x: 6, y: gy, z: 0, r: 0 } });   // fe -10 -> 390
  await sleep(400);
  ok(G.prog && G.prog.res.fe === 390, 'guest progress recorded (fe ' + (G.prog && G.prog.res.fe) + ')');
  G.close();
  await sleep(700);   // empty-room save + progress flush

  /* ---------- 2. new account + claim-guest ---------- */
  const A = await api('POST', '/api/signup', { email: 'newbie@example.com', password: 'newbie-pass-123' });
  ok(A.status === 200 && A.cookie, 'account created, session cookie set');

  /* guard: claim with no session is rejected */
  const noSess = await api('POST', '/api/claim-guest', { auth: gauth });
  ok(noSess.status === 401, 'claim-guest without a session -> 401');

  /* guard: a bogus guest token claims nothing */
  const bogus = await api('POST', '/api/claim-guest', { auth: { id: 'gdeadbeefdeadbeef', tok: 'notarealtoken000' } }, A.cookie);
  ok(bogus.status === 200 && bogus.json && bogus.json.claimed === 0, 'claim-guest with a foreign/bogus token claims nothing');

  /* the real upgrade */
  const claim = await api('POST', '/api/claim-guest', { auth: gauth }, A.cookie);
  ok(claim.status === 200 && claim.json && claim.json.claimed === 1, 'claim-guest migrates the guest world (claimed=' + (claim.json && claim.json.claimed) + ')');

  /* ---------- 3. /api/worlds now lists the claimed world ---------- */
  const w = await api('GET', '/api/worlds', undefined, A.cookie);
  ok(w.json && w.json.worlds.some(x => x.code === code), 'claimed world now appears in the account\'s /api/worlds');

  /* ---------- 4. fresh device, account cookie, rejoin -> progress followed ---------- */
  const A2 = device(A.cookie); await A2.ready;
  A2.send({ t: 'join', code, name: 'NEWBIE' });
  await sleep(500);
  ok(A2.welcome && A2.welcome.worldId === worldId, 'account rejoins the claimed world by code');
  ok(A2.welcome && A2.welcome.fresh === false, 'account is NOT fresh: the migrated progress was found');
  ok(A2.welcome && A2.welcome.prog && A2.welcome.prog.res.fe === 390, 'guest resources migrated to the account (fe ' + (A2.welcome && A2.welcome.prog && A2.welcome.prog.res.fe) + ')');
  ok(A2.welcome && A2.welcome.world.structures.some(s => s.t === 'crate' && s.x === 6), 'the guest\'s build came along too');
  A2.close();
  await sleep(300);

  /* ---------- 5. idempotency: claiming again moves nothing more ---------- */
  const again = await api('POST', '/api/claim-guest', { auth: gauth }, A.cookie);
  ok(again.status === 200 && again.json && again.json.claimed === 0, 'a second claim of the same (now empty) guest moves nothing');

  /* ---------- 6. no credentials in logs ---------- */
  ok(!/newbie-pass-123|\$2[aby]\$/.test(logs), 'no password or bcrypt hash appears in server logs');

  await sleep(200);
  console.log(fails === 0 ? '\nUPGRADE (Phase 3): ALL PASS' : '\nUPGRADE (Phase 3): ' + fails + ' FAILURES');
  cleanup(fails ? 1 : 0);
})().catch(e => { console.error(e); cleanup(1); });
