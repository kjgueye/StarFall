/* Phase 3 persistence suite — the migration checklist, as code:
   1. create a world, build, disconnect
   2. RESTART THE SERVER PROCESS
   3. rejoin by code with the same guest token -> world + progress intact
   4. a second guest joins the same world and sees it
   5. progRestore is dead for a player the store already knows (fresh:false)
   Runs the server itself (twice) against a temp DATA_DIR file store.
     Usage: node test/persistence.mjs [port] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { terrainH, PLANETS } from '../shared/world.js';

const PORT = process.argv[2] || process.env.PORT || 3994;
const URL = 'ws://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : 'FAIL  ') + msg); if (!cond) fails++; };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astravox-persist-'));
function boot() {
  const srv = spawn(process.execPath, ['server.js'],
    { env: { ...process.env, PORT, DATA_DIR: dataDir }, stdio: 'ignore' });
  return srv;
}
function stop(srv) {
  return new Promise(r => { srv.on('exit', r); srv.kill('SIGTERM'); });
}
function client() {
  const ws = new WebSocket(URL);
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
  /* ---------- run 1: create, build, leave ---------- */
  let srv = boot(); await sleep(1200);

  const A = client(); await A.ready;
  A.send({ t: 'host', name: 'OWNER' });
  await sleep(500);
  ok(A.welcome && A.welcome.code, 'world created, invite code: ' + (A.welcome && A.welcome.code));
  ok(A.welcome && A.welcome.fresh === true, 'first-ever join is fresh');
  ok(A.welcome && A.welcome.guest && A.welcome.guest.id && A.welcome.guest.tok, 'server minted a guest identity');
  const code = A.welcome.code, worldId = A.welcome.worldId, auth = { id: A.welcome.guest.id, tok: A.welcome.guest.tok };

  /* fresh player: the one-time legacy import seam seeds deterministic resources */
  A.send({ t: 'progRestore', prog: { tier: 2, res: { fe: 500, cy: 100, bio: 50, ch: 0, pe: 0 } } });
  const gy = terrainH(6, 0, PLANETS.rust);
  A.send({ t: 'pu', pos: [0, terrainH(0, 0, PLANETS.rust) + 0.1, 0], yaw: 1.5, pitch: 0, mode: 'surface', pl: 'rust' });
  await sleep(150);
  A.send({ t: 'place', st: { t: 'crate', pl: 'rust', x: 6, y: gy, z: 0, r: 0 } });          // fe -10
  /* cryopod + respawn point (Outpost P1): must round-trip the restart */
  A.send({ t: 'place', st: { t: 'cryopod', pl: 'rust', x: -4, y: terrainH(-4, 0, PLANETS.rust), z: 0, r: 0 } });  // fe -18, cy -8, bio -4
  await sleep(250);
  A.send({ t: 'setSpawn', x: -4, y: terrainH(-4, 0, PLANETS.rust), z: 0 });
  await sleep(400);
  const feAfter = A.prog && A.prog.res.fe;
  ok(A.errs.length === 0 && feAfter === 500 - 10 - 18, 'crate + cryopod placed and paid for (fe ' + feAfter + ')');
  A.close();
  await sleep(700);                                       // empty-room world save + progress save

  /* ---------- restart the server process ---------- */
  await stop(srv);
  srv = boot(); await sleep(1200);

  /* ---------- run 2: rejoin by code with the same guest ---------- */
  const A2 = client(); await A2.ready;
  A2.send({ t: 'join', code, name: 'OWNER', auth });
  await sleep(600);
  ok(A2.welcome && A2.welcome.worldId === worldId, 'same world rehydrated after restart (worldId match)');
  ok(A2.welcome && A2.welcome.fresh === false, 'returning player is NOT fresh (store row found)');
  ok(A2.welcome && !A2.welcome.guest, 'known guest: token not re-minted');
  const crate = A2.welcome && A2.welcome.world.structures.find(s => s.t === 'crate' && s.x === 6);
  ok(!!crate, 'placed crate survived the restart');
  ok(A2.welcome && A2.welcome.prog && A2.welcome.prog.res.fe === 472, 'resources survived the restart');
  ok(A2.welcome && A2.welcome.loc && A2.welcome.loc.mode === 'surface' && A2.welcome.loc.pl === 'rust',
    'last position persisted (surface rust)');
  ok(A2.welcome && A2.welcome.spawn && A2.welcome.spawn.pl === 'rust' && A2.welcome.spawn.x === -4,
    'cryopod respawn point persisted across restart');

  /* progRestore must be dead for a known player */
  A2.send({ t: 'progRestore', prog: { tier: 5, res: { fe: 1, cy: 1, bio: 1, ch: 1, pe: 1 } } });
  A2.send({ t: 'pu', pos: [0, terrainH(0, 0, PLANETS.rust) + 0.1, 0], yaw: 0, pitch: 0, mode: 'surface', pl: 'rust' });
  await sleep(150);
  A2.send({ t: 'place', st: { t: 'crate', pl: 'rust', x: -6, y: terrainH(-6, 0, PLANETS.rust), z: 0, r: 0 } });
  await sleep(400);
  ok(A2.prog && A2.prog.res.fe === 472 - 10 && A2.prog.tier === 2, 'progRestore ignored on rejoin; world still playable');

  /* ---------- a second guest joins the persisted world and sees it ---------- */
  const B = client(); await B.ready;
  B.send({ t: 'join', code, name: 'FRIEND' });
  await sleep(500);
  ok(B.welcome && B.welcome.fresh === true && B.welcome.guest, 'second guest joins by code, gets own identity');
  ok(B.welcome && B.welcome.world.structures.filter(s => s.t === 'crate').length === 2, 'second guest sees the shared world');

  /* bogus code still fails cleanly */
  const C = client(); await C.ready;
  C.send({ t: 'join', code: 'ZZZZZ', name: 'NOBODY' });
  await sleep(400);
  ok(C.errs.some(e => /no world/i.test(e)), 'unknown code rejected');

  A2.close(); B.close(); C.close();
  await stop(srv);
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}

  console.log(fails === 0 ? '\nPERSISTENCE: ALL PASS' : '\nPERSISTENCE: ' + fails + ' FAILURES');
  process.exit(fails ? 1 : 0);
})();
