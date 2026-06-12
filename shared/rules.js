/* ============================================================
   ASTRAVOX shared rules — pure validators/formulas used by BOTH
   the browser client (for prediction/UI) and the Node server
   (for authority/validation). All state is passed as arguments;
   nothing here reads globals or has side effects beyond the
   explicitly-mutated argument (payCost).
   The client keeps thin same-name wrappers that supply its S.*
   state, so call sites are unchanged.
   ============================================================ */
import { SAFE_R, CARRY_BASE, CYCLE_S, STATION_MIN_PIECES,
  MAX_STRUCT, WORLD_R, CORE_R, STATION_MAX } from './constants.js';
import { CAT, STATION, STATION_KEYS, STATION_POS, CORE_DIRS } from './catalog.js';
import { TIERS, WEAPONS, SLOT_KEYS, CRAFT } from './tiers.js';
import { PLANETS, terrainH } from './world.js';

/* ---- economy ---- */
export function canAfford(res, cost){ for(const k in cost){ if(res[k]<cost[k]) return false; } return true; }
export function payCost(res, cost){ for(const k in cost){ res[k]=Math.max(0,res[k]-cost[k]); } return res; }
/* removal refunds half, floored — the one true refund formula */
export function refundFor(cost){ const out={}; for(const k in cost) out[k]=Math.floor(cost[k]/2); return out; }

/* ---- capacities ---- */
export function carryCap(structures){
  /* any live structure with a capUp raises the cap (crate +150, silo +400) */
  let up=0; for(const s of structures){ if(s.hp>0&&CAT[s.t]&&CAT[s.t].capUp) up+=CAT[s.t].capUp; }
  return CARRY_BASE + up;
}
export function o2Max(tier){ return tier>=5?240:(tier>=2?160:100); }

/* ---- zones ---- */
export function beaconOn(structures, planet){
  for(const s of structures){ if(s.t==='beacon'&&s.pl===planet) return s; }
  return null;
}
export function inSafeZone(structures, planet, x, z){
  const b=beaconOn(structures, planet); if(!b) return false;
  const dx=x-b.x, dz=z-b.z; return dx*dx+dz*dz<SAFE_R*SAFE_R;
}

/* ---- time ---- */
export function todOf(clockSeconds){ return (((clockSeconds%CYCLE_S)+CYCLE_S)%CYCLE_S)/CYCLE_S; }

/* ---- orbital station ---- */
export function stationComplete(pieces){
  const types=new Set(pieces.map(p=>p.t));
  return pieces.length>=STATION_MIN_PIECES && types.size>=STATION_KEYS.length;
}

/* ============================================================
   Phase 2 — pure geometry + intent validators. All state is
   passed in; the client wraps these with its S.* state and the
   server calls them directly to validate intents.
   ============================================================ */

/* world->local for a structure rotated by r*90° (matches three.js R_y) */
function toLocalXZ(st,wx,wz){
  const a=st.r*Math.PI/2, c=Math.cos(a), s=Math.sin(a);
  const dx=wx-st.x, dz=wz-st.z;
  return {lx:dx*c-dz*s, lz:dx*s+dz*c};
}

/* walkable height at (x,z): terrain + floors/ramps/crates/pads/lift etc. */
const WALK_TYPES=['floor','ramp','crate','foundation','halffloor','flatroof','telepad','jumppad','lift'];
export function groundYAt(structures, plKey, x, z, curY){
  const p=PLANETS[plKey];
  let g=terrainH(x,z,p);
  for(const st of structures){
    if(st.pl!==plKey||WALK_TYPES.indexOf(st.t)<0) continue;
    const {lx,lz}=toLocalXZ(st,x,z);
    let top=null;
    const t=st.t;
    if((t==='floor'||t==='flatroof')&&Math.abs(lx)<=2.05&&Math.abs(lz)<=2.05) top=st.y+0.31;
    else if(t==='halffloor'&&Math.abs(lx)<=2.05&&Math.abs(lz)<=1.05) top=st.y+0.31;
    else if(t==='foundation'&&Math.abs(lx)<=2.05&&Math.abs(lz)<=2.05) top=st.y+1.01;
    else if(t==='crate'&&Math.abs(lx)<=0.85&&Math.abs(lz)<=0.85) top=st.y+1.2;
    else if((t==='telepad'||t==='jumppad')&&lx*lx+lz*lz<=1.32) top=st.y+0.36;
    else if(t==='lift'&&lx*lx+lz*lz<=1.7) top=st.y+0.64+(st.lift||0)*CAT.lift.liftH;   // st.lift is client-side; on the server the platform reads as "down"
    else if(t==='ramp'&&Math.abs(lx)<=2.05&&Math.abs(lz)<=2.1){
      const tt=Math.max(0,Math.min(1,(2-lz)/4)); top=st.y+0.31+tt*3;
    }
    if(top!==null&&curY>=top-0.7&&top>g) g=top;
  }
  return g;
}

/* nearest valid build socket to the aim point, or null */
export function findSnap(structures, plKey, pieceType, ax, az, snapR){
  let best=null, bestD=snapR*snapR;
  for(const st of structures){
    if(st.pl!==plKey) continue;
    const hdef=CAT[st.t]; if(!hdef||!hdef.sockets) continue;
    const a=st.r*Math.PI/2, c=Math.cos(a), s=Math.sin(a);
    for(const sk of hdef.sockets){
      if(sk.accept.indexOf(pieceType)<0) continue;
      const wx=st.x+sk.p[0]*c+sk.p[2]*s, wz=st.z-sk.p[0]*s+sk.p[2]*c;
      const d=(wx-ax)*(wx-ax)+(wz-az)*(wz-az);
      if(d<bestD){ bestD=d; best={x:wx,y:st.y+sk.p[1],z:wz,rots:sk.rots.map(r=>(r+st.r)%4)}; }
    }
  }
  return best;
}

/* same-type piece already at this exact spot? */
export function occupiedAt(structures, plKey, t, x, y, z){
  for(const st of structures){
    if(st.pl!==plKey||st.t!==t) continue;
    if(Math.abs(st.x-x)<0.25&&Math.abs(st.y-y)<0.25&&Math.abs(st.z-z)<0.25) return true;
  }
  return false;
}

/* segment(o->e) vs deployable shield-wall rectangles; hit point or null */
export function shotBlocked(walls, o, e){
  for(const w of walls){
    const nx=Math.sin(w.yaw), nz=Math.cos(w.yaw);
    const denom=(e[0]-o[0])*nx+(e[2]-o[2])*nz;
    if(Math.abs(denom)<1e-6) continue;
    const t=((w.x-o[0])*nx+(w.z-o[2])*nz)/denom;
    if(t<=0.02||t>=1) continue;
    const hx=o[0]+(e[0]-o[0])*t, hy=o[1]+(e[1]-o[1])*t, hz=o[2]+(e[2]-o[2])*t;
    const tx=Math.cos(w.yaw), tz=-Math.sin(w.yaw);
    const u=(hx-w.x)*tx+(hz-w.z)*tz, v=hy-w.y;
    if(Math.abs(u)<=w.hw&&v>=-0.2&&v<=w.h) return [hx,hy,hz];
  }
  return null;
}

/* ---- intent validators (server authority; client pre-checks) ---- */
export const PLACE_RANGE=90;   // generous: covers blueprint stamps placed at aim distance
/* returns an error string, or null if the placement is legal */
export function placeError({structures, st, tier, res, px, pz}){
  const def=CAT[st.t];
  if(!def) return 'Unknown structure';
  if(def.tier>0&&def.tier>tier) return 'Requires Tier '+def.tier;
  if(!canAfford(res,def.cost)) return 'Not enough resources';
  if(structures.length>=MAX_STRUCT) return 'Construction limit reached ('+MAX_STRUCT+' pieces)';
  if(Math.hypot(st.x,st.z)>WORLD_R-2) return 'Outside the survey zone';
  if(px!==undefined&&px!==null){
    const dx=st.x-px, dz=st.z-pz;
    if(dx*dx+dz*dz>PLACE_RANGE*PLACE_RANGE) return 'Too far away to build there';
  }
  const g=terrainH(st.x,st.z,PLANETS[st.pl]);
  if(!(st.y>g-8&&st.y<g+90)) return 'Invalid build height';
  if(occupiedAt(structures,st.pl,st.t,st.x,st.y,st.z)) return 'Space already occupied';
  return null;
}
/* returns {cost} or {err} */
export function craftCheck(key, tier, res, weapons){
  const c=CRAFT[key];
  if(!c) return {err:'Unknown recipe'};
  if(c.tier>tier) return {err:'Requires Tier '+c.tier};
  if((c.kind==='weapon'||c.kind==='gadget')&&weapons[c.own||key]) return {err:'Already crafted'};
  const cost=(key==='medpack'&&tier>=3)?c.costT3:c.cost;
  if(!canAfford(res,cost)) return {err:'Not enough resources'};
  return {cost, c};
}
/* returns {cost} or {err} */
export function tierUpCheck(tier, n, res){
  if(n!==tier+1||n<2||n>TIERS.length) return {err:'Invalid tier'};
  const td=TIERS[n-1];
  if(!canAfford(res,td.cost)) return {err:'Not enough resources'};
  return {cost:td.cost};
}
/* slot index -> weapon, checking ownership + ammo. returns {key,w,ammoKey?,use?} or {err} */
export function fireCheck(weapons, ammo, wp){
  if(!(wp>=1&&wp<SLOT_KEYS.length)) return {err:'Bad weapon'};
  const key=SLOT_KEYS[wp], w=WEAPONS[key];
  if(!weapons[key]) return {err:'Weapon not owned'};
  if(w.ammo){
    const use=w.ammoUse||1;
    if((ammo[w.ammo]|0)<use) return {err:'No ammo'};
    return {key,w,ammoKey:w.ammo,use};
  }
  return {key,w};
}

/* ---- orbital station placement geometry (pure quaternion math) ---- */
function quatApply(qx,qy,qz,qw,v){
  const tx=2*(qy*v[2]-qz*v[1]), ty=2*(qz*v[0]-qx*v[2]), tz=2*(qx*v[1]-qy*v[0]);
  return [v[0]+qw*tx+(qy*tz-qz*ty), v[1]+qw*ty+(qz*tx-qx*tz), v[2]+qw*tz+(qx*ty-qy*tx)];
}
/* all open attach points (core faces + exposed piece sockets) as [x,y,z] */
export function stationSocketPoints(pieces){
  const list=[];
  for(const d of CORE_DIRS) list.push([STATION_POS[0]+d[0]*CORE_R,STATION_POS[1]+d[1]*CORE_R,STATION_POS[2]+d[2]*CORE_R]);
  for(const pc of pieces){
    const def=STATION[pc.t]; if(!def) continue;
    for(const o of def.out){
      const w=quatApply(pc.qx,pc.qy,pc.qz,pc.qw,o.p);
      list.push([pc.x+w[0],pc.y+w[1],pc.z+w[2]]);
    }
  }
  return list.filter(s=>!pieces.some(pc=>{
    const dx=pc.x-s[0], dy=pc.y-s[1], dz=pc.z-s[2]; return dx*dx+dy*dy+dz*dz<1.6;
  }));
}
/* does (x,y,z) sit on an open socket? (client snaps exactly; 0.5 epsilon) */
export function stationPlaceValid(pieces, x, y, z){
  if(pieces.length>=STATION_MAX) return false;
  for(const s of stationSocketPoints(pieces)){
    const dx=x-s[0], dy=y-s[1], dz=z-s[2];
    if(dx*dx+dy*dy+dz*dz<0.5) return true;
  }
  return false;
}
