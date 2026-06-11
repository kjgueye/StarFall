/* ============================================================
   STARFALL shared world — planets + the deterministic terrain
   stack. Imported by BOTH the browser client and the Node
   server: given the same (x, z, planet) both sides compute the
   exact same height, so the server can validate positions and
   node layouts without any client trust.
   ============================================================ */
import { SEA_Y } from './constants.js';

/* ---------- deterministic noise utils ---------- */
export const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
export function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
export function hash2(x,y,s){const h=Math.sin(x*127.1+y*311.7+s*74.7)*43758.5453;return h-Math.floor(h);}
export function vnoise(x,y,s){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash2(xi,yi,s),b=hash2(xi+1,yi,s),c=hash2(xi,yi+1,s),d=hash2(xi+1,yi+1,s);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
export function fbm(x,y,s){return vnoise(x,y,s)*0.6+vnoise(x*2.3,y*2.3,s+7)*0.3+vnoise(x*5.1,y*5.1,s+13)*0.1;}

/* ---------- planet definitions ---------- */
export const PLANETS={
  rust:   {name:'RUST',    seed:11, r:26, pos:[260,6,60],    surfCol:0x91502c, surfCol2:0x6b3318, rockCol:0x5a2e1c,
           fog:0x4a2012, sky:0x2a1208, sun:0xffd9b0, amp:9,  res:'fe', nodeCol:0xff7a30, nodeEmis:0xb34400,
           floraCol:0x7a4a30, desc:'Iron-rich starter world'},
  glacius:{name:'GLACIUS', seed:23, r:30, pos:[-180,42,470], surfCol:0xaccde4, surfCol2:0x7fa8cc, rockCol:0x6688aa,
           fog:0x9cc2dd, sky:0x16344e, sun:0xeaf4ff, amp:12, res:'cy', nodeCol:0x4fdfff, nodeEmis:0x0aa0cc,
           floraCol:0xcfe8ff, desc:'Frozen cryo-crystal fields'},
  verdant:{name:'VERDANT', seed:37, r:28, pos:[40,-26,-540], surfCol:0x4a8a48, surfCol2:0x2e6034, rockCol:0x3a5a3a,
           fog:0x1d4a2a, sky:0x0a2010, sun:0xd0ffd8, amp:10, res:'bio', nodeCol:0x7fff9a, nodeEmis:0x22cc55,
           floraCol:0x8a4aaa, desc:'Bio-luminous alien jungle'},
  pelagos:{name:'PELAGOS', seed:53, r:27, pos:[-470,30,-200], surfCol:0x2f9a92, surfCol2:0x123f3c, rockCol:0x355f5b,
           fog:0x1c6a74, sky:0x06283a, sun:0xd6fff6, amp:8, res:'pe', nodeCol:0x7fffe0, nodeEmis:0x10ccaa,
           floraCol:0x49c8bd, desc:'Teal archipelago — cross the water', water:true},
};
export const PLANET_KEYS=Object.keys(PLANETS);
export const RES_NAMES={fe:'Ferrite',cy:'Cryo-crystal',bio:'Biolume',ch:'Chitin',pe:'Abyssal Pearl'};
export const RES_DOTS={fe:'#ff8a4a',cy:'#6fe0ff',bio:'#7fff9a',ch:'#d8b878',pe:'#5fe9d6'};

/* ---------- terrain heightfields (fully deterministic) ---------- */
export function terrainH(x,z,p){
  if(p.water) return terrainHWater(x,z,p);
  const d=Math.hypot(x,z);
  let h=(fbm(x*0.012,z*0.012,p.seed)-0.45)*p.amp*2.2;
  h+=(fbm(x*0.05,z*0.05,p.seed+31)-0.5)*2.6;
  const flat=clamp((d-22)/60,0,1);
  h*=0.1+0.9*flat;
  if(d>300) h+=(d-300)*0.09;
  return h;
}
/* archipelago seabed: mostly below SEA_Y with scattered island peaks + a
   guaranteed central spawn island. Pearl nodes sit on the outer islands. */
export function terrainHWater(x,z,p){
  const d=Math.hypot(x,z);
  let h=(fbm(x*0.0105,z*0.0105,p.seed)-0.52)*46;      // big island blobs (>0 ⇒ land)
  h+=(fbm(x*0.052,z*0.052,p.seed+11)-0.5)*3.0;        // shore detail
  h=Math.max(h, 7 - d*0.3);                            // central spawn island (~r24)
  if(d>320) h-=(d-320)*0.06;                           // deep ocean toward the edge
  return h;
}
export function isDeepWaterAt(x,z,p){ return !!p.water && terrainH(x,z,p) < SEA_Y-1.6; }
