/* Phase 2 accounts<->persistence link checklist, as code. Against one server
   on a temp file store:
   1. logged-in user A hosts a world + makes progress; the server keys it to
      the ACCOUNT, not a guest token (no guest minted in the welcome).
   2. GET /api/worlds returns A's world for A, NOTHING for B or anon (isolation).
   3. user A on a FRESH "device" (same cookie, no guest creds) rejoins by code
      and finds their progress restored -> the cross-device payoff.
   4. a logged-in connection that ALSO carries stale guest creds still resolves
      to the account (userId wins over the guest token).
   5. user B joins the same world: sees the shared build but gets SEPARATE
      progress (two accounts = separate data).
   6. guest play is entirely unchanged: anon host mints a guest identity, and
      rejoining with that token restores the guest's own progress.
     Usage: node test/link.mjs [port] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket as WS } from 'ws';
import { terrainH, PLANETS } from '../shared/world.js';

const PORT = process.argv[2] || process.env.PORT || 3990;
const BASE = `http://127.0.0.1:${PORT}`;
const URL = 'ws://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : 'FAIL  ') + msg); if (!cond) fails++; };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astravox-link-'));
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

/* HTTP helper; returns the bare `sf_session=...` cookie pair for WS reuse */
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

/* a WS "device": optionally carries a session cookie (logged in) */
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

  /* ---------- two real accounts ---------- */
  const A = await api('POST', '/api/signup', { email: 'alice@example.com', password: 'alice-password-1' });
  const B = await api('POST', '/api/signup', { email: 'bob@example.com', password: 'bob-password-12' });
  ok(A.status === 200 && A.cookie, 'account A created, session cookie set');
  ok(B.status === 200 && B.cookie, 'account B created, session cookie set');

  /* ---------- A1: logged-in host keys the world to the ACCOUNT ---------- */
  const A1 = device(A.cookie); await A1.ready;
  A1.send({ t: 'host', name: 'ALICE' });
  await sleep(500);
  ok(A1.welcome && A1.welcome.code, 'A hosts a world: ' + (A1.welcome && A1.welcome.code));
  ok(A1.welcome && A1.welcome.fresh === true, 'first host is fresh');
  ok(A1.welcome && !A1.welcome.guest, 'logged-in host gets NO guest token (account-backed identity)');
  const code = A1.welcome.code, worldId = A1.welcome.worldId;

  /* seed + spend so there is progress to follow the account */
  const gy = terrainH(6, 0, PLANETS.rust);
  A1.send({ t: 'progRestore', prog: { tier: 2, res: { fe: 500, cy: 100, bio: 50, ch: 0, pe: 0 } } });
  A1.send({ t: 'pu', pos: [0, terrainH(0, 0, PLANETS.rust) + 0.1, 0], yaw: 0, pitch: 0, mode: 'surface', pl: 'rust' });
  await sleep(150);
  A1.send({ t: 'place', st: { t: 'crate', pl: 'rust', x: 6, y: gy, z: 0, r: 0 } });   // fe -10
  await sleep(400);
  ok(A1.prog && A1.prog.res.fe === 490, 'A makes progress (fe ' + (A1.prog && A1.prog.res.fe) + ')');

  /* ---------- /api/worlds: account-scoped, isolated ---------- */
  const wA = await api('GET', '/api/worlds', undefined, A.cookie);
  const wB = await api('GET', '/api/worlds', undefined, B.cookie);
  const wAnon = await api('GET', '/api/worlds');
  ok(wA.json && wA.json.worlds.some(w => w.code === code), 'A sees their world in /api/worlds');
  ok(wB.json && wB.json.worlds.length === 0, 'B sees none of A\'s worlds (isolation)');
  ok(wAnon.json && wAnon.json.worlds.length === 0, 'anonymous sees no worlds');

  A1.close();
  await sleep(700);   // empty-room save + progress flush

  /* ---------- A2: FRESH device, same account, no guest creds ---------- */
  const A2 = device(A.cookie); await A2.ready;
  A2.send({ t: 'join', code, name: 'ALICE' });
  await sleep(500);
  ok(A2.welcome && A2.welcome.worldId === worldId, 'A rejoins their world from a fresh device');
  ok(A2.welcome && A2.welcome.fresh === false, 'A is NOT fresh: account progress was found');
  ok(A2.welcome && A2.welcome.prog && A2.welcome.prog.res.fe === 490, 'A\'s resources followed the account across devices');
  ok(A2.welcome && A2.welcome.world.structures.some(s => s.t === 'crate' && s.x === 6), 'A\'s build is here too');
  A2.close();
  await sleep(300);

  /* ---------- A3: logged-in AND carrying stale guest creds -> account wins ---------- */
  const A3 = device(A.cookie); await A3.ready;
  A3.send({ t: 'join', code, name: 'ALICE', auth: { id: 'gdeadbeefdeadbeef', tok: 'staleguesttoken00' } });
  await sleep(500);
  ok(A3.welcome && A3.welcome.fresh === false, 'a stale guest token does NOT override the logged-in account');
  ok(A3.welcome && !A3.welcome.guest, 'no guest identity minted for a logged-in connection');
  A3.close();
  await sleep(300);

  /* ---------- B: different account, same world = shared build, separate progress ---------- */
  const Bd = device(B.cookie); await Bd.ready;
  Bd.send({ t: 'join', code, name: 'BOB' });
  await sleep(500);
  ok(Bd.welcome && Bd.welcome.fresh === true, 'B is fresh in A\'s world (separate per-account progress)');
  ok(Bd.welcome && Bd.welcome.world.structures.some(s => s.t === 'crate' && s.x === 6), 'B sees the shared world build');
  ok(Bd.welcome && Bd.welcome.prog && Bd.welcome.prog.res.fe !== 490, 'B\'s progress is independent of A\'s');
  Bd.close();
  await sleep(300);

  /* ---------- guest play unchanged: no cookie -> guest identity ---------- */
  const G = device(null); await G.ready;
  G.send({ t: 'host', name: 'GUEST' });
  await sleep(500);
  ok(G.welcome && G.welcome.guest && G.welcome.guest.id && G.welcome.guest.tok, 'anonymous host still mints a guest identity');
  ok(G.welcome && G.welcome.fresh === true, 'guest first host is fresh');
  const gcode = G.welcome.code, gauth = { id: G.welcome.guest.id, tok: G.welcome.guest.tok };
  G.send({ t: 'progRestore', prog: { tier: 2, res: { fe: 300, cy: 0, bio: 0, ch: 0, pe: 0 } } });
  await sleep(300);
  G.close();
  await sleep(700);

  const G2 = device(null); await G2.ready;
  G2.send({ t: 'join', code: gcode, name: 'GUEST', auth: gauth });
  await sleep(500);
  ok(G2.welcome && G2.welcome.fresh === false, 'returning guest restores their own progress (token path intact)');
  ok(G2.welcome && G2.welcome.prog && G2.welcome.prog.res.fe === 300, 'guest resources persisted under the guest token');
  G2.close();

  /* ---------- no credentials ever hit the logs ---------- */
  ok(!/alice-password-1|bob-password-12|\$2[aby]\$/.test(logs), 'no password or bcrypt hash appears in server logs');

  await sleep(200);
  console.log(fails === 0 ? '\nLINK (Phase 2): ALL PASS' : '\nLINK (Phase 2): ' + fails + ' FAILURES');
  cleanup(fails ? 1 : 0);
})().catch(e => { console.error(e); cleanup(1); });
