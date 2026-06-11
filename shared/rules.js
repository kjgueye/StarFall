/* ============================================================
   STARFALL shared rules — pure validators/formulas used by BOTH
   the browser client (for prediction/UI) and the Node server
   (for authority/validation). All state is passed as arguments;
   nothing here reads globals or has side effects beyond the
   explicitly-mutated argument (payCost).
   The client keeps thin same-name wrappers that supply its S.*
   state, so call sites are unchanged.
   ============================================================ */
import { SAFE_R, CARRY_BASE, CARRY_PER_CRATE, CYCLE_S, STATION_MIN_PIECES } from './constants.js';
import { STATION_KEYS } from './catalog.js';

/* ---- economy ---- */
export function canAfford(res, cost){ for(const k in cost){ if(res[k]<cost[k]) return false; } return true; }
export function payCost(res, cost){ for(const k in cost){ res[k]=Math.max(0,res[k]-cost[k]); } return res; }
/* removal refunds half, floored — the one true refund formula */
export function refundFor(cost){ const out={}; for(const k in cost) out[k]=Math.floor(cost[k]/2); return out; }

/* ---- capacities ---- */
export function carryCap(structures){
  let crates=0; for(const s of structures){ if(s.t==='crate'&&s.hp>0) crates++; }
  return CARRY_BASE + CARRY_PER_CRATE*crates;
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

/* TODO(Phase 2): findSnap/occupiedAt move here once their signatures are
   purified (structures, planet, buildSel, aim) — the server will then
   validate snapped placements with the same code the client predicts with. */
