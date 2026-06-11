/* ============================================================
   ASTRAVOX shared progression — tiers, weapons, ammo, recipes.
   Imported by BOTH the browser client and the Node server.
   Pure data, no side effects.
   ============================================================ */

/* ---------- tiers ---------- */
export const TIERS=[
  {n:1,cost:null,perks:['Basic suit (100 O₂) & ship','Floor · Wall · Ramp · Light Pole','Storage Crate · O₂ Relay']},
  {n:2,cost:{fe:50,cy:25},perks:['SHIELD GENERATOR (meteor dome)','Window · Door · Dome Roof','Sprint (Shift) · O₂ tank 100 → 160']},
  {n:3,cost:{fe:120,cy:70},perks:['JETPACK — hold Jump to fly','Ship speed +75%','VERDANT signal shield DEACTIVATED']},
  {n:4,cost:{fe:150,cy:100,bio:30},perks:['COLONY BEACON — establish the colony','Victory! (game continues in sandbox)']},
  {n:5,cost:{fe:200,cy:140,bio:70,ch:40},perks:['PELAGOS unlocked — teal ocean world','Rover Hover Module — skim across water','Suit O₂ tank 160 → 240','INFERNO THROWER recipe (Armory)']},
];

/* ---------- weapons ---------- */
/* slot 0 = mining tool (default). melee uses arc; ranged is hitscan. */
export const WEAPONS={
  tool:  {slot:0, name:'Mining Tool'},
  blade: {slot:1, name:'Energy Blade', melee:true, dmg:34, range:3.4, cd:0.5,  arc:0.45},
  pistol:{slot:2, name:'Blaster Pistol', dmg:20, range:65, cd:0.33, ammo:'light', col:0xffd060},
  rifle: {slot:3, name:'Pulse Rifle', dmg:14, range:85, cd:0.12, ammo:'heavy', col:0x7fff9a},
  lance: {slot:4, name:'Lance Beam', dmg:90, range:220, cd:1.6, ammo:'heavy', ammoUse:3, col:0xb060ff, lance:true, scope:50},
  inferno:{slot:5, name:'Inferno Thrower', cone:true, dmg:6, range:11, coneCos:0.86, cd:0.05, ammo:'fuel', col:0xff7020},
  grenade:{slot:6, name:'Plasma Grenade', thrown:'grenade', ammo:'nade'},
  shield:{slot:7, name:'Deployable Shield', thrown:'shield', owned:true},
};
export const SLOT_KEYS=['tool','blade','pistol','rifle','lance','inferno','grenade','shield'];
export const SLOT_ICONS=['⛏','╱','┍','╤','➹','♨','✸','⬡'];
export const AMMO_NAMES={light:'Light Cells',heavy:'Heavy Cells',fuel:'Fuel',nade:'Plasma Grenades'};
export const WEP_KEYS=['blade','pistol','rifle','lance','inferno','grenade','shield'];
export const AMMO_KEYS=['light','heavy','fuel','nade'];

/* ---------- Armory craft recipes ---------- */
export const CRAFT={
  blade:  {kind:'weapon', name:'Energy Blade',   ic:'╱', cost:{fe:15},        tier:1, desc:'Melee · no ammo'},
  pistol: {kind:'weapon', name:'Blaster Pistol', ic:'┍', cost:{fe:30,cy:10},  tier:2, desc:'Uses Light Cells'},
  rifle:  {kind:'weapon', name:'Pulse Rifle',    ic:'╤', cost:{fe:50,cy:25},  tier:3, desc:'Uses Heavy Cells'},
  light:  {kind:'ammo',   name:'Light Cells ×20',ic:'▪', cost:{fe:8},          give:20, ammo:'light', tier:1},
  heavy:  {kind:'ammo',   name:'Heavy Cells ×20',ic:'▫', cost:{fe:10,cy:6},    give:20, ammo:'heavy', tier:2},
  medpack:{kind:'med',    name:'Med-Pack (+50 HP)',ic:'+', cost:{cy:10}, costT3:{cy:6,bio:3}, tier:1, desc:'Heals 50'},
  /* ---- Chitin recipes (Phase 4): hunting pays off ---- */
  medChit:{kind:'med',    name:'Chitin Med-Pack',  ic:'✚', cost:{ch:6},        tier:1, desc:'Heals 50 · cheaper from hunting'},
  lightC: {kind:'ammo',   name:'Light Cells ×24',  ic:'▪', cost:{ch:5},        give:24, ammo:'light', tier:1, desc:'From Chitin'},
  heavyC: {kind:'ammo',   name:'Heavy Cells ×24',  ic:'▫', cost:{fe:6,ch:6},    give:24, ammo:'heavy', tier:2, desc:'From Chitin'},
  /* ---- Heavy ordnance (Phase 5) ---- */
  grenade:{kind:'throwable',name:'Plasma Grenade ×3',ic:'✸', cost:{fe:12,ch:8}, give:3, own:'grenade', ammo:'nade', tier:2, desc:'3s fuse AoE · throw arc · no structure dmg'},
  shield: {kind:'gadget',  name:'Deployable Shield', ic:'⬡', cost:{fe:45,cy:30}, own:'shield', tier:3, desc:'Throw an energy wall — blocks shots 20s'},
  lance:  {kind:'weapon',  name:'Lance Beam',        ic:'➹', cost:{fe:80,cy:60,bio:20}, tier:4, desc:'Sniper hitscan · scope · 3 Heavy Cells/shot'},
  inferno:{kind:'weapon',  name:'Inferno Thrower',   ic:'♨', cost:{fe:90,bio:40,ch:25}, tier:5, desc:'Short-range cone · burns Fuel'},
  fuel:   {kind:'ammo',    name:'Fuel ×90',          ic:'⛽', cost:{fe:10,bio:6}, give:90, ammo:'fuel', tier:5, desc:'Inferno fuel'},
};
