/* Throwaway Step-2 gate: shared/ modules must match server.js mirrors exactly. */
const C = await import('../shared/constants.js');
const K = await import('../shared/catalog.js');
const T = await import('../shared/tiers.js');
const W = await import('../shared/world.js');
const R = await import('../shared/rules.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } };

/* --- server.js mirror values, copied verbatim from server.js (the things step 3 deletes) --- */
const SCAT = {
  floor: 100, wall: 100, ramp: 100, lightpole: 60, crate: 120, relay: 80,
  shieldgen: 150, armory: 120, window: 80, door: 100, dome: 90, beacon: 500,
  turret: 110, rover: 160,
  foundation: 140, pillar: 90, pillar2: 90, pillar3: 90, halfwall: 60, halffloor: 70,
  roof45: 90, roofcorner: 90, flatroof: 100, beam: 60,
  flag: 40, planter: 40, holosign: 40, lampR: 30, lampG: 30, lampB: 30,
  table: 50, antenna: 40,
  bed: 50, chair: 30, console: 50, shelf: 30, rug: 20, ceilinglight: 30, locker: 50, railing: 30,
};
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
const STATION_TYPES = ['corridor', 'habitat', 'solar', 'dome', 'dock', 'comms'];
const SRV = { OWNED: ['turret'], DYNAMIC: ['rover'], NOKILL: ['crate', 'beacon'],
  SHIELD_R: 18, METEOR_DMG: 35, PLANETS: ['rust','glacius','verdant','pelagos'],
  SAFE_CR: 32, CRIT_CAP: 12, STATION_MAX: 60, STATION_MIN: 10, DAY_CYCLE: 600, MAX_STRUCT: 400 };

/* --- 1. SCAT ≡ CAT hp --- */
for (const t in SCAT) {
  ok(K.CAT[t], `SCAT type '${t}' missing from shared CAT`);
  if (K.CAT[t]) ok(K.CAT[t].hp === SCAT[t], `hp mismatch for '${t}': CAT=${K.CAT[t].hp} SCAT=${SCAT[t]}`);
}
for (const t in K.CAT) ok(SCAT[t] !== undefined, `CAT type '${t}' missing from server SCAT`);

/* --- 2. SCRIT ≡ CRITTERS --- */
for (const t in SCRIT) {
  const c = K.CRITTERS[t];
  ok(c, `critter '${t}' missing`);
  if (c) {
    ok(c.hp === SCRIT[t].hp, `critter '${t}' hp`);
    ok(c.speed === SCRIT[t].speed, `critter '${t}' speed`);
    ok(c.fleeR === SCRIT[t].flee, `critter '${t}' fleeR(${c.fleeR}) vs server flee(${SCRIT[t].flee})`);
    ok(c.ch[0] === SCRIT[t].ch[0] && c.ch[1] === SCRIT[t].ch[1], `critter '${t}' chitin range`);
  }
}
ok(Object.keys(K.CRITTERS).length === Object.keys(SCRIT).length, 'critter count');

/* --- 3. PLANET_CRIT ≡ CRIT_BY_PLANET --- */
ok(JSON.stringify(K.CRIT_BY_PLANET) === JSON.stringify(PLANET_CRIT), 'CRIT_BY_PLANET mismatch');

/* --- 4. station --- */
ok(JSON.stringify(K.STATION_KEYS) === JSON.stringify(STATION_TYPES), 'STATION_KEYS mismatch');
ok(JSON.stringify(Object.keys(K.STATION)) === JSON.stringify(STATION_TYPES), 'STATION object keys mismatch');
ok(C.STATION_MAX === SRV.STATION_MAX && C.STATION_MIN_PIECES === SRV.STATION_MIN, 'station limits');

/* --- 5. planets --- */
ok(JSON.stringify(W.PLANET_KEYS) === JSON.stringify(SRV.PLANETS), 'PLANET_KEYS mismatch');

/* --- 6. derived sets ≡ server hardcoded sets --- */
ok(JSON.stringify([...K.OWNED].sort()) === JSON.stringify(SRV.OWNED.sort()), 'OWNED mismatch: ' + [...K.OWNED]);
ok(JSON.stringify([...K.DYNAMIC].sort()) === JSON.stringify(SRV.DYNAMIC.sort()), 'DYNAMIC mismatch: ' + [...K.DYNAMIC]);
ok(JSON.stringify([...K.NOKILL].sort()) === JSON.stringify(SRV.NOKILL.sort()), 'NOKILL mismatch: ' + [...K.NOKILL]);

/* --- 7. constants --- */
ok(C.SAFE_R === SRV.SAFE_CR, 'SAFE_R');
ok(C.METEOR_DMG === SRV.METEOR_DMG, 'METEOR_DMG');
ok(C.CYCLE_S === SRV.DAY_CYCLE, 'CYCLE_S vs DAY_CYCLE');
ok(C.MAX_STRUCT === SRV.MAX_STRUCT, 'MAX_STRUCT');
ok(C.CRIT_CAP === SRV.CRIT_CAP, 'CRIT_CAP');
ok(K.CAT.shieldgen.shieldR === SRV.SHIELD_R, 'shieldgen.shieldR vs server SHIELD_R');

/* --- 8. terrain determinism sanity --- */
const h1 = W.terrainH(10, 20, W.PLANETS.rust), h2 = W.terrainH(10, 20, W.PLANETS.rust);
ok(h1 === h2 && isFinite(h1), 'terrainH deterministic');
const hw = W.terrainH(100, 50, W.PLANETS.pelagos);
ok(isFinite(hw), 'terrainHWater finite');
ok(W.terrainH(0, 0, W.PLANETS.pelagos) > 0, 'pelagos central spawn island above sea');

/* --- 9. rules behave --- */
ok(R.canAfford({fe:10,cy:5}, {fe:10}) === true && R.canAfford({fe:9}, {fe:10}) === false, 'canAfford');
const res = {fe:10,cy:5}; R.payCost(res, {fe:4}); ok(res.fe === 6, 'payCost');
ok(JSON.stringify(R.refundFor({fe:6,cy:2})) === '{"fe":3,"cy":1}', 'refundFor');
ok(R.o2Max(1) === 100 && R.o2Max(2) === 160 && R.o2Max(5) === 240, 'o2Max');
ok(R.carryCap([]) === 300 && R.carryCap([{t:'crate',hp:50},{t:'crate',hp:0}]) === 450, 'carryCap (dead crate excluded)');
ok(R.inSafeZone([{t:'beacon',pl:'rust',x:0,z:0}], 'rust', 10, 10) === true, 'inSafeZone inside');
ok(R.inSafeZone([{t:'beacon',pl:'rust',x:0,z:0}], 'rust', 40, 0) === false, 'inSafeZone outside');
ok(R.inSafeZone([{t:'beacon',pl:'rust',x:0,z:0}], 'glacius', 1, 1) === false, 'inSafeZone wrong planet');
const full = STATION_TYPES.map(t=>({t})).concat([{t:'corridor'},{t:'corridor'},{t:'corridor'},{t:'corridor'}]);
ok(R.stationComplete(full) === true && R.stationComplete(full.slice(0,9)) === false, 'stationComplete');
ok(Math.abs(R.todOf(300) - 0.5) < 1e-9 && R.todOf(0) === 0 && R.todOf(600) === 0, 'todOf');

/* --- 10. tiers/craft sanity --- */
ok(T.TIERS.length === 5 && T.TIERS[4].cost.ch === 40, 'TIERS');
ok(Object.keys(T.CRAFT).length === 14, 'CRAFT count is 14, got ' + Object.keys(T.CRAFT).length);
ok(T.WEAPONS.lance.ammoUse === 3 && T.WEAPONS.inferno.coneCos === 0.86, 'WEAPONS values');
ok(T.SLOT_KEYS.length === 8 && T.WEP_KEYS.length === 7 && T.AMMO_KEYS.length === 4, 'key arrays');

console.log(fails === 0 ? '\nALL CHECKS PASS (' + new Date().toISOString() + ')' : '\n' + fails + ' FAILURES');
process.exitCode = fails ? 1 : 0;
