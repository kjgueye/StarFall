/* ============================================================
   ASTRAVOX (formerly Starfall) co-op server — SERVER-AUTHORITATIVE + PERSISTENT (Phase 3)
   Serves the built client (dist/) over HTTP and the game protocol
   over WS. Clients send INTENTS; the server validates them against
   the shared rule modules (shared/) and broadcasts results. Nothing
   a client reports about resources, tier, ammo, HP, O2 or damage is
   trusted.

   Phase 3 adds persistence (store.js: Postgres on Railway, JSON file
   locally) and guest identity:
   - host = CREATE WORLD: a worlds row + stable invite code, owned by
     the creating guest. join = by code; if the world isn't live in
     memory it is rehydrated from the store, so worlds survive server
     restarts and everyone leaving.
   - Guests: the server mints {id, token} on first contact; the client
     stores it and sends auth{id,tok} on host/join. Tokens are stored
     hashed. "Upgrade guest to real auth" is a future seam.
   - Per-player-per-world progress lives in the store and is loaded on
     join (welcome carries fresh:false + loc). progRestore is accepted
     only on a player's FIRST EVER join to a world (fresh:true) — it is
     now purely the legacy localStorage import path.
   - Autosave: every AUTOSAVE_MS for occupied worlds, on disconnect,
     when a room empties, and on SIGTERM/SIGINT.

   PROTOCOL (JSON frames):
   client->server (intents):
     host{name,auth?,world?,cmd?}     — create (or re-import) a persistent world,
     join{code,name,auth?},
     progRestore{prog}                — one-shot legacy import, first-ever join only,
     pu{pos,yaw,pitch,mode,pl,wp,iv,dr,sw,sp,jt,ev},
     place{st}, remove{id}, repair{id}, paint{id,col}, mine{pl,i},
     craft{key}, tierUp{}, useMed{},
     fire{wp,o,p,target?}, critHit{id,wp}, nade{o,v}, shield{o,v},
     stationPlace{st}, stationRemove{id}, lootClaim{id},
     chat{text}, roverSeat{id}, roverSeatClear{id}, roverMove{id,x,y,z,ry}
   server->client (authoritative results):
     welcome{...,guest?{id,tok},fresh,loc?,prog,world{structures,beacon,deadNodes,meteor,loot,seats,tod,station,stationOnline}},
     prog{res,tier,weapons,ammo,medkits,hp,ev?}   — per-player progress snapshot,
     vitals{o2,fuel}, blackout, hurt{hp,dmg,by}, pdeath{by}, tfire{id,tp,p},
     err, pjoin, pleave, pu, placed, removed, paint, hp, destroyed, clock{tod},
     nodeDead, nodeAlive, meteorWarn/Active/meteor/meteorEnd,
     fire, nade, shield, critSnap{pl,crit[]}, critDead{id,x,z,by,ch},
     stationPlaced{by,st}, stationRemoved{id,by},
     lootSpawn, lootGone, lootGot, sys, chat, roverSeat, roverMove

   Known trust limits (closed in later phases):
   - Movement is client-predicted; pu positions are bounds/finite
     checked but not speed-validated. Aim (which target a shot claims)
     is client-chosen within server-checked range/zones.
   - Anyone may remove structures (refund to remover) — Phase 4 adds
     ownership/moderation.
   - The same guest may be connected to a world from several tabs (each
     under a distinct name); their shared progress row is last-write-wins.
   ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* shared rules/data — the SAME modules the client imports; no more hand-rolled mirrors */
import { MAX_STRUCT, SAFE_R, METEOR_DMG, HITS_PER_SHOWER, CRIT_CAP, STATION_MAX,
  MINE_RANGE, SPAWN_PROT, HP_MAX, GREN_R, GREN_DMG, GREN_FUSE, SHIELD_CD, SHIELD_LIFE,
  TURRET_R, TURRET_DMG, TURRET_CD, WORLD_R, SEA_Y,
  O2_DRAIN, O2_DRAIN_SPRINT, O2_JET_MULT, O2_DRAIN_SUBMERGED, O2_REFILL,
  EVA_O2_DRAIN, EVA_O2_REFILL } from './shared/constants.js';
import { CAT, STATION, STATION_KEYS, CRITTERS, CRIT_BY_PLANET, OWNED, NOKILL, DYNAMIC } from './shared/catalog.js';
import { PLANETS as PDATA, PLANET_KEYS as PLANETS, surfaceLayout } from './shared/world.js';
import { stationComplete, todOf, canAfford, payCost, refundFor, carryCap, o2Max,
  placeError, craftCheck, tierUpCheck, fireCheck, stationPlaceValid,
  inSafeZone, groundYAt, shotBlocked } from './shared/rules.js';
import { TIERS, WEP_KEYS, AMMO_KEYS } from './shared/tiers.js';
import { openStore } from './store.js';

const store = await openStore();
console.log('Astravox store: ' + store.kind);

/* deterministic resource-node layout per planet — same data the client renders */
const NODES = {};
for (const pl of PLANETS) NODES[pl] = surfaceLayout(PDATA[pl]).nodes;

const PORT = process.env.PORT || 3000;
const METEOR_FAST = !!process.env.METEOR_FAST;     // test knob: rapid showers
const RESPAWN_MS = +process.env.RESPAWN_MS || 180000;
const MAX_ROOMS = 200;
const MAX_PLAYERS = 4;
const ROOM_GC_MS = 10 * 60 * 1000;                 // unload (not delete) idle worlds from memory
const AUTOSAVE_MS = +process.env.AUTOSAVE_MS || 25000;
const MAX_WORLDS_PER_GUEST = 20;

const SHIELD_R = CAT.shieldgen.shieldR;            // meteor-shield dome radius
const STATION_TYPES = new Set(STATION_KEYS);

/* meteor phase timings (seconds) */
const T_IDLE = () => METEOR_FAST ? 3 : 120 + Math.random() * 120;
const T_IDLE_NEXT = () => METEOR_FAST ? 4 : 170 + Math.random() * 140;
const T_WARN = METEOR_FAST ? 2 : 20;
const T_ACTIVE = METEOR_FAST ? 5 : 12;

/* ---------- HTTP: serve the built client (vite output in dist/) ---------- */
const DIST = path.join(__dirname, 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  const rel = url === '/' ? 'index.html' : url.slice(1);
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end('forbidden'); return; }   // traversal guard
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(data);
  });
});

/* ---------- rooms (live, in-memory views of persistent worlds) ---------- */
const rooms = new Map();
const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function genCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_ALPHA[crypto.randomInt(CODE_ALPHA.length)];
    if (!rooms.has(c) && !(await store.getWorldByCode(c))) return c;
  }
  return null;
}
function newMeteorState() {
  const m = {};
  for (const pl of PLANETS) m[pl] = { phase: 'idle', t: T_IDLE(), hits: 0, spawnT: 0 };
  return m;
}
/* Build a live room from a world snapshot (a fresh host payload, a legacy
   localStorage snapshot, or a store rehydrate). Caller registers it in
   `rooms` and persists it. */
function makeRoom(world, code) {
  const room = {
    code,
    worldId: (world && typeof world.worldId === 'string' && world.worldId.length <= 24)
      ? world.worldId : 'w' + crypto.randomBytes(6).toString('hex'),
    ownerId: null,                      // guest id of the world creator
    clock: (world && isFinite(+world.clock)) ? +world.clock : 300,   // per-world time-of-day seconds
    nextId: 1, nextPid: 1, nextLoot: 1,
    structures: [], beacon: false,
    players: new Map(),                 // pid -> {ws,name,slot,pos,yaw,pitch,mode,pl}
    nodeDead: new Map(),                // "pl:i" -> respawnAt(ms epoch)
    loot: new Map(),                    // lootId -> {id,pl,pos,loot,expireAt}
    seats: new Map(),                   // roverId -> pid (current driver)
    meteor: newMeteorState(),
    crit: {}, critT: {}, nextCrit: 1, critBcast: 0,   // critters per planet
    walls: [],                          // live deployable shield walls (server blocks shots)
    station: [], nextStation: 1, stationOnline: false,  // orbital station pieces
    emptySince: 0,
  };
  for (const pl of PLANETS) { room.crit[pl] = []; room.critT[pl] = 2 + Math.random() * 4; }
  if (world && Array.isArray(world.structures)) {
    for (const s of world.structures) {
      if (room.structures.length >= MAX_STRUCT) break;
      if (!s || !CAT[s.t] || !PLANETS.includes(s.pl)) continue;
      const x = +s.x, y = +s.y, z = +s.z;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      const hp = Math.min(Math.max(1, (+s.hp || CAT[s.t].hp)), CAT[s.t].hp);
      const st = { id: room.nextId++, t: s.t, pl: s.pl, x, y, z, r: ((s.r | 0) % 4 + 4) % 4, hp };
      if (s.owner !== undefined && s.owner !== null) st.owner = s.owner;
      if (isFinite(+s.ry)) st.ry = +s.ry;
      if (isFinite(+s.col)) st.col = +s.col | 0;
      room.structures.push(st);
      if (s.t === 'beacon') room.beacon = true;
    }
  }
  if (world && Array.isArray(world.station)) {
    for (const p of world.station) {
      if (room.station.length >= STATION_MAX) break;
      if (!p || !STATION_TYPES.has(p.t)) continue;
      const x = +p.x, y = +p.y, z = +p.z;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      room.station.push({ id: room.nextStation++, t: p.t, x, y, z, qx: +p.qx || 0, qy: +p.qy || 0, qz: +p.qz || 0, qw: isFinite(+p.qw) ? +p.qw : 1, r: (p.r | 0) % 4 });
    }
    room.stationOnline = stationComplete(room.station) || !!world.stationOnline;
  }
  return room;
}

/* ---------- persistence (Phase 3) ---------- */
function serializeRoom(room) {
  return {
    v: 1, worldId: room.worldId, clock: room.clock,
    beacon: room.beacon, stationOnline: room.stationOnline,
    structures: room.structures.map(s => {
      const o = { t: s.t, pl: s.pl, x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), r: s.r, hp: s.hp | 0 };
      if (s.owner !== undefined && s.owner !== null) o.owner = s.owner;
      if (s.ry !== undefined) o.ry = +(+s.ry).toFixed(3);
      if (s.col !== undefined && s.col !== null) o.col = s.col;
      return o;
    }),
    station: room.station.map(p => ({ t: p.t, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      qx: +(+p.qx).toFixed(4), qy: +(+p.qy).toFixed(4), qz: +(+p.qz).toFixed(4), qw: +(+p.qw).toFixed(4), r: p.r | 0 })),
  };
}
function progRow(p) {
  const row = { res: { ...p.res }, tier: p.tier, weapons: { ...p.weapons }, ammo: { ...p.ammo },
    medkits: p.medkits, o2: Math.round(p.o2), fuel: Math.round(p.fuel),
    loc: { mode: p.mode, pl: p.pl, pos: p.pos.map(v => +(+v).toFixed(1)), yaw: +(+p.yaw).toFixed(2) } };
  if (p.spawn) row.spawn = p.spawn;     // cryopod respawn point {pl,x,y,z}
  return row;
}
function saveProgressOf(room, p) {
  if (p.gone || !p.guestId) return;     // `gone`: replaced by a newer session — never overwrite it
  store.saveProgress(p.guestId, room.worldId, progRow(p)).catch(() => {});
}
function saveWorld(room) {
  store.saveWorldState(room.worldId, serializeRoom(room)).catch(() => {});
}
/* ---------- per-player progress (server-authoritative as of Phase 2) ----------
   The server owns resources/tier/weapons/ammo/medkits for the whole session.
   `progRestore` is the Phase-2 persistence bridge: once, right after joining,
   a client may submit its localStorage progress blob (sanitized + clamped).
   Phase 3 replaces that bridge with Postgres keyed by guest id. */
const ci = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));
function freshProg() {
  return { res: { fe: 0, cy: 0, bio: 0, ch: 0, pe: 0 }, tier: 1,
    weapons: {}, ammo: { light: 0, heavy: 0, fuel: 0, nade: 0 }, medkits: 0 };
}
function sanitizeProg(d) {
  d = (d && typeof d === 'object') ? d : {};
  const out = freshProg(), rs = d.res || {}, w = d.weapons || {}, a = d.ammo || {};
  for (const k in out.res) out.res[k] = ci(rs[k], 0, 99999);
  out.tier = ci(d.tier, 1, TIERS.length);
  for (const k of WEP_KEYS) out.weapons[k] = !!w[k];
  for (const k of AMMO_KEYS) out.ammo[k] = ci(a[k], 0, 9999);
  out.medkits = ci(d.medkits, 0, 99);
  return out;
}
function progOf(p) {
  return { res: { ...p.res }, tier: p.tier, weapons: { ...p.weapons }, ammo: { ...p.ammo }, medkits: p.medkits, hp: p.hp };
}
function sendProg(room, pid, ev) {
  const p = room.players.get(pid); if (!p) return;
  const msg = Object.assign({ t: 'prog' }, progOf(p));
  if (ev) msg.ev = ev;
  sendTo(p.ws, msg);
}
/* grant resources into a player's pack, respecting the shared carry cap */
function grantRes(room, p, key, amt) {
  const cap = carryCap(room.structures);
  const before = p.res[key] | 0;
  p.res[key] = Math.min(cap, before + Math.max(0, amt | 0));
  return p.res[key] - before;
}

/* ---------- combat authority (Phase 2.3): the server owns player HP ---------- */
function damagePlayer(room, pid, dmg, byPid) {
  const p = room.players.get(pid); if (!p) return;
  if (p.mode !== 'surface') return;
  if (Date.now() < p.invulnUntil) return;                               // spawn protection
  if (inSafeZone(room.structures, p.pl, p.pos[0], p.pos[2])) return;    // Beacon safe zone
  p.hp = Math.max(0, p.hp - dmg);
  if (p.hp > 0) { sendTo(p.ws, { t: 'hurt', hp: p.hp, dmg, by: byPid }); return; }
  /* death: drop the SERVER-tracked cache where they fell, reset, respawn-protect */
  const drop = { fe: p.res.fe | 0, cy: p.res.cy | 0, bio: p.res.bio | 0 };
  p.res.fe = 0; p.res.cy = 0; p.res.bio = 0;          // Chitin & Pearls kept through death
  if (drop.fe || drop.cy || drop.bio) {
    const id = 'L' + (room.nextLoot++);
    const cont = { id, pl: p.pl, pos: [p.pos[0], p.pos[1], p.pos[2]], loot: drop, expireAt: Date.now() + 300000 };
    room.loot.set(id, cont);
    bcast(room, { t: 'lootSpawn', id, pl: cont.pl, pos: cont.pos, loot: drop });
  }
  p.hp = HP_MAX;
  p.invulnUntil = Date.now() + SPAWN_PROT * 1000;
  const killer = room.players.get(byPid);
  bcast(room, { t: 'sys', text: (killer ? killer.name : 'Someone') + ' eliminated ' + p.name });
  sendTo(p.ws, { t: 'pdeath', by: byPid });
  sendProg(room, pid);
}
/* critter damage + chitin payout — used by critHit intents and grenade AoE */
function damageCritter(room, plKey, c, dmg, byPid, fromX, fromZ) {
  const arr = room.crit[plKey]; if (!arr || arr.indexOf(c) < 0) return;
  c.hp -= dmg;
  c.st = 1; c.idle = 0; c.hd = Math.atan2(c.z - fromZ, c.x - fromX);   // flee the shooter
  if (c.hp <= 0) {
    arr.splice(arr.indexOf(c), 1);
    const r = CRITTERS[c.type].ch;
    const ch = r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
    const by = room.players.get(byPid);
    const got = by ? grantRes(room, by, 'ch', ch) : 0;
    bcast(room, { t: 'critDead', id: c.id, x: +c.x.toFixed(1), z: +c.z.toFixed(1), by: byPid, ch });
    if (by) sendProg(room, byPid, { type: 'gain', k: 'ch', amt: got });
  }
}
/* ballistic sim on the shared heightfield+structures — grenade rest point / shield landing */
function simThrowable(room, pl, o, v, kind) {
  let x = +o[0], y = +o[1], z = +o[2], vx = +v[0], vy = +v[1], vz = +v[2];
  const dt = 0.05;
  for (let t = 0; t < GREN_FUSE; t += dt) {
    vy -= 18 * dt; x += vx * dt; y += vy * dt; z += vz * dt;
    const gy = groundYAt(room.structures, pl, x, z, 1e9);
    if (y <= gy + 0.22) {
      if (kind === 'shield') return { x, y: gy, z, t };
      y = gy + 0.22; vy *= -0.4; vx *= 0.55; vz *= 0.55;
      if (Math.abs(vy) < 1.2) { vy = 0; vx *= 0.6; vz *= 0.6; }
    }
    const r = Math.hypot(x, z);
    if (r > WORLD_R - 2) { x *= (WORLD_R - 2) / r; z *= (WORLD_R - 2) / r; vx *= -0.4; vz *= -0.4; }
  }
  return { x, y, z, t: GREN_FUSE };
}
function activeWalls(room, pl) {
  const now = Date.now();
  room.walls = room.walls.filter(w => now < w.expireAt);
  return room.walls.filter(w => w.pl === pl);
}

function bcast(room, obj, exceptPid) {
  const msg = JSON.stringify(obj);
  for (const [pid, p] of room.players) {
    if (pid === exceptPid) continue;
    if (p.ws.readyState === 1) { try { p.ws.send(msg); } catch (e) {} }
  }
}
function sendTo(ws, obj) { if (ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
function deadNodesByPlanet(room) {
  const out = {};
  for (const key of room.nodeDead.keys()) {
    const [pl, i] = key.split(':');
    (out[pl] = out[pl] || []).push(+i);
  }
  return out;
}
function meteorSnapshot(room) {
  const out = {};
  for (const pl of PLANETS) {
    const m = room.meteor[pl];
    if (m.phase !== 'idle') out[pl] = { phase: m.phase, secs: Math.max(0, Math.ceil(m.t)) };
  }
  return out;
}
function welcomeMsg(room, pid) {
  const self = room.players.get(pid);
  return {
    t: 'welcome', pid, code: room.code, worldId: room.worldId,
    prog: self ? Object.assign(progOf(self), { o2: Math.round(self.o2), fuel: Math.round(self.fuel) }) : undefined,
    players: [...room.players.entries()].map(([id, p]) => ({ pid: id, name: p.name, slot: p.slot })),
    world: {
      structures: room.structures,
      beacon: room.beacon,
      deadNodes: deadNodesByPlanet(room),
      meteor: meteorSnapshot(room),
      loot: [...room.loot.values()].map(c => ({ id: c.id, pl: c.pl, pos: c.pos, loot: c.loot })),
      seats: [...room.seats.entries()],
      tod: todOf(room.clock),
      station: room.station,
      stationOnline: room.stationOnline,
    },
  };
}

/* ---------- websocket ---------- */
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.room = null; ws.pid = null;
  ws.q = Promise.resolve();             // per-socket queue: messages handled strictly in order
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    ws.q = ws.q.then(() => handle(ws, m)).catch(e => { /* never crash on a bad message */ });
  });
  ws.on('close', () => {
    const room = ws.room;
    if (!room || ws.pid === null) return;
    const p = room.players.get(ws.pid);
    if (p && p.ws === ws) {
      saveProgressOf(room, p);
      room.players.delete(ws.pid);
      for (const [rid, dpid] of room.seats) if (dpid === ws.pid) { room.seats.delete(rid); bcast(room, { t: 'roverSeat', id: rid, pid: 0 }); }
      bcast(room, { t: 'pleave', pid: ws.pid });
      if (room.players.size === 0) { room.emptySince = Date.now(); saveWorld(room); }
    }
  });
});

/* ---------- guest identity (Phase 3) ---------- */
const hashTok = t => crypto.createHash('sha256').update(String(t)).digest('hex');
async function resolveGuest(m, name) {
  const a = m.auth;
  if (a && typeof a.id === 'string' && a.id.length <= 32 && typeof a.tok === 'string' && a.tok.length <= 64) {
    const row = await store.authPlayer(a.id, hashTok(a.tok));
    if (row) return { id: row.id, tok: null };      // known guest; token never re-sent
  }
  const id = 'g' + crypto.randomBytes(8).toString('hex');
  const tok = crypto.randomBytes(16).toString('hex');
  await store.createPlayer({ id, tokenHash: hashTok(tok), name });
  return { id, tok };                               // fresh guest; token goes back in welcome
}

async function joinRoom(ws, room, name, opts) {
  name = String(name || '').trim().slice(0, 16) || 'PLAYER';
  const guest = (opts && opts.guest) || null;
  for (const [pid, p] of room.players) {
    if (p.name.toLowerCase() !== name.toLowerCase()) continue;
    if (guest && p.guestId === guest.id) {
      /* same guest, same name = a reconnect racing its own ghost session: replace it */
      p.gone = true;
      try { p.ws.terminate(); } catch (e) {}
      room.players.delete(pid);
      for (const [rid, dpid] of room.seats) if (dpid === pid) { room.seats.delete(rid); bcast(room, { t: 'roverSeat', id: rid, pid: 0 }); }
      bcast(room, { t: 'pleave', pid });
    } else {
      sendTo(ws, { t: 'err', msg: 'That name is taken in this world', fatal: true }); return;
    }
  }
  if (room.players.size >= MAX_PLAYERS) { sendTo(ws, { t: 'err', msg: 'World is full (4 players max)', fatal: true }); return; }
  const used = new Set([...room.players.values()].map(p => p.slot));
  let slot = 0; while (used.has(slot)) slot++;
  const pid = room.nextPid++;
  const player = Object.assign(
    { ws, name, slot, pos: [0, 0, 0], yaw: 0, pitch: 0, mode: 'space', pl: 'rust',
      hp: HP_MAX, o2: 100, fuel: 100, invulnUntil: Date.now() + SPAWN_PROT * 1000,
      joinedAt: Date.now(), restored: false, fresh: true, guestId: guest ? guest.id : null,
      lastMine: 0, lastRepair: 0, fireAt: {} },
    freshProg());
  /* stored progress (per player, per world) is the source of truth on rejoin */
  let loc = null;
  if (guest) {
    const saved = await store.getProgress(guest.id, room.worldId).catch(() => null);
    if (saved) {
      player.fresh = false; player.restored = true;
      const s = sanitizeProg(saved);
      player.res = s.res; player.tier = s.tier; player.weapons = s.weapons; player.ammo = s.ammo; player.medkits = s.medkits;
      player.o2 = Math.max(5, Math.min(o2Max(s.tier), +saved.o2 || 100));
      player.fuel = Math.max(0, Math.min(100, +saved.fuel || 100));
      if (saved.spawn && PLANETS.includes(saved.spawn.pl)
          && [saved.spawn.x, saved.spawn.y, saved.spawn.z].every(v => isFinite(+v))) {
        player.spawn = { pl: saved.spawn.pl, x: +saved.spawn.x, y: +saved.spawn.y, z: +saved.spawn.z };
      }
      if (saved.loc && Array.isArray(saved.loc.pos) && saved.loc.pos.length === 3 && saved.loc.pos.every(v => isFinite(+v))) {
        loc = { mode: saved.loc.mode === 'surface' ? 'surface' : 'space',
          pl: PLANETS.includes(saved.loc.pl) ? saved.loc.pl : 'rust',
          pos: saved.loc.pos.map(Number), yaw: +saved.loc.yaw || 0 };
        player.mode = loc.mode; player.pl = loc.pl; player.pos = loc.pos.slice(); player.yaw = loc.yaw;
      }
    }
    store.touchPlayer(guest.id, name).catch(() => {});
  }
  /* secret "Commander" host: maxed resources in your own fresh world */
  if (opts && opts.commander && player.fresh) for (const k in player.res) player.res[k] = 99999;
  room.players.set(pid, player);
  room.emptySince = 0;
  ws.room = room; ws.pid = pid;
  const w = welcomeMsg(room, pid);
  w.fresh = player.fresh;
  if (loc) w.loc = loc;
  if (player.spawn) w.spawn = player.spawn;
  if (guest && guest.tok) w.guest = { id: guest.id, tok: guest.tok };
  sendTo(ws, w);
  bcast(room, { t: 'pjoin', pid, name, slot }, pid);
}

/* bring a stored world back to life (or join its already-live room) */
async function joinPersisted(ws, w, name, opts) {
  let room = rooms.get(w.code);
  if (!room) {                          // no awaits between get and set — no double-rehydrate race
    if (rooms.size >= MAX_ROOMS) { sendTo(ws, { t: 'err', msg: 'Server is at capacity, try later', fatal: true }); return; }
    room = makeRoom(w.state || {}, w.code);
    room.worldId = w.id;
    room.ownerId = w.ownerId || null;
    rooms.set(w.code, room);
  }
  await joinRoom(ws, room, name, opts);
}

async function handle(ws, m) {
  switch (m.t) {
    case 'host': {
      if (ws.room) return;
      if (rooms.size >= MAX_ROOMS) { sendTo(ws, { t: 'err', msg: 'Server is at capacity, try later', fatal: true }); return; }
      const guest = await resolveGuest(m, String(m.name || '').trim().slice(0, 16));
      /* a legacy snapshot whose worldId we already persist = that world, not a copy */
      if (m.world && typeof m.world.worldId === 'string') {
        let existing = null;
        for (const r of rooms.values()) if (r.worldId === m.world.worldId) { existing = r; break; }
        if (existing) { await joinRoom(ws, existing, m.name, { guest }); return; }
        const w = await store.getWorldById(m.world.worldId).catch(() => null);
        if (w) { await joinPersisted(ws, w, m.name, { guest }); return; }
      }
      if (await store.countWorldsByOwner(guest.id).catch(() => 0) >= MAX_WORLDS_PER_GUEST) {
        sendTo(ws, { t: 'err', msg: 'World limit reached (' + MAX_WORLDS_PER_GUEST + ' per player)', fatal: true }); return;
      }
      const code = await genCode();
      if (!code) { sendTo(ws, { t: 'err', msg: 'Could not create world', fatal: true }); return; }
      const room = makeRoom(m.world, code);
      room.ownerId = guest.id;
      try {
        await store.createWorld({ id: room.worldId, code, ownerId: guest.id, state: serializeRoom(room) });
      } catch (e) { sendTo(ws, { t: 'err', msg: 'Could not create world', fatal: true }); return; }
      rooms.set(code, room);
      await joinRoom(ws, room, m.name, { commander: !!m.cmd, guest });
      if (room.players.size === 0) rooms.delete(room.code); // join failed somehow
      return;
    }
    case 'join': {
      if (ws.room) return;
      const code = String(m.code || '').trim().toUpperCase();
      const guest = await resolveGuest(m, String(m.name || '').trim().slice(0, 16));
      let room = rooms.get(code);
      if (!room) {
        const w = await store.getWorldByCode(code).catch(() => null);
        if (!w) { sendTo(ws, { t: 'err', msg: 'No world with that code', fatal: true }); return; }
        await joinPersisted(ws, w, m.name, { guest });
        return;
      }
      await joinRoom(ws, room, m.name, { guest });
      return;
    }
  }
  const room = ws.room;
  if (!room || ws.pid === null) return;
  const me = room.players.get(ws.pid);
  if (!me) return;

  switch (m.t) {
    case 'pu': {
      if (!Array.isArray(m.pos) || m.pos.length !== 3) return;
      const pos = m.pos.map(Number);
      if (pos.some(v => !isFinite(v) || Math.abs(v) > 4000)) return;
      me.pos = pos; me.yaw = +m.yaw || 0; me.pitch = +m.pitch || 0;
      me.mode = m.mode === 'surface' ? 'surface' : 'space';
      me.pl = PLANETS.includes(m.pl) ? m.pl : me.pl;
      me.sp = !!m.sp; me.jt = !!m.jt; me.ev = !!m.ev;   // activity flags for the vitals ledger
      bcast(room, { t: 'pu', pid: ws.pid, pos: me.pos, yaw: me.yaw, pitch: me.pitch, mode: me.mode, pl: me.pl,
        wp: m.wp | 0, iv: m.iv ? 1 : 0, dr: m.dr | 0, sw: m.sw ? 1 : 0 }, ws.pid);
      return;
    }
    case 'progRestore': {
      /* one-shot LEGACY localStorage import — only on a player's first-ever
         join to this world (no stored progress row); thereafter the store
         is the source of truth and this intent is dead */
      if (!me.fresh || me.restored || Date.now() - me.joinedAt > 20000) return;
      me.restored = true; me.fresh = false;
      const s = sanitizeProg(m.prog);
      me.res = s.res; me.tier = s.tier; me.weapons = s.weapons; me.ammo = s.ammo; me.medkits = s.medkits;
      me.o2 = Math.max(5, Math.min(o2Max(me.tier), +((m.prog || {}).o2) || 100));
      me.fuel = Math.max(0, Math.min(100, +((m.prog || {}).fuel) || 100));
      saveProgressOf(room, me);
      sendProg(room, ws.pid);
      return;
    }
    case 'place': {
      const s = m.st;
      if (!s || !CAT[s.t] || !PLANETS.includes(s.pl)) return;
      const x = +s.x, y = +s.y, z = +s.z;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
      if (me.mode !== 'surface' || me.pl !== s.pl) { sendTo(ws, { t: 'err', msg: 'You must be on that surface to build' }); return; }
      if (s.t === 'beacon' && room.beacon) { sendTo(ws, { t: 'err', msg: 'The Beacon is already placed' }); return; }
      if (s.t === 'turret') {
        let mine = 0; for (const o of room.structures) if (o.t === 'turret' && o.owner === ws.pid) mine++;
        if (mine >= 8) { sendTo(ws, { t: 'err', msg: 'Turret limit reached (8 per player)' }); return; }
      }
      const err = placeError({ structures: room.structures, st: { t: s.t, pl: s.pl, x, y, z, r: s.r | 0 },
        tier: me.tier, res: me.res, px: me.pos[0], pz: me.pos[2] });
      if (err) { sendTo(ws, { t: 'err', msg: err }); return; }
      payCost(me.res, CAT[s.t].cost);
      const st = { id: room.nextId++, t: s.t, pl: s.pl, x, y, z, r: ((s.r | 0) % 4 + 4) % 4, hp: CAT[s.t].hp };
      if (OWNED.has(s.t)) st.owner = ws.pid;
      if (DYNAMIC.has(s.t)) st.ry = isFinite(+s.ry) ? +s.ry : 0;
      if (isFinite(+s.col)) st.col = +s.col | 0;
      room.structures.push(st);
      if (st.t === 'beacon') room.beacon = true;
      bcast(room, { t: 'placed', by: ws.pid, st });
      sendProg(room, ws.pid);
      return;
    }
    case 'remove': {
      const st = room.structures.find(s => s.id === m.id);
      if (!st) return;
      if (st.t === 'beacon') { sendTo(ws, { t: 'err', msg: 'The Beacon cannot be removed' }); return; }
      room.structures.splice(room.structures.indexOf(st), 1);
      const rf = refundFor(CAT[st.t].cost);
      for (const k in rf) grantRes(room, me, k, rf[k]);
      bcast(room, { t: 'removed', id: st.id, by: ws.pid });
      sendProg(room, ws.pid);
      return;
    }
    case 'repair': {
      const st = room.structures.find(s => s.id === m.id);
      if (!st || st.hp >= CAT[st.t].hp) return;
      const now = Date.now();
      if (now - me.lastRepair < 600) return;                      // repair pulses every 0.8s
      if ((me.res.fe | 0) < 2) { sendTo(ws, { t: 'err', msg: 'Repair needs 2 Ferrite' }); return; }
      me.lastRepair = now; me.res.fe -= 2;
      st.hp = CAT[st.t].hp;
      bcast(room, { t: 'hp', id: st.id, hp: st.hp });
      sendProg(room, ws.pid);
      return;
    }
    case 'craft': {
      const key = String(m.key || '');
      const r = craftCheck(key, me.tier, me.res, me.weapons);
      if (r.err) { sendTo(ws, { t: 'err', msg: r.err }); return; }
      payCost(me.res, r.cost);
      const c = r.c;
      if (c.kind === 'weapon') me.weapons[key] = true;
      else if (c.kind === 'ammo') me.ammo[c.ammo] = Math.min(9999, (me.ammo[c.ammo] | 0) + c.give);
      else if (c.kind === 'med') me.medkits = Math.min(99, me.medkits + 1);
      else if (c.kind === 'throwable') { me.weapons[c.own] = true; me.ammo[c.ammo] = Math.min(9999, (me.ammo[c.ammo] | 0) + c.give); }
      else if (c.kind === 'gadget') me.weapons[c.own] = true;
      sendProg(room, ws.pid, { type: 'craft', key });
      return;
    }
    case 'tierUp': {
      const n = me.tier + 1;
      const r = tierUpCheck(me.tier, n, me.res);
      if (r.err) { sendTo(ws, { t: 'err', msg: r.err }); return; }
      payCost(me.res, r.cost);
      me.tier = n;
      me.o2 = Math.max(me.o2, o2Max(n) * 0.7);
      sendProg(room, ws.pid, { type: 'tier', n });
      return;
    }
    case 'paint': {
      const st = room.structures.find(s => s.id === m.id);
      if (!st) return;
      st.col = +m.col | 0;
      bcast(room, { t: 'paint', id: st.id, col: st.col });
      return;
    }
    case 'mine': {
      if (!PLANETS.includes(m.pl)) return;
      const i = m.i | 0;
      const nd = NODES[m.pl][i];
      if (!nd) return;
      const key = m.pl + ':' + i;
      if (room.nodeDead.has(key)) return;     // race loser
      if (me.mode !== 'surface' || me.pl !== m.pl) return;
      const now = Date.now();
      if (now - me.lastMine < 1100) return;   // mining a node takes 1.4s — flood guard
      const dx = me.pos[0] - nd.x, dz = me.pos[2] - nd.z;
      const reach = MINE_RANGE + 4;           // pos updates are 10Hz; small slack
      if (dx * dx + dz * dz > reach * reach) return;
      const rk = PDATA[m.pl].res;
      if ((me.res[rk] | 0) >= carryCap(room.structures)) { sendTo(ws, { t: 'err', msg: 'Storage full — build more crates' }); return; }
      me.lastMine = now;
      room.nodeDead.set(key, now + RESPAWN_MS);
      const amt = grantRes(room, me, rk, 4 + Math.floor(Math.random() * 3));
      bcast(room, { t: 'nodeDead', pl: m.pl, i, by: ws.pid });
      sendProg(room, ws.pid, { type: 'gain', k: rk, amt });
      return;
    }
    /* ---- combat (fully server-authoritative: ammo, cooldown, range, zones, damage) ---- */
    case 'fire': {
      const wp = m.wp | 0;
      const chk = fireCheck(me.weapons, me.ammo, wp);
      if (chk.err) return;                               // unowned weapon / no ammo: drop silently
      const w = chk.w, now = Date.now();
      if (wp === 5) {                                    // inferno sprays multiple frames/targets
        if (now - (me.lastFuel || 0) >= 110) { me.lastFuel = now; me.ammo.fuel = Math.max(0, me.ammo.fuel - 1); }
      } else {
        if (now - (me.fireAt[wp] || 0) < (w.cd || 0.1) * 800) return;   // cooldown, 20% lag slack
        me.fireAt[wp] = now;
        if (chk.ammoKey) me.ammo[chk.ammoKey] = Math.max(0, me.ammo[chk.ammoKey] - chk.use);
      }
      bcast(room, { t: 'fire', by: ws.pid, wp, o: m.o, p: m.p }, ws.pid);
      /* claimed hit: validate everything the client can lie about, then apply */
      if (m.target !== undefined && m.target !== null && w.dmg) {
        const victim = room.players.get(m.target);
        if (!victim || victim === me) return;
        if (me.mode !== 'surface' || victim.mode !== 'surface' || victim.pl !== me.pl) return;
        if (inSafeZone(room.structures, me.pl, me.pos[0], me.pos[2])) return;   // no shooting FROM safety
        if (wp === 5) {                                  // inferno: per-victim damage window
          me.infHit = me.infHit || {};
          if (now - (me.infHit[m.target] || 0) < 100) return;
          me.infHit[m.target] = now;
        }
        const dx = victim.pos[0] - me.pos[0], dy = victim.pos[1] - me.pos[1], dz = victim.pos[2] - me.pos[2];
        const range = (w.range || 4) + 8;                // pos updates are 10Hz; small slack
        if (dx * dx + dy * dy + dz * dz > range * range) return;
        if (!w.melee && !w.cone) {
          const hit = shotBlocked(activeWalls(room, me.pl),
            [me.pos[0], me.pos[1] + 1.6, me.pos[2]], [victim.pos[0], victim.pos[1] + 1, victim.pos[2]]);
          if (hit) return;                               // a deployable shield wall absorbed it
        }
        damagePlayer(room, m.target, w.dmg, ws.pid);
      }
      return;
    }
    case 'nade': {
      if (!me.weapons.grenade || (me.ammo.nade | 0) <= 0) return;
      if (me.mode !== 'surface') return;
      if (inSafeZone(room.structures, me.pl, me.pos[0], me.pos[2])) return;
      const now = Date.now();
      if (now - (me.lastNade || 0) < 500) return;
      me.lastNade = now;
      me.ammo.nade--;
      if (!Array.isArray(m.o) || !Array.isArray(m.v)) return;
      bcast(room, { t: 'nade', by: ws.pid, o: m.o, v: m.v }, ws.pid);
      /* server resolves the blast on its own sim of the throw */
      const pl = me.pl, byPid = ws.pid, code = room.code;
      const o = m.o.map(Number), v = m.v.map(Number);
      if (o.some(n => !isFinite(n)) || v.some(n => !isFinite(n)) || Math.hypot(v[0], v[1], v[2]) > 40) return;
      setTimeout(() => {
        if (!rooms.has(code)) return;
        const at = simThrowable(room, pl, o, v, 'grenade');
        for (const [pid, p] of room.players) {
          if (p.mode !== 'surface' || p.pl !== pl) continue;
          const dx = p.pos[0] - at.x, dy = (p.pos[1] + 1) - at.y, dz = p.pos[2] - at.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < GREN_R) {
            const dmg = Math.round(GREN_DMG * (1 - d / GREN_R));
            if (dmg > 0) damagePlayer(room, pid, dmg, byPid);
          }
        }
        for (const c of (room.crit[pl] || []).slice()) {
          const cd = Math.hypot(c.x - at.x, c.z - at.z);
          if (cd < GREN_R) damageCritter(room, pl, c, Math.round(GREN_DMG * (1 - cd / GREN_R)), byPid, at.x, at.z);
        }
      }, GREN_FUSE * 1000);
      return;
    }
    case 'useMed': {
      if (me.medkits <= 0) return;
      me.medkits--;
      me.hp = Math.min(HP_MAX, me.hp + 50);
      sendProg(room, ws.pid, { type: 'med' });
      return;
    }
    case 'setSpawn': {
      /* cryopod respawn point: persisted per player per world. Respawn
         POSITIONING stays client-side (trust model); the server only
         verifies a live cryopod actually stands there and stores it. */
      const x = +m.x, y = +m.y, z = +m.z;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
      if (me.mode !== 'surface') return;
      const pod = room.structures.find(s => s.t === 'cryopod' && s.pl === me.pl && s.hp > 0
        && Math.abs(s.x - x) < 4 && Math.abs(s.z - z) < 4);
      if (!pod) return;
      me.spawn = { pl: me.pl, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) };
      saveProgressOf(room, me);
      return;
    }
    case 'stationPlace': {
      const s = m.st;
      if (!s || !STATION_TYPES.has(s.t)) return;
      const x = +s.x, y = +s.y, z = +s.z;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
      if (me.tier < 5) { sendTo(ws, { t: 'err', msg: 'Requires Tier 5' }); return; }
      if (room.station.length >= STATION_MAX) { sendTo(ws, { t: 'err', msg: 'Station piece limit reached (' + STATION_MAX + ')' }); return; }
      const def = STATION[s.t];
      if (!canAfford(me.res, def.cost)) { sendTo(ws, { t: 'err', msg: 'Not enough resources' }); return; }
      if (!stationPlaceValid(room.station, x, y, z)) { sendTo(ws, { t: 'err', msg: 'No open socket there' }); return; }
      payCost(me.res, def.cost);
      const pc = { id: room.nextStation++, t: s.t, x, y, z, qx: +s.qx || 0, qy: +s.qy || 0, qz: +s.qz || 0, qw: isFinite(+s.qw) ? +s.qw : 1, r: (s.r | 0) % 4 };
      room.station.push(pc);
      if (!room.stationOnline && stationComplete(room.station)) room.stationOnline = true;
      bcast(room, { t: 'stationPlaced', by: ws.pid, st: pc });
      sendProg(room, ws.pid);
      return;
    }
    case 'stationRemove': {
      const i = room.station.findIndex(p => p.id === m.id);
      if (i < 0) return;
      const pc = room.station[i]; room.station.splice(i, 1);
      for (const k in STATION[pc.t].cost) grantRes(room, me, k, Math.floor(STATION[pc.t].cost[k] / 2));
      bcast(room, { t: 'stationRemoved', id: pc.id, by: ws.pid });
      sendProg(room, ws.pid);
      return;
    }
    case 'shield': {
      if (!me.weapons.shield || me.mode !== 'surface') return;
      const now = Date.now();
      if (now - (me.lastShield || 0) < (SHIELD_CD - 2) * 1000) return;
      if (!Array.isArray(m.o) || !Array.isArray(m.v)) return;
      const o = m.o.map(Number), v = m.v.map(Number);
      if (o.some(n => !isFinite(n)) || v.some(n => !isFinite(n)) || Math.hypot(v[0], v[1], v[2]) > 30) return;
      me.lastShield = now;
      bcast(room, { t: 'shield', by: ws.pid, o: m.o, v: m.v }, ws.pid);
      /* register the wall server-side so it blocks validated shots */
      const at = simThrowable(room, me.pl, o, v, 'shield');
      room.walls.push({ pl: me.pl, x: at.x, y: at.y, z: at.z, yaw: Math.atan2(v[0], v[2]),
        hw: 2.5, h: 3.2, expireAt: now + (at.t + SHIELD_LIFE) * 1000 });
      return;
    }
    case 'critHit': {
      /* damage computed server-side from the claimed weapon — never trusted */
      if (me.mode !== 'surface') return;
      const arr = room.crit[me.pl]; if (!arr) return;
      const c = arr.find(k => k.id === m.id); if (!c) return;
      const wp = m.wp | 0;
      let dmg = 0, range = 0;
      if (wp === 6) {                                   // grenade AoE (thrown up to ~30m)
        if (!me.weapons.grenade) return;
        dmg = GREN_DMG; range = 46;
      } else {
        const chk = fireCheck(me.weapons, { light: 1e9, heavy: 1e9, fuel: 1e9, nade: 1e9 }, wp);  // ammo is charged on 'fire'
        if (chk.err || !chk.w.dmg) return;
        dmg = chk.w.dmg; range = (chk.w.range || 4) + 10;
      }
      const dx = c.x - me.pos[0], dz = c.z - me.pos[2];
      if (dx * dx + dz * dz > range * range) return;
      damageCritter(room, me.pl, c, dmg, ws.pid, me.pos[0], me.pos[2]);
      return;
    }
    /* 'died' intent removed in P2.3 — the server decides deaths in damagePlayer() */
    case 'lootClaim': {
      const c = room.loot.get(m.id);
      if (!c) return;
      if (me.mode !== 'surface' || me.pl !== c.pl) return;
      const dx = me.pos[0] - c.pos[0], dz = me.pos[2] - c.pos[2];
      if (dx * dx + dz * dz > 144) return;               // must actually be near the cache
      room.loot.delete(m.id);
      for (const k of ['fe', 'cy', 'bio']) grantRes(room, me, k, c.loot[k] | 0);
      sendTo(ws, { t: 'lootGot', id: m.id, loot: c.loot });
      bcast(room, { t: 'lootGone', id: m.id });
      sendProg(room, ws.pid);
      return;
    }
    case 'chat': {
      let text = String(m.text || '').replace(/[<>]/g, '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
      if (!text) return;
      bcast(room, { t: 'chat', name: me.name, text });
      return;
    }
    case 'roverSeat': {
      const cur = room.seats.get(m.id);
      if (cur && cur !== ws.pid) { sendTo(ws, { t: 'err', msg: 'Rover is occupied' }); return; }
      room.seats.set(m.id, ws.pid);
      bcast(room, { t: 'roverSeat', id: m.id, pid: ws.pid });
      return;
    }
    case 'roverSeatClear': {
      if (room.seats.get(m.id) === ws.pid) { room.seats.delete(m.id); bcast(room, { t: 'roverSeat', id: m.id, pid: 0 }); }
      return;
    }
    case 'roverMove': {
      if (room.seats.get(m.id) !== ws.pid) return;
      const x = +m.x, y = +m.y, z = +m.z;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.hypot(x, z) > WORLD_R) return;
      const st = room.structures.find(s => s.id === m.id);
      if (st) { st.x = x; st.y = y; st.z = z; st.ry = +m.ry || 0; }
      bcast(room, { t: 'roverMove', id: m.id, x, y, z, ry: m.ry }, ws.pid);
      return;
    }
  }
}

/* ---------- meteor + respawn + GC tick ---------- */
function structCentroid(room, pl) {
  let n = 0, x = 0, z = 0;
  for (const st of room.structures) { if (st.pl === pl) { x += st.x; z += st.z; n++; } }
  if (n) return { x: x / n, z: z / n };
  for (const p of room.players.values()) {
    if (p.mode === 'surface' && p.pl === pl) return { x: p.pos[0], z: p.pos[2] };
  }
  return { x: 0, z: 0 };
}
function resolveImpact(room, pl, tx, tz) {
  const ms = room.meteor[pl];
  if (ms.hits >= HITS_PER_SHOWER) return;
  /* impact shielded? (live shield generator dome on that planet) */
  for (const g of room.structures) {
    if (g.pl !== pl || g.t !== 'shieldgen' || g.hp <= 0) continue;
    const dx = tx - g.x, dz = tz - g.z;
    if (dx * dx + dz * dz < SHIELD_R * SHIELD_R) return;
  }
  for (const st of room.structures.slice()) {
    if (st.pl !== pl || st.t === 'beacon') continue;
    const dx = st.x - tx, dz = st.z - tz;
    if (dx * dx + dz * dz > 49) continue;
    ms.hits++;
    st.hp -= METEOR_DMG;
    if (st.hp <= 0) {
      if (NOKILL.has(st.t)) { st.hp = 10; bcast(room, { t: 'hp', id: st.id, hp: st.hp }); }
      else {
        room.structures.splice(room.structures.indexOf(st), 1);
        bcast(room, { t: 'destroyed', id: st.id });
      }
    } else {
      bcast(room, { t: 'hp', id: st.id, hp: st.hp });
    }
    if (ms.hits >= HITS_PER_SHOWER) break;
  }
}
function beaconOnPlanetS(room, pl) {
  for (const s of room.structures) if (s.t === 'beacon' && s.pl === pl) return s;
  return null;
}
/* ---------- O2/fuel ledger (Phase 2.4) ----------
   Coarse server simulation from last known position + activity flags.
   sprint/jet flags only ever INCREASE drain, so lying about them is a
   sub-percent O2 saving, not a cheat; refill zones and submersion are
   verified server-side. Movement itself stays client-predicted (Phase 2
   accepts snap-correct-level trust there). */
function o2RangeSrv(room, p) {
  const dx = p.pos[0] - 8, dz = p.pos[2] - 2;          // landed ship: deterministic (8,·,2)
  if (dx * dx + dz * dz < 400) return true;
  for (const st of room.structures) {
    if (st.pl !== p.pl || st.hp <= 0) continue;
    const r = CAT[st.t].o2r; if (!r) continue;
    const ax = p.pos[0] - st.x, az = p.pos[2] - st.z;
    if (ax * ax + az * az < r * r) return true;
  }
  return false;
}
function simVitals(room, dt, now) {
  for (const p of room.players.values()) {
    const max = o2Max(p.tier);
    if (p.mode === 'space') {
      if (p.ev) {                                       // EVA at the orbital station
        const sp = p.shipPos;
        const near = sp && Math.hypot(p.pos[0] - sp[0], p.pos[1] - sp[1], p.pos[2] - sp[2]) < 14;
        p.o2 = near ? Math.min(max, p.o2 + EVA_O2_REFILL * dt) : Math.max(0, p.o2 - EVA_O2_DRAIN * dt);
      } else {                                          // aboard ship: slow refill
        p.shipPos = [p.pos[0], p.pos[1], p.pos[2]];
        p.o2 = Math.min(max, p.o2 + 12 * dt);
      }
    } else {
      const submerged = !!PDATA[p.pl].water && p.pos[1] < SEA_Y - 0.3;
      if (submerged) p.o2 = Math.max(0, p.o2 - O2_DRAIN_SUBMERGED * dt);
      else if (o2RangeSrv(room, p)) p.o2 = Math.min(max, p.o2 + O2_REFILL * dt);
      else p.o2 = Math.max(0, p.o2 - (p.sp ? O2_DRAIN_SPRINT : O2_DRAIN) * (p.jt ? O2_JET_MULT : 1) * dt);
      if (p.jt) p.fuel = Math.max(0, p.fuel - 32 * dt);
      else p.fuel = Math.min(100, p.fuel + 24 * dt);
    }
    if (p.o2 <= 0) { p.o2 = max; sendTo(p.ws, { t: 'blackout' }); }   // emergency recall
    if (now - (p.lastVitals || 0) > 2000) {
      p.lastVitals = now;
      sendTo(p.ws, { t: 'vitals', o2: Math.round(p.o2), fuel: Math.round(p.fuel) });
    }
  }
}

/* sentry turrets: server-side targeting + damage (clients only render tracers) */
function simTurrets(room, pl, dt) {
  const now = Date.now();
  for (const st of room.structures) {
    if (st.t !== 'turret' || st.pl !== pl || st.hp <= 0) continue;
    if (inSafeZone(room.structures, pl, st.x, st.z)) continue;
    let best = TURRET_R * TURRET_R, tgtPid = 0, tgt = null;
    for (const [pid, p] of room.players) {
      if (pid === st.owner || p.mode !== 'surface' || p.pl !== pl) continue;
      if (now < p.invulnUntil) continue;
      if (inSafeZone(room.structures, pl, p.pos[0], p.pos[2])) continue;
      const dx = p.pos[0] - st.x, dz = p.pos[2] - st.z, d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; tgt = p; tgtPid = pid; }
    }
    if (!tgt) { st._tf = 0.5; continue; }                 // matches the client's aim-settle delay
    st._tf = (st._tf === undefined ? 0.5 : st._tf) - dt;
    if (st._tf <= 0) {
      st._tf = TURRET_CD;
      bcast(room, { t: 'tfire', id: st.id, tp: tgtPid, p: [tgt.pos[0], tgt.pos[1] + 1, tgt.pos[2]] });
      damagePlayer(room, tgtPid, TURRET_DMG, st.owner || 0);
    }
  }
}
/* simulate one planet's critters; only runs while that surface is occupied */
function simCritters(room, pl, dt) {
  const arr = room.crit[pl];
  const ps = [];
  for (const p of room.players.values()) if (p.mode === 'surface' && p.pl === pl) ps.push(p);
  const beacon = beaconOnPlanetS(room, pl);
  /* respawn up to cap */
  room.critT[pl] -= dt;
  if (arr.length < CRIT_CAP && room.critT[pl] <= 0) {
    room.critT[pl] = 4 + Math.random() * 6;
    const types = CRIT_BY_PLANET[pl];
    const type = types[Math.floor(Math.random() * types.length)];
    for (let tries = 0; tries < 10; tries++) {
      const ang = Math.random() * Math.PI * 2, rad = 50 + Math.random() * 260;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (beacon) { const dx = x - beacon.x, dz = z - beacon.z; if (dx * dx + dz * dz < (SAFE_R + 4) * (SAFE_R + 4)) continue; }
      arr.push({ id: 'c' + (room.nextCrit++), type, x, z, hp: CRITTERS[type].hp, hd: Math.random() * 6.283, wt: 1 + Math.random() * 3, idle: 0, st: 0 });
      break;
    }
  }
  for (const c of arr) {
    const def = CRITTERS[c.type];
    let near = null, nd = 1e9;
    for (const p of ps) { const dx = c.x - p.pos[0], dz = c.z - p.pos[2], d = dx * dx + dz * dz; if (d < nd) { nd = d; near = p; } }
    let sp;
    if (near && nd < def.fleeR * def.fleeR) {
      c.hd = Math.atan2(c.z - near.pos[2], c.x - near.pos[0]); c.st = 1; c.idle = 0; sp = def.speed * 1.4;
    } else {
      c.st = 0; c.wt -= dt;
      if (c.wt <= 0) { c.wt = 1.5 + Math.random() * 3; if (Math.random() < 0.3) c.idle = 0.6 + Math.random() * 1.2; else c.hd += (Math.random() - 0.5) * 2; }
      if (c.idle > 0) { c.idle -= dt; sp = 0; } else sp = def.speed * 0.5;
    }
    c.x += Math.cos(c.hd) * sp * dt; c.z += Math.sin(c.hd) * sp * dt;
    const r = Math.hypot(c.x, c.z);
    if (r > 360) { c.x *= 360 / r; c.z *= 360 / r; c.hd += Math.PI; }
    if (beacon) { const dx = c.x - beacon.x, dz = c.z - beacon.z, d = Math.hypot(dx, dz); if (d < SAFE_R + 2) { const f = (SAFE_R + 2) / (d || 1); c.x = beacon.x + dx * f; c.z = beacon.z + dz * f; c.hd = Math.atan2(dz, dx); } }
  }
}

let lastTick = Date.now(), lastClockBcast = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(2, (now - lastTick) / 1000);
  lastTick = now;
  const bcastClock = now - lastClockBcast > 20000;
  if (bcastClock) lastClockBcast = now;
  for (const [code, room] of rooms) {
    /* unload idle worlds from memory (they stay in the store; join rehydrates) */
    if (room.players.size === 0) {
      if (room.emptySince && now - room.emptySince > ROOM_GC_MS) rooms.delete(code);
      continue;
    }
    /* per-world day/night clock advances only while the world is occupied */
    room.clock += dt;
    if (bcastClock) bcast(room, { t: 'clock', tod: todOf(room.clock) });
    /* node respawns */
    for (const [key, at] of room.nodeDead) {
      if (now >= at) {
        room.nodeDead.delete(key);
        const [pl, i] = key.split(':');
        bcast(room, { t: 'nodeAlive', pl, i: +i });
      }
    }
    /* loot despawn (5 min) */
    for (const [id, c] of room.loot) {
      if (now >= c.expireAt) { room.loot.delete(id); bcast(room, { t: 'lootGone', id }); }
    }
    /* O2/fuel ledger */
    simVitals(room, dt, now);
    /* meteors: per planet, clock advances only while someone is on that surface */
    for (const pl of PLANETS) {
      let occupied = false;
      for (const p of room.players.values()) { if (p.mode === 'surface' && p.pl === pl) { occupied = true; break; } }
      if (!occupied) continue;
      simCritters(room, pl, dt);
      simTurrets(room, pl, dt);
      const ms = room.meteor[pl];
      ms.t -= dt;
      if (ms.phase === 'idle') {
        if (ms.t <= 0) { ms.phase = 'warning'; ms.t = T_WARN; ms.hits = 0; bcast(room, { t: 'meteorWarn', pl, secs: T_WARN }); }
      } else if (ms.phase === 'warning') {
        if (ms.t <= 0) { ms.phase = 'active'; ms.t = T_ACTIVE; ms.spawnT = 0; bcast(room, { t: 'meteorActive', pl, secs: T_ACTIVE }); }
      } else if (ms.phase === 'active') {
        ms.spawnT -= dt;
        if (ms.spawnT <= 0) {
          ms.spawnT = 0.55 + Math.random() * 0.6;
          const c = structCentroid(room, pl);
          const tx = c.x + (Math.random() - 0.5) * 90, tz = c.z + (Math.random() - 0.5) * 90;
          const ang = Math.random() * Math.PI * 2;
          const sx = tx + Math.cos(ang) * 56, sz = tz + Math.sin(ang) * 56;
          bcast(room, { t: 'meteor', pl, tx: +tx.toFixed(1), tz: +tz.toFixed(1), sx: +sx.toFixed(1), sz: +sz.toFixed(1) });
          setTimeout(() => { if (rooms.has(code)) resolveImpact(room, pl, tx, tz); }, 2200);
        }
        if (ms.t <= 0) { ms.phase = 'idle'; ms.t = T_IDLE_NEXT(); bcast(room, { t: 'meteorEnd', pl }); }
      }
    }
    /* coarse critter position snapshots (~every tick) for occupied planets */
    room.critBcast += dt;
    if (room.critBcast >= 0.2) {
      room.critBcast = 0;
      for (const pl of PLANETS) {
        if (!room.crit[pl].length) continue;
        let occ = false;
        for (const p of room.players.values()) { if (p.mode === 'surface' && p.pl === pl) { occ = true; break; } }
        if (!occ) continue;
        bcast(room, { t: 'critSnap', pl, crit: room.crit[pl].map(c => ({ id: c.id, ty: c.type, x: +c.x.toFixed(1), z: +c.z.toFixed(1), st: c.st })) });
      }
    }
  }
}, 250);

/* heartbeat */
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch (e) {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 15000);

/* ---------- autosave (Phase 3): occupied worlds + their players ---------- */
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    saveWorld(room);
    for (const p of room.players.values()) saveProgressOf(room, p);
  }
}, AUTOSAVE_MS);

/* flush everything on shutdown so a deploy/restart never eats progress */
let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Astravox: ' + sig + ' — saving all worlds');
  try {
    const jobs = [];
    for (const room of rooms.values()) {
      jobs.push(store.saveWorldState(room.worldId, serializeRoom(room)).catch(() => {}));
      for (const p of room.players.values()) {
        if (!p.gone && p.guestId) jobs.push(store.saveProgress(p.guestId, room.worldId, progRow(p)).catch(() => {}));
      }
    }
    await Promise.all(jobs);
    await store.flush();
    await store.close();
  } catch (e) {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => console.log('Astravox server on :' + PORT + (METEOR_FAST ? ' (METEOR_FAST)' : '')));
