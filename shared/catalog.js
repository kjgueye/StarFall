/* ============================================================
   ASTRAVOX shared catalog — every buildable/spawnable thing.
   Imported by BOTH the browser client and the Node server.
   Pure data: parts reference GEO/MAT by string key; positions
   are plain arrays (the client hydrates THREE objects itself).
   ============================================================ */

/* ---------- structure catalog ---------- */
/* part: {g:geoKey, m:matKey, o:[x,y,z], s:[sx,sy,sz], r:[rx,ry,rz]} */
export const RAMP_ANG = Math.atan2(3, 4);
export const CAT = {
  floor:  {name:'Floor', ic:'▦', tier:1, cost:{fe:4}, hp:100,
    parts:[{g:'box',m:'metal',o:[0,0.15,0],s:[4,0.3,4]},{g:'box',m:'trim',o:[0,0.31,0],s:[3.7,0.02,3.7]}]},
  wall:   {name:'Wall', ic:'▮', tier:1, cost:{fe:4}, hp:100,
    parts:[{g:'box',m:'metal',o:[0,1.5,0],s:[4,3,0.3]},{g:'box',m:'trim',o:[0,1.5,0.16],s:[3.6,2.6,0.02]}]},
  ramp:   {name:'Ramp', ic:'◢', tier:1, cost:{fe:5}, hp:100,
    parts:[{g:'box',m:'metal',o:[0,1.5,0],s:[4,0.3,5],r:[RAMP_ANG,0,0]}]},
  lightpole:{name:'Light Pole', ic:'¦', tier:1, cost:{fe:6}, hp:60,
    parts:[{g:'cyl',m:'dark',o:[0,1.5,0],s:[0.24,3,0.24]},{g:'sphere',m:'emisW',o:[0,3.15,0],s:[0.7,0.7,0.7]}], glow:{y:3.15,c:'#dff6ff',s:5}},
  crate:  {name:'Storage Crate', ic:'▣', tier:1, cost:{fe:10}, hp:120, capUp:150, noKill:true,
    parts:[{g:'box',m:'dark',o:[0,0.6,0],s:[1.6,1.2,1.6]},{g:'box',m:'emisO',o:[0,1.18,0],s:[1.2,0.06,1.2]}]},
  relay:  {name:'O₂ Relay', ic:'◍', tier:1, cost:{fe:12}, hp:80, o2r:26,
    parts:[{g:'cyl',m:'metal',o:[0,1.2,0],s:[0.36,2.4,0.36]},{g:'torus',m:'emisC',o:[0,2.55,0],s:[1.1,1.1,1.1],r:[Math.PI/2,0,0]},
           {g:'sphere',m:'emisC',o:[0,2.55,0],s:[0.34,0.34,0.34]}], glow:{y:2.55,c:'#8ff4ff',s:4}},
  shieldgen:{name:'Shield Gen', ic:'◖', tier:2, cost:{fe:30,cy:15}, hp:150, shieldR:18,
    parts:[{g:'cyl',m:'dark',o:[0,0.25,0],s:[2.8,0.5,2.8]},{g:'cyl',m:'metal',o:[0,0.8,0],s:[1.2,0.7,1.2]},
           {g:'sphere',m:'emisP',o:[0,1.5,0],s:[1.1,1.1,1.1]}], glow:{y:1.5,c:'#c08aff',s:6}},
  window: {name:'Window Wall', ic:'⊞', tier:2, cost:{fe:6,cy:2}, hp:80,
    parts:[{g:'box',m:'metal',o:[0,2.8,0],s:[4,0.4,0.3]},{g:'box',m:'metal',o:[0,0.3,0],s:[4,0.6,0.3]},
           {g:'box',m:'metal',o:[-1.8,1.55,0],s:[0.4,2.1,0.3]},{g:'box',m:'metal',o:[1.8,1.55,0],s:[0.4,2.1,0.3]},
           {g:'box',m:'glass',o:[0,1.55,0],s:[3.2,2.1,0.1]}]},
  door:   {name:'Door', ic:'◫', tier:2, cost:{fe:8,cy:3}, hp:100,
    doorParts:[3,4], doorSlide:[1.55,1.55], doorSpeed:6,   // panel+seam slide together
    parts:[{g:'box',m:'metal',o:[-1.45,1.5,0],s:[1.1,3,0.3]},{g:'box',m:'metal',o:[1.45,1.5,0],s:[1.1,3,0.3]},
           {g:'box',m:'metal',o:[0,2.8,0],s:[1.8,0.4,0.3]},{g:'box',m:'doorM',o:[0,1.3,0],s:[1.7,2.6,0.14]},
           {g:'box',m:'emisM',o:[0,1.3,0.08],s:[0.08,2.2,0.02]}]},
  airlock:{name:'Airlock Door', ic:'⎕', tier:2, cost:{fe:12,cy:5}, hp:120,
    doorParts:[3,4], doorSlide:[-0.82,0.82], doorSpeed:3.5,   // two half-panels part to the sides, heavier/slower
    parts:[{g:'box',m:'dark',o:[-1.45,1.5,0],s:[1.1,3,0.3]},{g:'box',m:'dark',o:[1.45,1.5,0],s:[1.1,3,0.3]},
           {g:'box',m:'dark',o:[0,2.8,0],s:[1.8,0.4,0.3]},
           {g:'box',m:'metal',o:[-0.45,1.3,0],s:[0.86,2.6,0.18]},{g:'box',m:'metal',o:[0.45,1.3,0],s:[0.86,2.6,0.18]},
           {g:'box',m:'emisO',o:[0,2.62,0.16],s:[1.5,0.12,0.04]}]},
  dome:   {name:'Dome Roof', ic:'◠', tier:2, cost:{fe:10,cy:4}, hp:90,
    parts:[{g:'dome',m:'metal',o:[0,0,0],s:[2.9,2.2,2.9]},{g:'sphere',m:'emisP',o:[0,2.25,0],s:[0.3,0.3,0.3]}]},
  /* ---- Phase 2 building pieces ---- */
  foundation:{name:'Foundation', ic:'▰', tier:1, cost:{fe:6}, hp:140,
    parts:[{g:'box',m:'dark',o:[0,0.5,0],s:[4,1,4]},{g:'box',m:'trim',o:[0,1.01,0],s:[3.8,0.04,3.8]}]},
  pillar:  {name:'Pillar (S)', ic:'╿', tier:1, cost:{fe:4}, hp:90,
    parts:[{g:'cyl',m:'metal',o:[0,1.5,0],s:[0.5,3,0.5]}]},
  pillar2: {name:'Pillar (M)', ic:'╿', tier:1, cost:{fe:6}, hp:90,
    parts:[{g:'cyl',m:'metal',o:[0,2.5,0],s:[0.5,5,0.5]}]},
  pillar3: {name:'Pillar (L)', ic:'╿', tier:1, cost:{fe:8}, hp:90,
    parts:[{g:'cyl',m:'metal',o:[0,3.5,0],s:[0.5,7,0.5]}]},
  halfwall:{name:'Half Wall', ic:'▬', tier:1, cost:{fe:2}, hp:60,
    parts:[{g:'box',m:'metal',o:[0,0.75,0],s:[4,1.5,0.3]},{g:'box',m:'trim',o:[0,0.75,0.16],s:[3.6,1.3,0.02]}]},
  halffloor:{name:'Half Floor', ic:'▱', tier:1, cost:{fe:2}, hp:70,
    parts:[{g:'box',m:'metal',o:[0,0.15,0],s:[4,0.3,2]},{g:'box',m:'trim',o:[0,0.31,0],s:[3.7,0.02,1.8]}]},
  roof45:  {name:'Angled Roof', ic:'◹', tier:2, cost:{fe:6,cy:1}, hp:90,
    parts:[{g:'box',m:'metal',o:[0,1.5,0],s:[4,0.25,5.66],r:[Math.PI/4,0,0]}]},
  roofcorner:{name:'Roof Corner', ic:'◸', tier:2, cost:{fe:6,cy:1}, hp:90,
    parts:[{g:'cone',m:'metal',o:[0,1.4,0],s:[3.2,2.8,3.2]}]},
  flatroof:{name:'Flat Roof', ic:'▤', tier:2, cost:{fe:6,cy:2}, hp:100,   // floor-footprint slab: caps walls, tiles flat, walkable second-story floor
    parts:[{g:'box',m:'metal',o:[0,0.15,0],s:[4,0.3,4]},{g:'box',m:'trim',o:[0,0.32,0],s:[3.6,0.04,3.6]}]},
  beam:    {name:'Beam', ic:'━', tier:1, cost:{fe:3}, hp:60,
    parts:[{g:'box',m:'metal',o:[0,0,0],s:[4,0.3,0.3]}]},
  armory:{name:'Armory', ic:'⚒', tier:2, cost:{fe:35,cy:15}, hp:120, interact:'armory',
    parts:[{g:'box',m:'dark',o:[0,0.5,0],s:[2.6,1.0,1.4]},{g:'box',m:'metal',o:[0,1.06,0],s:[2.75,0.12,1.55]},
           {g:'box',m:'dark',o:[0,1.55,-0.62],s:[2.5,1.1,0.14]},{g:'box',m:'holo',o:[0,1.62,-0.53],s:[1.8,0.8,0.03]},
           {g:'box',m:'emisO',o:[-0.95,1.14,0.4],s:[0.5,0.05,0.5]},{g:'box',m:'emisPk',o:[0.95,1.14,0.4],s:[0.5,0.05,0.5]}],
    glow:{y:1.6,c:'#ffb070',s:3}},
  rover:  {name:'Rover', ic:'⛟', tier:2, cost:{fe:60,cy:10}, hp:160, dynamic:true, parts:[], desc:'Drive — E to enter'},
  turret: {name:'Sentry Turret', ic:'⌖', tier:3, cost:{fe:40,cy:20}, hp:110, owned:true, headParts:[2,3,4],
    parts:[{g:'cyl',m:'dark',o:[0,0.3,0],s:[1.2,0.6,1.2]},{g:'cyl',m:'metal',o:[0,0.85,0],s:[0.5,0.7,0.5]},
           {g:'box',m:'dark',o:[0,1.35,0],s:[0.9,0.5,0.7]},{g:'cyl',m:'metal',o:[0,1.35,-0.55],s:[0.12,0.7,0.12],r:[Math.PI/2,0,0]},
           {g:'sphere',m:'emisR',o:[0,1.35,-0.22],s:[0.2,0.2,0.2]}], glow:{y:1.35,c:'#ff5a4a',s:2.6}},
  beacon: {name:'COLONY BEACON', ic:'✦', tier:4, cost:{fe:25,cy:15,bio:10}, hp:500, noKill:true, o2r:50,
    parts:[{g:'cyl',m:'dark',o:[0,0.3,0],s:[2.4,0.6,2.4]},{g:'cone',m:'metal',o:[0,2.8,0],s:[1.1,4.5,1.1]},
           {g:'sphere',m:'emisG',o:[0,5.3,0],s:[0.8,0.8,0.8]},{g:'cyl',m:'beam',o:[0,21,0],s:[0.5,32,0.5]}], glow:{y:5.3,c:'#aef9c8',s:8}},
  /* Conquest: planting this in faction territory (control node down) flips the planet to yours */
  claimpost:{name:'CLAIM BEACON', ic:'✪', tier:1, cost:{fe:25,cy:10}, hp:500, noKill:true, o2r:30,
    desc:'Plant in the contested zone once the faction control node is down',
    parts:[{g:'cyl',m:'dark',o:[0,0.3,0],s:[2.4,0.6,2.4]},{g:'cone',m:'metal',o:[0,2.6,0],s:[1.0,4.2,1.0]},
           {g:'sphere',m:'emisM',o:[0,5.0,0],s:[0.85,0.85,0.85]},
           {g:'torus',m:'emisT',o:[0,1.0,0],s:[2.2,2.2,2.2],r:[Math.PI/2,0,0]},
           {g:'cyl',m:'beam',o:[0,21,0],s:[0.5,32,0.5]}], glow:{y:5.0,c:'#ff7ad0',s:8}},
  /* ---- Outpost update: functional pieces ---- */
  telepad:{name:'Teleporter Pad', ic:'⊙', tier:2, cost:{fe:20,cy:10}, hp:90,
    desc:'Paint two pads the same colour to link — stand on one and press E',
    parts:[{g:'cyl',m:'dark',o:[0,0.15,0],s:[2.4,0.3,2.4]},
           {g:'torus',m:'emisPk',o:[0,0.36,0],s:[1.7,1.7,1.7],r:[Math.PI/2,0,0]},
           {g:'cyl',m:'emisPk',o:[0,0.33,0],s:[0.5,0.06,0.5]}], glow:{y:0.6,c:'#ff9ad0',s:3}},
  lift:   {name:'Lift Platform', ic:'⇕', tier:2, cost:{fe:25,cy:8}, hp:120,
    liftH:6, liftParts:[2,3], desc:'Step on to rise; step off to send it back down',
    parts:[{g:'cyl',m:'dark',o:[0,0.25,0],s:[1.0,0.5,1.0]},                              // base pedestal
           {g:'cyl',m:'metal',o:[0,3.3,0],s:[0.3,6.6,0.3]},                              // mast (static)
           {g:'cyl',m:'metal',o:[0,0.55,0],s:[2.6,0.18,2.6]},                            // platform disc (animated)
           {g:'torus',m:'emisT',o:[0,0.6,0],s:[1.25,1.25,1.25],r:[Math.PI/2,0,0]}],      // platform ring (animated)
    glow:{y:0.6,c:'#7affe0',s:2.5}},
  jumppad:{name:'Jump Pad', ic:'⏫', tier:1, cost:{fe:8}, hp:60,
    parts:[{g:'cyl',m:'dark',o:[0,0.15,0],s:[2.2,0.3,2.2]},
           {g:'cyl',m:'emisG',o:[0,0.33,0],s:[1.6,0.1,1.6]},
           {g:'cone',m:'emisG',o:[0,0.46,0],s:[0.5,0.18,0.5]}], glow:{y:0.46,c:'#5aff8a',s:2.5}},
  spotlight:{name:'Spotlight', ic:'◤', tier:1, cost:{fe:8,cy:2}, hp:60,
    parts:[{g:'cyl',m:'dark',o:[0,1.5,0],s:[0.2,3,0.2]},                                 // pole
           {g:'box',m:'metal',o:[0,3.0,0.25],s:[0.5,0.4,0.6],r:[0.6,0,0]},               // head, angled down
           {g:'sphere',m:'emisW',o:[0,2.92,0.5],s:[0.3,0.3,0.3]},                        // lens
           {g:'cone',m:'lightcone',o:[0,1.46,1.45],s:[2.4,3.5,2.4],r:[-0.58,0,0]}],      // faked light cone to the ground
    glow:{y:3,c:'#eaf6ff',s:4}},
  cryopod:{name:'Cryopod', ic:'⬓', tier:2, cost:{fe:18,cy:8,bio:4}, hp:100,
    desc:'Press E to set your respawn point',
    parts:[{g:'box',m:'dark',o:[0,0.35,0],s:[1.4,0.7,2.6]},
           {g:'box',m:'cloth',o:[0,0.74,0.2],s:[1.1,0.18,1.9]},
           {g:'dome',m:'glass',o:[0,0.8,0.2],s:[0.62,0.9,1.05]},
           {g:'box',m:'metal',o:[0,0.6,-1.15],s:[1.3,1.0,0.3]},
           {g:'box',m:'emisG',o:[0,0.95,-0.98],s:[0.8,0.25,0.04]}], glow:{y:1.0,c:'#8affb0',s:2.5}},
  silo:   {name:'Storage Silo', ic:'⛁', tier:2, cost:{fe:35,cy:10}, hp:240, capUp:400, noKill:true,
    parts:[{g:'cyl',m:'dark',o:[0,0.2,0],s:[2.9,0.4,2.9]},
           {g:'cyl',m:'metal',o:[0,2.1,0],s:[2.6,3.8,2.6]},
           {g:'dome',m:'metal',o:[0,4.0,0],s:[1.3,0.9,1.3]},
           {g:'box',m:'emisO',o:[0,2.1,1.32],s:[0.5,2.6,0.06]}]},
  navbeacon:{name:'Nav Beacon', ic:'✧', tier:1, cost:{fe:10,cy:2}, hp:70,
    parts:[{g:'cyl',m:'dark',o:[0,0.2,0],s:[1.0,0.4,1.0]},
           {g:'cyl',m:'metal',o:[0,4.0,0],s:[0.18,7.6,0.18]},
           {g:'sphere',m:'emisR',o:[0,8.0,0],s:[0.5,0.5,0.5]},
           {g:'cyl',m:'beam',o:[0,11.5,0],s:[0.16,7,0.16]}], glow:{y:8.0,c:'#ff7a5a',s:9}},
  /* decorations */
  flag:   {name:'Flag', ic:'⚑', tier:0, cost:{fe:3}, hp:40, decor:true,
    parts:[{g:'cyl',m:'dark',o:[0,1.25,0],s:[0.1,2.5,0.1]},{g:'box',m:'flagM',o:[0.65,2.1,0],s:[1.2,0.7,0.05]}]},
  planter:{name:'Planter', ic:'❀', tier:0, cost:{fe:4}, hp:40, decor:true,
    parts:[{g:'cyl',m:'pot',o:[0,0.3,0],s:[0.9,0.6,0.9]},{g:'cone',m:'plant',o:[0,1.05,0],s:[0.7,1,0.7]},
           {g:'sphere',m:'plant',o:[0.25,0.85,0.15],s:[0.4,0.4,0.4]}]},
  holosign:{name:'Holo-Sign', ic:'◭', tier:0, cost:{fe:5}, hp:40, decor:true,
    parts:[{g:'cyl',m:'dark',o:[0,0.9,0],s:[0.12,1.8,0.12]},{g:'box',m:'holo',o:[0,2.3,0],s:[1.8,1,0.04]}], glow:{y:2.3,c:'#c08aff',s:3}},
  lampR:  {name:'Red Lamp', ic:'●', tier:0, cost:{fe:3}, hp:30, decor:true,
    parts:[{g:'cyl',m:'dark',o:[0,0.55,0],s:[0.14,1.1,0.14]},{g:'sphere',m:'emisR',o:[0,1.25,0],s:[0.45,0.45,0.45]}], glow:{y:1.25,c:'#ff6a5a',s:3}},
  lampG:  {name:'Green Lamp', ic:'●', tier:0, cost:{fe:3}, hp:30, decor:true,
    parts:[{g:'cyl',m:'dark',o:[0,0.55,0],s:[0.14,1.1,0.14]},{g:'sphere',m:'emisG',o:[0,1.25,0],s:[0.45,0.45,0.45]}], glow:{y:1.25,c:'#5aff8a',s:3}},
  lampB:  {name:'Blue Lamp', ic:'●', tier:0, cost:{fe:3}, hp:30, decor:true,
    parts:[{g:'cyl',m:'dark',o:[0,0.55,0],s:[0.14,1.1,0.14]},{g:'sphere',m:'emisB',o:[0,1.25,0],s:[0.45,0.45,0.45]}], glow:{y:1.25,c:'#5a9aff',s:3}},
  table:  {name:'Table', ic:'⊓', tier:0, cost:{fe:4}, hp:50, decor:true,
    parts:[{g:'box',m:'trim',o:[0,0.95,0],s:[1.6,0.1,1,]},{g:'cyl',m:'dark',o:[0,0.45,0],s:[0.18,0.9,0.18]}]},
  antenna:{name:'Antenna', ic:'⫯', tier:0, cost:{fe:5}, hp:40, decor:true,
    parts:[{g:'cyl',m:'dark',o:[0,1.6,0],s:[0.09,3.2,0.09]},{g:'box',m:'metal',o:[0,2.4,0],s:[1.4,0.06,0.06]},
           {g:'box',m:'metal',o:[0,2.9,0],s:[0.9,0.06,0.06]},{g:'sphere',m:'emisR',o:[0,3.3,0],s:[0.16,0.16,0.16]}], glow:{y:3.3,c:'#ff5a4a',s:1.6}},
  /* ---- furniture / interior (Phase 6) ---- */
  bed:    {name:'Bed', ic:'▤', tier:0, cost:{fe:8}, hp:50, decor:true,
    parts:[{g:'box',m:'dark',o:[0,0.3,0],s:[1.4,0.4,2.6]},{g:'box',m:'cloth',o:[0,0.62,0.1],s:[1.3,0.25,2.2]},
           {g:'box',m:'trim',o:[0,0.7,-1.0],s:[1.2,0.3,0.4]}]},
  chair:  {name:'Chair', ic:'⑁', tier:0, cost:{fe:4}, hp:30, decor:true,
    parts:[{g:'box',m:'metal',o:[0,0.5,0],s:[0.7,0.1,0.7]},{g:'box',m:'cloth',o:[0,0.56,0],s:[0.6,0.08,0.6]},
           {g:'box',m:'metal',o:[0,0.9,-0.3],s:[0.7,0.8,0.1]},{g:'cyl',m:'dark',o:[0,0.25,0],s:[0.13,0.5,0.13]}]},
  console:{name:'Holo Console', ic:'▣', tier:0, cost:{fe:7}, hp:50, decor:true,
    parts:[{g:'box',m:'dark',o:[0,0.5,0],s:[1.6,1.0,0.7]},{g:'box',m:'metal',o:[0,1.05,0],s:[1.7,0.1,0.8]},
           {g:'box',m:'dark',o:[0,1.55,-0.26],s:[1.4,0.95,0.1]},{g:'box',m:'screen',o:[0,1.58,-0.19],s:[1.2,0.72,0.03]}],
    glow:{y:1.55,c:'#5fe0ff',s:2}},
  shelf:  {name:'Wall Shelf', ic:'☰', tier:0, cost:{fe:5}, hp:30, decor:true,
    parts:[{g:'box',m:'wood',o:[0,2.0,0],s:[1.8,0.08,0.5]},{g:'box',m:'wood',o:[0,1.5,0],s:[1.8,0.08,0.5]},
           {g:'box',m:'wood',o:[0,1.0,0],s:[1.8,0.08,0.5]},{g:'box',m:'dark',o:[-0.85,1.5,0],s:[0.08,1.2,0.5]},
           {g:'box',m:'dark',o:[0.85,1.5,0],s:[0.08,1.2,0.5]}]},
  rug:    {name:'Floor Rug', ic:'▭', tier:0, cost:{fe:3}, hp:20, decor:true,
    parts:[{g:'box',m:'rug',o:[0,0.32,0],s:[2.4,0.04,3.0]},{g:'box',m:'trim',o:[0,0.345,0],s:[2.0,0.02,2.6]}]},
  ceilinglight:{name:'Ceiling Light', ic:'☼', tier:0, cost:{fe:5}, hp:30, decor:true,
    parts:[{g:'cyl',m:'dark',o:[0,2.6,0],s:[0.06,1.0,0.06]},{g:'box',m:'metal',o:[0,2.12,0],s:[1.0,0.12,1.0]},
           {g:'box',m:'emisW',o:[0,2.03,0],s:[0.85,0.05,0.85]}], glow:{y:2.0,c:'#eaf6ff',s:4}},
  locker: {name:'Locker', ic:'▯', tier:0, cost:{fe:6}, hp:50, decor:true,
    parts:[{g:'box',m:'metal',o:[0,1.1,0],s:[0.9,2.2,0.6]},{g:'box',m:'dark',o:[0,1.1,0.31],s:[0.8,2.0,0.04]},
           {g:'box',m:'emisM',o:[0.25,1.45,0.34],s:[0.06,0.3,0.02]}]},
  railing:{name:'Railing', ic:'╫', tier:0, cost:{fe:4}, hp:30, decor:true,
    parts:[{g:'box',m:'metal',o:[0,1.0,0],s:[4,0.08,0.08]},{g:'box',m:'metal',o:[0,0.6,0],s:[4,0.08,0.08]},
           {g:'cyl',m:'dark',o:[-1.85,0.6,0],s:[0.08,1.2,0.08]},{g:'cyl',m:'dark',o:[0,0.6,0],s:[0.08,1.2,0.08]},
           {g:'cyl',m:'dark',o:[1.85,0.6,0],s:[0.08,1.2,0.08]}]},
};

/* ---------- build snap sockets ---------- */
/* A socket lives on a host piece: {p:[local x,y,z], rots:[allowed rotations 0-3],
   accept:[piece types that may attach]}. The attaching piece's ORIGIN goes to the
   socket world position; R cycles the allowed rotations. Transforms are arbitrary,
   so collision/doors/save/MP all keep working unchanged. */
export const SNAP_WALLS=['wall','window','door','airlock','halfwall'], SNAP_ROOFS=['dome','roof45','roofcorner','flatroof'], SNAP_FLOORS=['floor','halffloor','foundation'], SNAP_RAMPS=['ramp'];
export const WALL_LIKE=SNAP_WALLS.concat(SNAP_ROOFS,SNAP_FLOORS);
export const SNAP_PIECES=new Set(['floor','wall','ramp','door','airlock','window','dome','foundation','pillar','pillar2','pillar3','halfwall','halffloor','roof45','roofcorner','flatroof','beam']);
CAT.floor.sockets=[
  {p:[2,0,0],   rots:[1], accept:SNAP_WALLS},   // +x edge wall (runs along z)
  {p:[-2,0,0],  rots:[1], accept:SNAP_WALLS},
  {p:[0,0,2],   rots:[0], accept:SNAP_WALLS},   // +z edge wall (runs along x)
  {p:[0,0,-2],  rots:[0], accept:SNAP_WALLS},
  {p:[4,0,0],   rots:[0], accept:SNAP_FLOORS},  // tile floors edge to edge
  {p:[-4,0,0],  rots:[0], accept:SNAP_FLOORS},
  {p:[0,0,4],   rots:[0], accept:SNAP_FLOORS},
  {p:[0,0,-4],  rots:[0], accept:SNAP_FLOORS},
  {p:[0,3,0],   rots:[0], accept:SNAP_FLOORS.concat(SNAP_ROOFS)},  // second story / centered roof
  {p:[4,-3,0],  rots:[1], accept:SNAP_RAMPS},   // ramp up to this floor edge
  {p:[-4,-3,0], rots:[3], accept:SNAP_RAMPS},
  {p:[0,-3,4],  rots:[2], accept:SNAP_RAMPS},
  {p:[0,-3,-4], rots:[0], accept:SNAP_RAMPS},
];
CAT.wall.sockets=[
  {p:[0,3,0],   rots:[0], accept:WALL_LIKE},    // stack wall / roof / floor on top
  {p:[4,0,0],   rots:[0], accept:SNAP_WALLS},   // continue straight +x
  {p:[-4,0,0],  rots:[0], accept:SNAP_WALLS},
  {p:[2,0,2],   rots:[1], accept:SNAP_WALLS},   // flush corner off +x end
  {p:[2,0,-2],  rots:[1], accept:SNAP_WALLS},
  {p:[-2,0,2],  rots:[1], accept:SNAP_WALLS},   // flush corner off -x end
  {p:[-2,0,-2], rots:[1], accept:SNAP_WALLS},
];
CAT.window.sockets=[{p:[0,3,0],rots:[0],accept:WALL_LIKE}];
CAT.door.sockets=[{p:[0,3,0],rots:[0],accept:WALL_LIKE}];
CAT.airlock.sockets=[{p:[0,3,0],rots:[0],accept:WALL_LIKE}];
CAT.foundation.sockets=[
  {p:[0,1,0],   rots:[0], accept:SNAP_FLOORS},          // floor/foundation on top
  {p:[2,1,0],   rots:[1], accept:SNAP_WALLS},{p:[-2,1,0],rots:[1],accept:SNAP_WALLS},
  {p:[0,1,2],   rots:[0], accept:SNAP_WALLS},{p:[0,1,-2],rots:[0],accept:SNAP_WALLS},
  {p:[4,0,0],   rots:[0], accept:['foundation']},{p:[-4,0,0],rots:[0],accept:['foundation']},
  {p:[0,0,4],   rots:[0], accept:['foundation']},{p:[0,0,-4],rots:[0],accept:['foundation']},
];
CAT.halffloor.sockets=[
  {p:[2,0,0],rots:[1],accept:SNAP_WALLS},{p:[-2,0,0],rots:[1],accept:SNAP_WALLS},
  {p:[0,0,1],rots:[0],accept:SNAP_WALLS},{p:[0,0,-1],rots:[0],accept:SNAP_WALLS},
  {p:[0,3,0],rots:[0],accept:SNAP_ROOFS}];
CAT.halfwall.sockets=[
  {p:[0,1.5,0],rots:[0],accept:WALL_LIKE},
  {p:[4,0,0],rots:[0],accept:SNAP_WALLS},{p:[-4,0,0],rots:[0],accept:SNAP_WALLS}];
CAT.pillar.sockets=[{p:[0,3,0],rots:[0],accept:SNAP_FLOORS}];
CAT.pillar2.sockets=[{p:[0,5,0],rots:[0],accept:SNAP_FLOORS}];
CAT.pillar3.sockets=[{p:[0,7,0],rots:[0],accept:SNAP_FLOORS}];
CAT.beam.sockets=[{p:[4,0,0],rots:[0],accept:['beam']},{p:[-4,0,0],rots:[0],accept:['beam']}];
/* roofs chain to each other so multi-tile roofs are buildable (they already snap onto wall tops) */
CAT.roof45.sockets=[
  {p:[4,0,0], rots:[0], accept:SNAP_ROOFS},{p:[-4,0,0],rots:[0],accept:SNAP_ROOFS},  // tile sideways along the ridge
  {p:[0,0,4], rots:[0], accept:SNAP_ROOFS},{p:[0,0,-4],rots:[0],accept:SNAP_ROOFS}];  // extend the slope front/back
CAT.roofcorner.sockets=[
  {p:[2,0,0],rots:[1],accept:SNAP_ROOFS},{p:[-2,0,0],rots:[1],accept:SNAP_ROOFS},
  {p:[0,0,2],rots:[0],accept:SNAP_ROOFS},{p:[0,0,-2],rots:[0],accept:SNAP_ROOFS}];
CAT.dome.sockets=[
  {p:[4,0,0],rots:[0],accept:SNAP_ROOFS},{p:[-4,0,0],rots:[0],accept:SNAP_ROOFS},
  {p:[0,0,4],rots:[0],accept:SNAP_ROOFS},{p:[0,0,-4],rots:[0],accept:SNAP_ROOFS}];
/* flat roof slab — mirrors the floor: walls snap to its top-face edges (second story),
   and it tiles edge-to-edge with other roofs to cover a multi-tile building */
CAT.flatroof.sockets=[
  {p:[2,0,0], rots:[1], accept:SNAP_WALLS},{p:[-2,0,0],rots:[1],accept:SNAP_WALLS},  // second-story walls on the slab edges
  {p:[0,0,2], rots:[0], accept:SNAP_WALLS},{p:[0,0,-2],rots:[0],accept:SNAP_WALLS},
  {p:[4,0,0], rots:[0], accept:SNAP_ROOFS},{p:[-4,0,0],rots:[0],accept:SNAP_ROOFS},  // tile the flat roof across the building
  {p:[0,0,4], rots:[0], accept:SNAP_ROOFS},{p:[0,0,-4],rots:[0],accept:SNAP_ROOFS}];

/* ---------- player collision data (pure numbers; the collision CODE stays client-side) ---------- */
export const COLLIDERS={
  wall:   {boxes:[{cx:0,hx:2,hz:0.16}],h:3,step:0.3},
  window: {boxes:[{cx:0,hx:2,hz:0.16}],h:3,step:0.3},
  door:   {door:true,h:3,step:0.3},
  airlock:{door:true,h:3,step:0.3},
  telepad:{r:1.2,h:0.35},            // low cylinders never block at ground level (h-0.4 slack) — you walk onto the pad
  lift:   {r:0.32,h:6.6},            // mast only; the platform is a walk surface via groundYAt
  jumppad:{r:1.1,h:0.35},
  spotlight:{r:0.22,h:3},
  cryopod:{boxes:[{cx:0,hx:0.75,hz:1.35}],h:1.2,step:0.5},
  silo:   {r:1.4,h:4.2},
  navbeacon:{r:0.3,h:7.8},
  crate:  {boxes:[{cx:0,hx:0.8,hz:0.8}],h:1.2,step:0.55},
  ramp:   {ramp:true},
  shieldgen:{r:1.55,h:1.7},
  armory: {boxes:[{cx:0,hx:1.35,hz:0.72}],h:1.5,step:0.6},
  turret: {r:0.8,h:1.6},
  beacon: {r:1.4,h:5},
  claimpost:{r:1.3,h:4.6},
  lightpole:{r:0.22,h:3},
  relay:  {r:0.35,h:2.4},
  flag:   {r:0.14,h:2.5},
  planter:{r:0.5,h:1.0},
  holosign:{r:0.18,h:1.9},
  lampR:  {r:0.18,h:1.25},
  lampG:  {r:0.18,h:1.25},
  lampB:  {r:0.18,h:1.25},
  table:  {r:0.8,h:1.0},
  antenna:{r:0.15,h:3.2},
  bed:    {boxes:[{cx:0,hx:0.7,hz:1.3}],h:0.7,step:0.5},
  console:{boxes:[{cx:0,hx:0.8,hz:0.35}],h:1.1,step:0.6},
  locker: {r:0.5,h:2.2},
  chair:  {r:0.4,h:0.9},
  railing:{boxes:[{cx:0,hx:2,hz:0.06}],h:1.1,step:0.3},
  foundation:{boxes:[{cx:0,hx:2,hz:2}],h:1,step:0.45},
  halfwall:{boxes:[{cx:0,hx:2,hz:0.16}],h:1.5,step:0.3},
  pillar:  {r:0.55,h:3},
  pillar2: {r:0.55,h:5},
  pillar3: {r:0.55,h:7},
  beam:    {boxes:[{cx:0,hx:2,hz:0.16}],h:0.3,step:0.3},
};

/* ---------- orbital station pieces (Phase 7) ---------- */
/* `out` = sockets a piece exposes (local offset p + outward dir d); a piece's
   origin connects INTO the socket it was placed on, body extends along +Z. */
export const STATION={
  corridor:{name:'Corridor Tube', ic:'▭', cost:{fe:40,cy:20},
    parts:[{g:'cyl',m:'metal',o:[0,0,2.5],s:[1.5,5,1.5],r:[Math.PI/2,0,0]},
           {g:'torus',m:'emisT',o:[0,0,0.15],s:[1.6,1.6,1.6]},{g:'torus',m:'emisT',o:[0,0,4.85],s:[1.6,1.6,1.6]}],
    out:[{p:[0,0,5],d:[0,0,1]}]},
  habitat:{name:'Habitat Module', ic:'⬢', cost:{fe:80,cy:50,bio:20,pe:8},
    parts:[{g:'cyl',m:'metal',o:[0,0,2],s:[4.4,4,4.4],r:[Math.PI/2,0,0]},
           {g:'cyl',m:'dark',o:[0,0,2],s:[4.7,1.0,4.7],r:[Math.PI/2,0,0]},
           {g:'box',m:'glass',o:[0,2.05,2],s:[1.5,0.6,1.7]},{g:'torus',m:'emisM',o:[0,0,0.15],s:[4.4,4.4,4.4]}],
    out:[{p:[0,0,4],d:[0,0,1]},{p:[2.2,0,2],d:[1,0,0]},{p:[-2.2,0,2],d:[-1,0,0]},{p:[0,2.2,2],d:[0,1,0]},{p:[0,-2.2,2],d:[0,-1,0]}]},
  solar:{name:'Solar Wing', ic:'❉', cost:{fe:50,cy:30,pe:5},
    parts:[{g:'cyl',m:'metal',o:[0,0,1],s:[0.3,2,0.3],r:[Math.PI/2,0,0]},
           {g:'box',m:'solar',o:[0,0,2.4],s:[6.5,0.1,2.8]},{g:'box',m:'dark',o:[0,0,2.4],s:[0.2,0.14,2.8]}],
    out:[]},
  dome:{name:'Observation Dome', ic:'◓', cost:{fe:40,cy:40,bio:15,pe:6},
    parts:[{g:'dome',m:'glass',o:[0,0,0.2],s:[2.4,2.4,2.4],r:[-Math.PI/2,0,0]},
           {g:'torus',m:'metal',o:[0,0,0.15],s:[4.6,4.6,4.6]},{g:'sphere',m:'emisP',o:[0,0,1.4],s:[0.3,0.3,0.3]}],
    out:[]},
  dock:{name:'Docking Ring', ic:'◎', cost:{fe:60,cy:30,ch:20,pe:6},
    parts:[{g:'torus',m:'metal',o:[0,0,1],s:[5,5,5]},{g:'cyl',m:'dark',o:[0,0,1],s:[3,2,3],r:[Math.PI/2,0,0]},
           {g:'torus',m:'emisG',o:[0,0,1.9],s:[5,5,5]}],
    out:[{p:[0,0,2.6],d:[0,0,1]}]},
  comms:{name:'Comms Dish', ic:'☄', cost:{fe:50,cy:25,bio:20,pe:5},
    parts:[{g:'cyl',m:'metal',o:[0,0,1],s:[0.3,2,0.3],r:[Math.PI/2,0,0]},
           {g:'cone',m:'metal',o:[0,0,2.5],s:[3,1.4,3],r:[-Math.PI/2,0,0]},{g:'sphere',m:'emisR',o:[0,0,2.0],s:[0.32,0.32,0.32]}],
    out:[]},
};
export const STATION_KEYS=['corridor','habitat','solar','dome','dock','comms'];
/* pure-array forms — the client hydrates THREE.Vector3s from these */
export const STATION_POS=[330,40,30];               // orbit near Rust [260,6,60]
export const CORE_DIRS=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

/* ---------- critters (Phase 4) ---------- */
export const CRITTERS={
  /* off = body-centre height above ground; ch = [min,max] Chitin drop */
  skitterer:{name:'Skitterer', hp:8,  speed:5.0, fleeR:9,  off:0.35, ch:[1,2]},
  grazer:   {name:'Grazer',    hp:14, speed:2.6, fleeR:11, off:0.70, ch:[2,4]},
  floater:  {name:'Floater',   hp:6,  speed:3.2, fleeR:10, hover:2.2, bob:0.5, ch:[1,2]},
  hopper:   {name:'Hopper',    hp:10, speed:4.2, fleeR:9,  off:0.45, hop:true, ch:[1,3]},
  skimmer:  {name:'Skimmer',   hp:7,  speed:5.5, fleeR:10, hover:0.7, bob:0.22, ch:[1,2]},
};
/* which species roam each world — varies the palette/feel per planet */
export const CRIT_BY_PLANET={
  rust:   ['skitterer','grazer','hopper'],
  glacius:['skitterer','floater'],
  verdant:['grazer','floater','hopper'],
  pelagos:['skimmer','floater'],
  cinder: ['skitterer','hopper'],
  umbra:  ['floater','hopper'],
  noctis: ['skitterer','floater'],
};

/* ---------- faction drones (Conquest) ----------
   Deliberately dumb defenders guarding the Command Node: detect within a
   radius, close to ~9m and orbit, fire on a cooldown. Server-simulated in
   MP (coarse snapshots like critters), local in solo. fe = ferrite salvage
   dropped on shutdown. */
export const DRONES={
  stinger:{name:'Stinger Drone', hp:24, speed:6.0, hover:1.6, bob:0.25, dmg:6,  range:18, fireCd:1.3, detectR:30, fe:[2,4]},
  sentry: {name:'Sentry Drone',  hp:40, turret:true, hover:2.6, bob:0.12, dmg:8, range:24, fireCd:1.1, detectR:26, fe:[3,5]},
  heavy:  {name:'Devastator',    hp:70, speed:3.4, hover:1.3, bob:0.2,  dmg:12, range:20, fireCd:1.6, detectR:34, fe:[4,7]},
};
/* per-planet defense scaling, indexed by PLANETS[pl].fac.diff (1-based):
   roamer population, sentries ringing the node, HP/damage multipliers,
   and the Command Node's own HP */
export const FACTION_TIERS=[
  {count:3, roam:['stinger'],                   sentries:1, hpMul:1,   dmgMul:1,   nodeHp:300, reward:{fe:40,cy:20}},
  {count:5, roam:['stinger','stinger','heavy'], sentries:2, hpMul:1.4, dmgMul:1.3, nodeHp:550, reward:{fe:80,cy:40}},
  {count:7, roam:['stinger','heavy','heavy'],   sentries:3, hpMul:1.9, dmgMul:1.7, nodeHp:850, reward:{fe:150,cy:80,bio:30}},
];
export function facTier(p){ return p&&p.fac?FACTION_TIERS[Math.min(FACTION_TIERS.length,Math.max(1,p.fac.diff))-1]:null; }
export const DRONE_LEASH=110;       // drones never chase farther than this from the node
export const DRONE_PATROL=55;       // roamer wander radius around the node

/* ---------- paint palette ---------- */
export const PAINT_COLORS=[0xff5050,0xff9a4a,0xffd24a,0x9ee84a,0x4adf8a,0x4adfff,0x4a9aff,0x9a6aff,0xff6ad0,0xffffff,0x8fa0b0,0x2a2f38];

/* ---------- derived rule sets (single source: CAT flags) ---------- */
export const OWNED  =new Set(Object.keys(CAT).filter(t=>CAT[t].owned));    // record their placer
export const NOKILL =new Set(Object.keys(CAT).filter(t=>CAT[t].noKill));   // can't be destroyed (floor at 10hp)
export const DYNAMIC=new Set(Object.keys(CAT).filter(t=>CAT[t].dynamic));  // movable (rover)
