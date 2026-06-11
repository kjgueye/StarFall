/* ============================================================
   ASTRAVOX shared world — planets + the deterministic terrain
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
/* nightSky/nightFog: where the palette settles after dark; dusk: horizon
   light tint at dawn/dusk; glowNight: how hard lamp glows push at night */
export const PLANETS={
  rust:   {name:'RUST',    seed:11, r:26, pos:[260,6,60],    surfCol:0x91502c, surfCol2:0x6b3318, rockCol:0x5a2e1c,
           fog:0x4a2012, sky:0x2a1208, sun:0xffd9b0, amp:9,  res:'fe', nodeCol:0xff7a30, nodeEmis:0xb34400,
           nightSky:0x0a0504, nightFog:0x150906, dusk:0xff8a50, glowNight:1.0,
           floraCol:0x7a4a30, desc:'Iron-rich starter world'},
  glacius:{name:'GLACIUS', seed:23, r:30, pos:[-180,42,470], surfCol:0xaccde4, surfCol2:0x7fa8cc, rockCol:0x6688aa,
           fog:0x9cc2dd, sky:0x16344e, sun:0xeaf4ff, amp:12, res:'cy', nodeCol:0x4fdfff, nodeEmis:0x0aa0cc,
           nightSky:0x070d18, nightFog:0x0d1826, dusk:0xcfe0ff, glowNight:1.15,
           floraCol:0xcfe8ff, desc:'Frozen cryo-crystal fields'},
  verdant:{name:'VERDANT', seed:37, r:28, pos:[40,-26,-540], surfCol:0x4a8a48, surfCol2:0x2e6034, rockCol:0x3a5a3a,
           fog:0x1d4a2a, sky:0x0a2010, sun:0xd0ffd8, amp:10, res:'bio', nodeCol:0x7fff9a, nodeEmis:0x22cc55,
           nightSky:0x030a06, nightFog:0x08160d, dusk:0xa8ffc0, glowNight:1.35,
           floraCol:0x8a4aaa, desc:'Bio-luminous alien jungle'},
  pelagos:{name:'PELAGOS', seed:53, r:27, pos:[-470,30,-200], surfCol:0x2f9a92, surfCol2:0x123f3c, rockCol:0x355f5b,
           fog:0x1c6a74, sky:0x06283a, sun:0xd6fff6, amp:8, res:'pe', nodeCol:0x7fffe0, nodeEmis:0x10ccaa,
           nightSky:0x03080e, nightFog:0x08141d, dusk:0x9fe8e0, glowNight:1.15,
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

/* ---------- deterministic surface layout ----------
   Rocks, flora and the 46 resource nodes for a planet, computed from the
   planet seed alone. The client renders from this; the server imports the
   SAME function to learn node positions, so mining can be validated
   (range, liveness) with zero client trust. The rng call order below is
   frozen — it reproduces the original buildSurface() sequence exactly. */
export const NODE_COUNT=46;
export function surfaceLayout(p){
  const rng=mulberry32(p.seed*101);
  const rocks=[];
  for(let i=0;i<140;i++){
    const r=30+rng()*330, th=rng()*Math.PI*2;
    const x=Math.cos(th)*r, z=Math.sin(th)*r;
    const rx=rng()*6, ry=rng()*6, rz=rng()*6;
    const s=0.7+rng()*3.4, sy=s*(0.6+rng()*0.8);
    rocks.push({x,z,rx,ry,rz,s,sy});
  }
  const flora=[];
  for(let i=0;i<110;i++){
    const r=26+rng()*320, th=rng()*Math.PI*2;
    const x=Math.cos(th)*r, z=Math.sin(th)*r;
    const s=0.5+rng()*1.8, ry=rng()*6;
    flora.push({x,z,s,ry});
  }
  const nodes=[];
  for(let i=0;i<NODE_COUNT;i++){
    let x,z,y;
    if(p.water){                     // Pelagos: pearls sit on outer islands across the water
      for(let tr=0;tr<24;tr++){
        const ring=70+rng()*230, th=rng()*Math.PI*2;
        x=Math.cos(th)*ring; z=Math.sin(th)*ring; y=terrainH(x,z,p);
        if(y>SEA_Y+0.5) break;
      }
      if(y<=SEA_Y+0.5) y=SEA_Y+0.5;  // fallback: a shallow shoal
    } else {
      const ring=i<10? (14+rng()*40) : (40+rng()*300);
      const th=rng()*Math.PI*2;
      x=Math.cos(th)*ring; z=Math.sin(th)*ring; y=terrainH(x,z,p);
    }
    const s=0.8+rng()*0.9;
    const rot=rng()*6;
    const tx=rng()*0.6, ty=rng()*6, tz=rng()*0.6;   // initial visual tilt
    nodes.push({x,y,z,s,rot,tx,ty,tz});
  }
  return {rocks,flora,nodes};
}
