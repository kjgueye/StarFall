/* ============================================================
   STARFALL co-op server — rooms, world authority, relay
   Serves index.html over HTTP and the game protocol over WS.

   PROTOCOL (JSON frames, server is authoritative for shared-world objects):
   client->server: host, join, pu{pos,yaw,pitch,mode,pl,wp,iv,dr,sw},
     place{st}, remove{id}, repair{id}, mine{pl,i},
     fire{wp,o,p,target?,dmg?}, critHit{id,dmg}, nade{o,v}, shield{o,v}, died{by,pos,loot}, lootClaim{id},
     chat{text}, roverSeat{id}, roverSeatClear{id}, roverMove{id,x,y,z,ry}
   server->client: welcome{...,world{structures,beacon,deadNodes,meteor,loot,seats}},
     err, pjoin, pleave, pu, placed, removed, hp, destroyed,
     nodeDead, nodeAlive, meteorWarn/Active/meteor/meteorEnd,
     fire, nade, shield, critSnap{pl,crit[]}, critDead{id,x,z,by,ch},
     lootSpawn, lootGone, lootGot, sys, chat, roverSeat, roverMove
   Damage is client-authoritative (victim applies); loot containers,
   turret ownership and rover seats are server-authoritative.
   ============================================================ */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const METEOR_FAST = !!process.env.METEOR_FAST;     // test knob: rapid showers
const RESPAWN_MS = +process.env.RESPAWN_MS || 180000;
const MAX_ROOMS = 200;
const MAX_PLAYERS = 4;
const MAX_STRUCT = 400;
const ROOM_GC_MS = 10 * 60 * 1000;

/* mini structure catalog — hp + protection rules (mirrors CAT in index.html) */
const SCAT = {
  floor: 100, wall: 100, ramp: 100, lightpole: 60, crate: 120, relay: 80,
  shieldgen: 150, armory: 120, window: 80, door: 100, dome: 90, beacon: 500,
  turret: 110, rover: 160,
  foundation: 140, pillar: 90, pillar2: 90, pillar3: 90, halfwall: 60, halffloor: 70,
  roof45: 90, roofcorner: 90, beam: 60,
  flag: 40, planter: 40, holosign: 40, lampR: 30, lampG: 30, lampB: 30,
  table: 50, antenna: 40,
  bed: 50, chair: 30, console: 50, shelf: 30, rug: 20, ceilinglight: 30, locker: 50, railing: 30,
};
const OWNED = new Set(['turret']);   // structures that record their placer
const DYNAMIC = new Set(['rover']);  // movable structures (skipped by meteor centroid jitter is fine)
const NOKILL = new Set(['crate', 'beacon']);
const SHIELD_R = 18;
const METEOR_DMG = 35;
const HITS_PER_SHOWER = 6;
const PLANETS = ['rust', 'glacius', 'verdant', 'pelagos'];
const SAFE_CR = 32;               // PvP-free / critter-free radius around a Colony Beacon
/* ---- critters (Phase 4): server owns spawns + positions, coarse sync ---- */
const SCRIT = {
  skitterer: { hp: 8, speed: 5.0, flee: 9, ch: [1, 2] },
  grazer: { hp: 14, speed: 2.6, flee: 11, ch: [2, 4] },
  floater: { hp: 6, speed: 3.2, flee: 10, ch: [1, 2] },
  hopper: { hp: 10, speed: 4.2, flee: 9, ch: [1, 3] },
  skimmer: { hp: 7, speed: 5.5, flee: 10, ch: [1, 2] },
};
const PLANET_CRIT = {
  rust: ['skitterer', 'grazer', 'hopper'],
  glacius: ['skitterer', 'floater'],
  verdant: ['grazer', 'floater', 'hopper'],
  pelagos: ['skimmer', 'floater'],
};
const CRIT_CAP = 12;
const DAY_CYCLE = 600;            // seconds for a full day/night cycle
let worldClock = 300;             // shared time-of-day (seconds)
function worldTod() { return ((worldClock % DAY_CYCLE) + DAY_CYCLE) % DAY_CYCLE / DAY_CYCLE; }

/* meteor phase timings (seconds) */
const T_IDLE = () => METEOR_FAST ? 3 : 120 + Math.random() * 120;
const T_IDLE_NEXT = () => METEOR_FAST ? 4 : 170 + Math.random() * 140;
const T_WARN = METEOR_FAST ? 2 : 20;
const T_ACTIVE = METEOR_FAST ? 5 : 12;

/* ---------- HTTP: serve the game ---------- */
const INDEX_PATH = path.join(__dirname, 'index.html');
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX_PATH, (err, data) => {
      if (err) { res.writeHead(500); res.end('error'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
});

/* ---------- rooms ---------- */
const rooms = new Map();
const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_ALPHA[crypto.randomInt(CODE_ALPHA.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
function newMeteorState() {
  const m = {};
  for (const pl of PLANETS) m[pl] = { phase: 'idle', t: T_IDLE(), hits: 0, spawnT: 0 };
  return m;
}
function makeRoom(world) {
  const code = genCode();
  if (!code) return null;
  const room = {
    code,
    worldId: (world && typeof world.worldId === 'string' && world.worldId.length <= 24)
      ? world.worldId : 'w' + crypto.randomBytes(6).toString('hex'),
    nextId: 1, nextPid: 1, nextLoot: 1,
    structures: [], beacon: false,
    players: new Map(),                 // pid -> {ws,name,slot,pos,yaw,pitch,mode,pl}
    nodeDead: new Map(),                // "pl:i" -> respawnAt(ms epoch)
    loot: new Map(),                    // lootId -> {id,pl,pos,loot,expireAt}
    seats: new Map(),                   // roverId -> pid (current driver)
    meteor: newMeteorState(),
    crit: {}, critT: {}, nextCrit: 1, critBcast: 0,   // critters per planet
    emptySince: 0,
  };
  for (const pl of PLANETS) { room.crit[pl] = []; room.critT[pl] = 2 + Math.random() * 4; }
  if (world && Array.isArray(world.structures)) {
    for (const s of world.structures) {
      if (room.structures.length >= MAX_STRUCT) break;
      if (!s || !SCAT[s.t] || !PLANETS.includes(s.pl)) continue;
      const x = +s.x, y = +s.y, z = +s.z;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      const hp = Math.min(Math.max(1, (+s.hp || SCAT[s.t])), SCAT[s.t]);
      const st = { id: room.nextId++, t: s.t, pl: s.pl, x, y, z, r: ((s.r | 0) % 4 + 4) % 4, hp };
      if (s.owner !== undefined && s.owner !== null) st.owner = s.owner;
      if (isFinite(+s.ry)) st.ry = +s.ry;
      if (isFinite(+s.col)) st.col = +s.col | 0;
      room.structures.push(st);
      if (s.t === 'beacon') room.beacon = true;
    }
  }
  rooms.set(code, room);
  return room;
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
  return {
    t: 'welcome', pid, code: room.code, worldId: room.worldId,
    players: [...room.players.entries()].map(([id, p]) => ({ pid: id, name: p.name, slot: p.slot })),
    world: {
      structures: room.structures,
      beacon: room.beacon,
      deadNodes: deadNodesByPlanet(room),
      meteor: meteorSnapshot(room),
      loot: [...room.loot.values()].map(c => ({ id: c.id, pl: c.pl, pos: c.pos, loot: c.loot })),
      seats: [...room.seats.entries()],
      tod: worldTod(),
    },
  };
}

/* ---------- websocket ---------- */
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.room = null; ws.pid = null;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(ws, m); } catch (e) { /* never crash on a bad message */ }
  });
  ws.on('close', () => {
    const room = ws.room;
    if (!room || ws.pid === null) return;
    const p = room.players.get(ws.pid);
    if (p && p.ws === ws) {
      room.players.delete(ws.pid);
      for (const [rid, dpid] of room.seats) if (dpid === ws.pid) { room.seats.delete(rid); bcast(room, { t: 'roverSeat', id: rid, pid: 0 }); }
      bcast(room, { t: 'pleave', pid: ws.pid });
      if (room.players.size === 0) room.emptySince = Date.now();
    }
  });
});

function joinRoom(ws, room, name) {
  if (room.players.size >= MAX_PLAYERS) { sendTo(ws, { t: 'err', msg: 'Room is full (4 players max)', fatal: true }); return; }
  name = String(name || '').trim().slice(0, 16) || 'PLAYER';
  for (const p of room.players.values()) {
    if (p.name.toLowerCase() === name.toLowerCase()) { sendTo(ws, { t: 'err', msg: 'That name is taken in this room', fatal: true }); return; }
  }
  const used = new Set([...room.players.values()].map(p => p.slot));
  let slot = 0; while (used.has(slot)) slot++;
  const pid = room.nextPid++;
  const player = { ws, name, slot, pos: [0, 0, 0], yaw: 0, pitch: 0, mode: 'space', pl: 'rust' };
  room.players.set(pid, player);
  room.emptySince = 0;
  ws.room = room; ws.pid = pid;
  sendTo(ws, welcomeMsg(room, pid));
  bcast(room, { t: 'pjoin', pid, name, slot }, pid);
}

function handle(ws, m) {
  switch (m.t) {
    case 'host': {
      if (ws.room) return;
      if (rooms.size >= MAX_ROOMS) { sendTo(ws, { t: 'err', msg: 'Server is at capacity, try later', fatal: true }); return; }
      const room = makeRoom(m.world);
      if (!room) { sendTo(ws, { t: 'err', msg: 'Could not create room', fatal: true }); return; }
      joinRoom(ws, room, m.name);
      if (room.players.size === 0) rooms.delete(room.code); // join failed somehow
      return;
    }
    case 'join': {
      if (ws.room) return;
      const code = String(m.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) { sendTo(ws, { t: 'err', msg: 'No room with that code', fatal: true }); return; }
      joinRoom(ws, room, m.name);
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
      me.pos = m.pos.map(Number); me.yaw = +m.yaw || 0; me.pitch = +m.pitch || 0;
      me.mode = m.mode === 'surface' ? 'surface' : 'space';
      me.pl = PLANETS.includes(m.pl) ? m.pl : me.pl;
      bcast(room, { t: 'pu', pid: ws.pid, pos: me.pos, yaw: me.yaw, pitch: me.pitch, mode: me.mode, pl: me.pl,
        wp: m.wp | 0, iv: m.iv ? 1 : 0, dr: m.dr | 0, sw: m.sw ? 1 : 0 }, ws.pid);
      return;
    }
    case 'place': {
      const s = m.st;
      if (!s || !SCAT[s.t] || !PLANETS.includes(s.pl)) return;
      const x = +s.x, y = +s.y, z = +s.z;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
      if (room.structures.length >= MAX_STRUCT) { sendTo(ws, { t: 'err', msg: 'Construction limit reached (' + MAX_STRUCT + ' pieces)' }); return; }
      if (s.t === 'beacon' && room.beacon) { sendTo(ws, { t: 'err', msg: 'The Beacon is already placed' }); return; }
      if (s.t === 'turret') {
        let mine = 0; for (const o of room.structures) if (o.t === 'turret' && o.owner === ws.pid) mine++;
        if (mine >= 8) { sendTo(ws, { t: 'err', msg: 'Turret limit reached (8 per player)' }); return; }
      }
      const st = { id: room.nextId++, t: s.t, pl: s.pl, x, y, z, r: ((s.r | 0) % 4 + 4) % 4, hp: SCAT[s.t] };
      if (OWNED.has(s.t)) st.owner = ws.pid;
      if (DYNAMIC.has(s.t)) st.ry = isFinite(+s.ry) ? +s.ry : 0;
      if (isFinite(+s.col)) st.col = +s.col | 0;
      room.structures.push(st);
      if (st.t === 'beacon') room.beacon = true;
      bcast(room, { t: 'placed', by: ws.pid, st });
      return;
    }
    case 'remove': {
      const st = room.structures.find(s => s.id === m.id);
      if (!st) return;
      if (st.t === 'beacon') { sendTo(ws, { t: 'err', msg: 'The Beacon cannot be removed' }); return; }
      room.structures.splice(room.structures.indexOf(st), 1);
      bcast(room, { t: 'removed', id: st.id, by: ws.pid });
      return;
    }
    case 'repair': {
      const st = room.structures.find(s => s.id === m.id);
      if (!st) return;
      st.hp = SCAT[st.t];
      bcast(room, { t: 'hp', id: st.id, hp: st.hp });
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
      if (i < 0 || i > 45) return;
      const key = m.pl + ':' + i;
      if (room.nodeDead.has(key)) return;     // race loser
      room.nodeDead.set(key, Date.now() + RESPAWN_MS);
      bcast(room, { t: 'nodeDead', pl: m.pl, i, by: ws.pid });
      return;
    }
    /* ---- combat (client-authoritative damage; server relays) ---- */
    case 'fire': {
      bcast(room, { t: 'fire', by: ws.pid, wp: m.wp, o: m.o, p: m.p, target: m.target, dmg: m.dmg }, ws.pid);
      return;
    }
    case 'nade': {
      bcast(room, { t: 'nade', by: ws.pid, o: m.o, v: m.v }, ws.pid);
      return;
    }
    case 'shield': {
      bcast(room, { t: 'shield', by: ws.pid, o: m.o, v: m.v }, ws.pid);
      return;
    }
    case 'critHit': {
      const arr = room.crit[me.pl]; if (!arr) return;
      const c = arr.find(k => k.id === m.id); if (!c) return;
      c.hp -= Math.max(0, Math.min(200, +m.dmg || 0));
      c.st = 1; c.idle = 0; c.hd = Math.atan2(c.z - me.pos[2], c.x - me.pos[0]);   // flee the shooter
      if (c.hp <= 0) {
        arr.splice(arr.indexOf(c), 1);
        const r = SCRIT[c.type].ch;
        const ch = r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
        bcast(room, { t: 'critDead', id: c.id, x: +c.x.toFixed(1), z: +c.z.toFixed(1), by: ws.pid, ch });
      }
      return;
    }
    case 'died': {
      const loot = m.loot || {};
      const drop = { fe: Math.max(0, loot.fe | 0), cy: Math.max(0, loot.cy | 0), bio: Math.max(0, loot.bio | 0) };
      if (Array.isArray(m.pos) && (drop.fe || drop.cy || drop.bio)) {
        const id = 'L' + (room.nextLoot++);
        const cont = { id, pl: me.pl, pos: m.pos.map(Number), loot: drop, expireAt: Date.now() + 300000 };
        room.loot.set(id, cont);
        bcast(room, { t: 'lootSpawn', id, pl: cont.pl, pos: cont.pos, loot: drop });
      }
      const killer = room.players.get(m.by);
      bcast(room, { t: 'sys', text: (killer ? killer.name : 'Someone') + ' eliminated ' + me.name });
      return;
    }
    case 'lootClaim': {
      const c = room.loot.get(m.id);
      if (!c) return;
      room.loot.delete(m.id);
      sendTo(ws, { t: 'lootGot', id: m.id, loot: c.loot });
      bcast(room, { t: 'lootGone', id: m.id });
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
      const st = room.structures.find(s => s.id === m.id);
      if (st) { st.x = +m.x; st.y = +m.y; st.z = +m.z; st.ry = +m.ry || 0; }
      bcast(room, { t: 'roverMove', id: m.id, x: m.x, y: m.y, z: m.z, ry: m.ry }, ws.pid);
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
    const types = PLANET_CRIT[pl];
    const type = types[Math.floor(Math.random() * types.length)];
    for (let tries = 0; tries < 10; tries++) {
      const ang = Math.random() * Math.PI * 2, rad = 50 + Math.random() * 260;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (beacon) { const dx = x - beacon.x, dz = z - beacon.z; if (dx * dx + dz * dz < (SAFE_CR + 4) * (SAFE_CR + 4)) continue; }
      arr.push({ id: 'c' + (room.nextCrit++), type, x, z, hp: SCRIT[type].hp, hd: Math.random() * 6.283, wt: 1 + Math.random() * 3, idle: 0, st: 0 });
      break;
    }
  }
  for (const c of arr) {
    const def = SCRIT[c.type];
    let near = null, nd = 1e9;
    for (const p of ps) { const dx = c.x - p.pos[0], dz = c.z - p.pos[2], d = dx * dx + dz * dz; if (d < nd) { nd = d; near = p; } }
    let sp;
    if (near && nd < def.flee * def.flee) {
      c.hd = Math.atan2(c.z - near.pos[2], c.x - near.pos[0]); c.st = 1; c.idle = 0; sp = def.speed * 1.4;
    } else {
      c.st = 0; c.wt -= dt;
      if (c.wt <= 0) { c.wt = 1.5 + Math.random() * 3; if (Math.random() < 0.3) c.idle = 0.6 + Math.random() * 1.2; else c.hd += (Math.random() - 0.5) * 2; }
      if (c.idle > 0) { c.idle -= dt; sp = 0; } else sp = def.speed * 0.5;
    }
    c.x += Math.cos(c.hd) * sp * dt; c.z += Math.sin(c.hd) * sp * dt;
    const r = Math.hypot(c.x, c.z);
    if (r > 360) { c.x *= 360 / r; c.z *= 360 / r; c.hd += Math.PI; }
    if (beacon) { const dx = c.x - beacon.x, dz = c.z - beacon.z, d = Math.hypot(dx, dz); if (d < SAFE_CR + 2) { const f = (SAFE_CR + 2) / (d || 1); c.x = beacon.x + dx * f; c.z = beacon.z + dz * f; c.hd = Math.atan2(dz, dx); } }
  }
}

let lastTick = Date.now(), lastClockBcast = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(2, (now - lastTick) / 1000);
  lastTick = now;
  worldClock += dt;
  if (now - lastClockBcast > 20000) { lastClockBcast = now; const tod = worldTod(); for (const room of rooms.values()) bcast(room, { t: 'clock', tod }); }
  for (const [code, room] of rooms) {
    /* GC */
    if (room.players.size === 0) {
      if (room.emptySince && now - room.emptySince > ROOM_GC_MS) rooms.delete(code);
      continue;
    }
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
    /* meteors: per planet, clock advances only while someone is on that surface */
    for (const pl of PLANETS) {
      let occupied = false;
      for (const p of room.players.values()) { if (p.mode === 'surface' && p.pl === pl) { occupied = true; break; } }
      if (!occupied) continue;
      simCritters(room, pl, dt);
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

server.listen(PORT, () => console.log('Starfall server on :' + PORT + (METEOR_FAST ? ' (METEOR_FAST)' : '')));
