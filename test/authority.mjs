/* Phase 2 authority suite: a hostile client can fabricate ANY intent and the
   server must grant nothing it can't verify. Run against a local server:
     PORT=3996 node server.js &   then   PORT=3996 node test/authority.mjs
   (mp_smoke.cjs covers the legit-play side; this file covers the tamper side.) */
import { WebSocket } from 'ws';
import { terrainH, PLANETS } from '../shared/world.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'ws://127.0.0.1:' + (process.env.PORT || 3996);
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : 'FAIL  ') + msg); if (!cond) fails++; };

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, pid: null, code: null, prog: null, hurts: [], deaths: [], loot: [], placed: [], nodeDead: [], errs: [], tfires: [], vitals: [] };
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'welcome') { c.pid = m.pid; c.code = m.code; c.prog = m.prog; }
    if (m.t === 'prog') c.prog = m;
    if (m.t === 'hurt') c.hurts.push(m);
    if (m.t === 'pdeath') c.deaths.push(m);
    if (m.t === 'lootSpawn') c.loot.push(m);
    if (m.t === 'placed') c.placed.push(m.st);
    if (m.t === 'nodeDead') c.nodeDead.push(m);
    if (m.t === 'tfire') c.tfires.push(m);
    if (m.t === 'err') c.errs.push(m.msg);
    if (m.t === 'vitals') c.vitals.push(m);
  });
  c.send = o => ws.send(JSON.stringify(o));
  c.ready = new Promise(r => ws.on('open', r));
  return c;
}
const ty = (x, z) => terrainH(x, z, PLANETS.rust);
const pu = (c, x, z) => c.send({ t: 'pu', pos: [x, ty(x, z) + 0.1, z], yaw: 0, pitch: 0, mode: 'surface', pl: 'rust' });

(async () => {
  const A = client('A'); await A.ready; A.send({ t: 'host', name: 'A' }); await sleep(300);
  const B = client('B'); await B.ready; B.send({ t: 'join', code: A.code, name: 'B' }); await sleep(300);
  /* A: builder/victim — tier 4, resources. B: attacker — weapons + ammo only. */
  A.send({ t: 'progRestore', prog: { tier: 4, res: { fe: 500, cy: 300, bio: 100, ch: 50, pe: 0 } } });
  B.send({ t: 'progRestore', prog: { tier: 1, res: { fe: 0, cy: 0, bio: 0, ch: 0, pe: 0 },
    weapons: { pistol: true, grenade: true }, ammo: { light: 50, nade: 5 } } });
  pu(A, 0, 0); pu(B, 10, 0);
  await sleep(4400);                                  // let join spawn-protection lapse
  pu(A, 0, 0); pu(B, 10, 0);
  await sleep(250);

  /* ---- 1. fabricated progress is clamped, not trusted blindly ---- */
  ok(B.prog.res.fe === 0 && B.prog.tier === 1, 'progRestore adopted (sanitized)');

  /* ---- 2. an unowned weapon cannot hurt anyone ---- */
  B.send({ t: 'fire', wp: 4, o: [10, 1, 0], p: [0, 1, 0], target: A.pid });   // lance: not owned
  await sleep(400);
  ok(A.hurts.length === 0, 'unowned weapon fire rejected');

  /* ---- 3. the dmg field is dead — server computes pistol damage ---- */
  B.send({ t: 'fire', wp: 2, o: [10, 1, 0], p: [0, 1, 0], target: A.pid, dmg: 9999 });
  await sleep(400);
  ok(A.hurts.length === 1 && A.hurts[0].hp === 80, 'pistol hit = server-computed 20 dmg (fabricated dmg:9999 ignored), hp 80');

  /* ---- 4. cooldown flood: 5 instant shots land at most 1 more hit ---- */
  for (let i = 0; i < 5; i++) B.send({ t: 'fire', wp: 2, o: [10, 1, 0], p: [0, 1, 0], target: A.pid });
  await sleep(500);
  ok(A.hurts.length <= 2, 'rapid-fire flood rate-limited (' + A.hurts.length + ' hits total)');

  /* ---- 5. out of range: teleport far, claim a hit ---- */
  pu(B, 200, 0); await sleep(250);
  const hits5 = A.hurts.length;
  B.send({ t: 'fire', wp: 2, o: [200, 1, 0], p: [0, 1, 0], target: A.pid });
  await sleep(400);
  ok(A.hurts.length === hits5, 'out-of-range hit rejected (pistol range 65, dist 200)');

  /* ---- 6. a second progRestore (re-arm attempt) is ignored ---- */
  B.send({ t: 'progRestore', prog: { tier: 5, res: { fe: 9999 }, ammo: { light: 9999 } } });
  await sleep(200);   // verified at the end via the next prog push (step 14)

  /* ---- 7. free build: no resources -> rejected; fabricated res in intents is meaningless ---- */
  pu(B, 10, 0); await sleep(250);
  const placed0 = A.placed.length;
  B.send({ t: 'place', st: { t: 'crate', pl: 'rust', x: 12, y: ty(12, 0), z: 0, r: 0 } });
  await sleep(400);
  ok(A.placed.length === placed0 && B.errs.some(e => /resources/i.test(e)), 'broke player cannot place (server checks ITS ledger)');

  /* ---- 8. tier skip + unaffordable craft rejected ---- */
  B.send({ t: 'tierUp' }); B.send({ t: 'craft', key: 'rifle' });
  await sleep(400);
  ok(B.prog.tier === 1 && !B.prog.weapons.rifle, 'tierUp/craft without resources rejected');

  /* ---- 9. mining from across the map is rejected; in range it pays once ---- */
  const nd0 = A.nodeDead.length;
  B.send({ t: 'mine', pl: 'rust', i: 0 });                    // B is at (10,0), node 0 is wherever the seed put it
  await sleep(300);
  ok(A.nodeDead.length === nd0, 'mine intent out of reach rejected');

  /* ---- 9b. Industry gate: generator builds on the starter world, refused on an unclaimed faction planet ---- */
  const ind0 = A.placed.filter(s => s.t === 'generator').length;
  A.send({ t: 'place', st: { t: 'generator', pl: 'rust', x: 6, y: ty(6, 6), z: 6, r: 0 } });
  await sleep(300);
  ok(A.placed.filter(s => s.t === 'generator').length === ind0 + 1, 'generator builds on starter world (gate allows)');
  A.send({ t: 'pu', pos: [0, 0.1, 0], yaw: 0, pitch: 0, mode: 'surface', pl: 'cinder' });   // unclaimed faction world
  await sleep(250);
  const indC = A.placed.filter(s => s.t === 'generator').length; A.errs.length = 0;
  A.send({ t: 'place', st: { t: 'generator', pl: 'cinder', x: 0, y: 0, z: 0, r: 0 } });
  await sleep(300);
  ok(A.placed.filter(s => s.t === 'generator').length === indC && A.errs.some(e => /control this planet/.test(e)), 'generator refused on unclaimed faction planet (server gate)');
  pu(A, 0, 0); await sleep(250);                                                             // back to rust for the rest

  /* ---- 10. safe zone: A drops a beacon, B cannot hurt A inside it ---- */
  A.send({ t: 'place', st: { t: 'beacon', pl: 'rust', x: 0, y: ty(0, 0), z: 0, r: 0 } });
  await sleep(300);
  ok(A.placed.some(s => s.t === 'beacon') || B.placed.some(s => s.t === 'beacon'), 'beacon placed (tier 4 + cost paid)');
  const hits10 = A.hurts.length;
  pu(B, 40, 0); await sleep(250);                              // outside the 32m zone, pistol reaches 65
  B.send({ t: 'fire', wp: 2, o: [40, 1, 0], p: [0, 1, 0], target: A.pid });
  await sleep(400);
  ok(A.hurts.length === hits10, 'damage into Beacon safe zone rejected');

  /* ---- 11. grenades resolve on the server sim and respect the safe zone ---- */
  B.send({ t: 'nade', o: [40, ty(40, 0) + 1.5, 0], v: [-20, 4, 0] });        // lobbed toward A's zone
  await sleep(3600);
  ok(A.hurts.length === hits10 && A.deaths.length === 0, 'grenade blast cannot reach into the safe zone');

  /* ---- 12. turret: A places one (tier 4 covers tier 3 gate), it guns B down server-side ---- */
  pu(A, 100, 0); await sleep(250);
  A.send({ t: 'place', st: { t: 'turret', pl: 'rust', x: 102, y: ty(102, 0), z: 0, r: 0 } });
  await sleep(300);
  pu(B, 104, 0);                                               // B walks into turret range, far from beacon
  for (let i = 0; i < 14; i++) { await sleep(250); pu(B, 104, 0); }
  ok(B.hurts.length > 0 && A.tfires.length > 0, 'server-simulated turret damages intruder (' + B.hurts.length + ' hits)');

  /* ---- 13. death by turret: B dies server-side, respawns at full hp with spawn protection ---- */
  for (let i = 0; i < 50 && B.deaths.length === 0; i++) { await sleep(250); pu(B, 104, 0); }
  ok(B.deaths.length > 0, 'death decided server-side (pdeath)');
  ok(B.prog.hp === 100, 'respawn restores full hp in server ledger');

  /* ---- 14. force a prog push (remove refund) to inspect B's true server ledger ---- */
  const turret = A.placed.find(s => s.t === 'turret') || B.placed.find(s => s.t === 'turret');
  B.send({ t: 'remove', id: turret.id });
  await sleep(400);
  ok(B.prog.tier === 1 && B.prog.res.fe < 9999, 'second progRestore (re-arm attempt) was ignored');
  ok(B.prog.ammo.light < 50 && B.prog.weapons.pistol === true, 'ammo drained server-side per shot (' + B.prog.ammo.light + '/50)');

  /* ---- 15. O2 ledger runs server-side: away from any O2 source it drains ---- */
  const v0 = B.vitals.length ? B.vitals[B.vitals.length - 1].o2 : 100;
  for (let i = 0; i < 18; i++) { await sleep(250); pu(B, 250, 250); }   // far from ship/relays
  const v1 = B.vitals[B.vitals.length - 1];
  ok(B.vitals.length > 0 && v1.o2 < v0, 'server vitals: O2 drains away from sources (' + v0 + ' -> ' + v1.o2 + ')');

  console.log(fails === 0 ? '\nAUTHORITY SUITE PASS' : '\n' + fails + ' FAILURES');
  process.exit(fails ? 1 : 0);
})();
