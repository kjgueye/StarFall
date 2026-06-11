"use strict";
/* ============================================================
   ASTRAVOX (formerly Starfall) — client. Game data/rules live in
   ../shared/ and are imported by BOTH this client and the Node server.
   ============================================================ */
import { MAX_STRUCT, GRID, SNAP_R, BP_MAX, HP_MAX, SPAWN_PROT, SAFE_R,
  GREN_R, GREN_DMG, GREN_FUSE, SHIELD_LIFE, SHIELD_CD, TURRET_R, TURRET_DMG, TURRET_CD,
  WORLD_R, SEA_Y, CYCLE_S, CRIT_CAP, STATION_MAX, STATION_MIN_PIECES, CORE_R,
  EVA_SPEED, STATION_REACH, STATION_SNAP } from '../shared/constants.js';
import { RAMP_ANG, CAT, SNAP_WALLS, SNAP_ROOFS, SNAP_FLOORS, SNAP_RAMPS, WALL_LIKE, SNAP_PIECES,
  COLLIDERS, STATION, STATION_KEYS, STATION_POS as STATION_POS_ARR, CORE_DIRS as CORE_DIRS_ARR,
  CRITTERS, CRIT_BY_PLANET, PAINT_COLORS } from '../shared/catalog.js';
import { TIERS, WEAPONS, SLOT_KEYS, SLOT_ICONS, AMMO_NAMES, WEP_KEYS, AMMO_KEYS, CRAFT } from '../shared/tiers.js';
import { PLANETS, RES_NAMES, RES_DOTS, mulberry32, hash2, vnoise, fbm, terrainH, terrainHWater, surfaceLayout } from '../shared/world.js';
import * as R from '../shared/rules.js';

/* ---------- tiny utils ---------- */
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
/* mulberry32/hash2/vnoise/fbm imported from shared/world.js */
const $=id=>document.getElementById(id);

/* ---------- audio (procedural, WebAudio) ---------- */
const SND={ctx:null,on:true,
  ensure(){ if(!this.ctx){ try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
    if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume().catch(()=>{}); },
  tone(f,dur,type,vol,slide){ if(!this.on||!this.ctx)return; try{
    const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type=type||'sine'; o.frequency.setValueAtTime(f,t);
    if(slide)o.frequency.linearRampToValueAtTime(slide,t+dur);
    g.gain.setValueAtTime(vol||0.08,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t+dur+0.02);}catch(e){} },
  blip(){this.tone(880,0.07,'square',0.05);},
  place(){this.tone(330,0.12,'triangle',0.09,440);},
  remove(){this.tone(280,0.15,'sawtooth',0.06,120);},
  mine(){this.tone(170+Math.random()*60,0.08,'sawtooth',0.045);},
  collect(){this.tone(660,0.1,'sine',0.09,990);},
  klaxon(){this.tone(620,0.28,'sawtooth',0.07,420);},
  impact(){this.tone(90,0.4,'sawtooth',0.12,40);},
  denied(){this.tone(220,0.18,'square',0.07,160);},
  tierUp(){const n=[523,659,784,1046];n.forEach((f,i)=>setTimeout(()=>this.tone(f,0.25,'triangle',0.1),i*110));},
  victory(){const n=[523,659,784,1046,1318,1568];n.forEach((f,i)=>setTimeout(()=>this.tone(f,0.4,'triangle',0.1),i*150));},
  o2warn(){this.tone(980,0.12,'sine',0.06);},
};

/* PLANETS / RES_NAMES / RES_DOTS imported from shared/world.js */
/* TIERS imported from shared/tiers.js */

/* ---------- structure catalog ---------- */
/* RAMP_ANG, CAT (with sockets), SNAP_* sets, build-rule constants:
   imported from shared/catalog.js + shared/constants.js */

/* WEAPONS / SLOT_KEYS / SLOT_ICONS / AMMO_NAMES imported from shared/tiers.js */
/* ---------- Armory craft recipes ---------- */
/* CRAFT imported from shared/tiers.js */
function medCost(){ return S.tier>=3?CRAFT.medpack.costT3:CRAFT.medpack.cost; }

/* ============================================================
   ORBITAL STATION (Phase 7) — data imported from shared/catalog.js;
   THREE.Vector3 forms hydrated here from the pure arrays.
   ============================================================ */
const STATION_POS=new THREE.Vector3(...STATION_POS_ARR);   // orbit near Rust
const CORE_DIRS=CORE_DIRS_ARR.map(d=>new THREE.Vector3(d[0],d[1],d[2]));

/* ---------- game state ---------- */
const S={
  running:false, mode:'space', planet:'rust',
  tier:1, res:{fe:0,cy:0,bio:0,ch:0,pe:0},
  structures:[],            // {t, pl, x,y,z, r, hp, owner?}
  o2:100, fuel:100, beacon:false, victoryShown:false,
  station:[], stationOnline:false,
  ppos:[0,0,0], pyaw:0,
  spos:[300,8,100], syaw:Math.PI*0.9, spitch:0, sspeed:0,
  pendingCutscene:null,
  weapons:{blade:false,pistol:false,rifle:false,lance:false,inferno:false,grenade:false,shield:false},  // owned
  ammo:{light:0,heavy:0,fuel:0,nade:0}, medkits:0, slot:0, headbob:true,
};
/* WEP_KEYS / AMMO_KEYS imported from shared/tiers.js */
function readWeapons(w){ w=w||{}; const o={}; for(const k of WEP_KEYS) o[k]=!!w[k]; return o; }
function readAmmo(a){ a=a||{}; const o={}; for(const k of AMMO_KEYS) o[k]=Math.max(0,a[k]|0); return o; }
function saveWeapons(){ const o={}; for(const k of WEP_KEYS) o[k]=!!S.weapons[k]; return o; }
function saveAmmo(){ const o={}; for(const k of AMMO_KEYS) o[k]=S.ammo[k]|0; return o; }
const SAVE_KEY='astravox_save_v1';
const SAVE_VER=6;
const MP_WORLD_KEY='astravox_mp_world_v1';
/* Phase 3 — guest identity + persistent worlds */
const GUEST_KEY='astravox_guest_v1';            // server-minted {id,tok}; our passwordless identity
const WORLDS_KEY='astravox_worlds_v1';          // recent world codes for quick rejoin
const SOLO_IMPORTED_KEY='astravox_solo_imported_v1';  // one-time solo-save import done
function guestAuth(){ try{ const g=JSON.parse(localStorage.getItem(GUEST_KEY)); if(g&&g.id&&g.tok) return {id:g.id,tok:g.tok}; }catch(e){} return undefined; }
function recentWorlds(){ try{ return JSON.parse(localStorage.getItem(WORLDS_KEY))||[]; }catch(e){ return []; } }
function recordWorld(code){
  try{
    const l=recentWorlds().filter(w=>w&&w.code!==code);
    l.unshift({code,at:Date.now()});
    localStorage.setItem(WORLDS_KEY,JSON.stringify(l.slice(0,8)));
  }catch(e){}
}

/* ============================================================
   NETWORK — co-op client. Every MP behavior is gated on NET.active;
   with no connection the game is byte-identical to single-player.
   ============================================================ */
const RAILWAY_WS='wss://starfall-production.up.railway.app';
function wsURL(){
  /* '/ws' path: WebSocketServer({server}) accepts upgrades on any path, so
     production is unchanged; in `npm run dev` the vite proxy forwards /ws
     to the node game server. */
  if(location.protocol.indexOf('http')===0&&location.host&&location.host.indexOf('github.io')<0){
    return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';
  }
  return RAILWAY_WS+'/ws';
}
const NET={
  active:false, ws:null, pid:null, code:null, worldId:null, name:'', isHost:false,
  players:new Map(), deadNodes:{}, meteor:{}, lastPU:0, quitting:false,
  send(obj){ if(this.ws&&this.ws.readyState===1){ try{ this.ws.send(JSON.stringify(obj)); }catch(e){} } },
  connect(action){
    this.quitting=false;
    try{ if(this.ws) this.ws.close(); }catch(e){}
    let ws;
    try{ ws=new WebSocket(wsURL()); }
    catch(e){ mpStatus('Could not reach the co-op server'); return; }
    this.ws=ws;
    mpStatus('Connecting…');
    ws.onopen=()=>{ mpStatus('Joining…'); this.send(action); };
    ws.onmessage=ev=>{ let m; try{ m=JSON.parse(ev.data); }catch(e){ return; } try{ netHandle(m); }catch(e){} };
    ws.onerror=()=>{};
    ws.onclose=()=>{
      if(this.quitting) return;
      if(this.active) $('netLost').classList.remove('hidden');
      else mpStatus('Could not reach the co-op server');
    };
  },
};
function mpStatus(s){ const el=$('mpStatus'); if(el) el.textContent=s; }
function myPid(){ return NET.active?NET.pid:'self'; }
function mpPlayerKey(){ return 'astravox_mp_p_'+NET.worldId+'_'+NET.name.toLowerCase(); }
function updateRoomBadge(){
  const b=$('roomBadge');
  b.classList.toggle('hidden',!NET.active);
  if(NET.active){
    b.textContent='ROOM '+NET.code+' · '+NET.players.size+'/4';
    b.title='Players: '+[...NET.players.values()].map(p=>p.name).join(', ')+' — click to copy code';
  }
}
function netHandle(m){
  switch(m.t){
    case 'welcome': NET.active?resyncFromWelcome(m):startMultiplayer(m); break;
    case 'err':
      if(m.fatal&&!NET.active){ mpStatus(m.msg); NET.quitting=true; try{ NET.ws.close(); }catch(e){} }
      else { showToast(m.msg); SND.denied(); if(/Rover is occupied/.test(m.msg)&&driving){ driving=null; updateViewmodel(); } }
      break;
    case 'pjoin':
      NET.players.set(m.pid,{name:m.name,slot:m.slot});
      addRemote(m.pid,m.name,m.slot);
      addChat(null,m.name+' joined the expedition',true); updateRoomBadge(); break;
    case 'pleave': {
      const p=NET.players.get(m.pid);
      if(p) addChat(null,p.name+' left',true);
      NET.players.delete(m.pid); removeRemote(m.pid); updateRoomBadge(); break;
    }
    case 'pu': remotePU(m); break;
    case 'placed': applyPlaced(m.st,m.by===NET.pid); break;
    case 'removed': applyRemovedById(m.id,m.by===NET.pid); break;
    case 'hp': applyHpById(m.id,m.hp); break;
    case 'destroyed': applyDestroyedById(m.id); break;
    case 'nodeDead': applyNodeDead(m.pl,m.i,m.by===NET.pid); break;
    case 'nodeAlive': applyNodeAlive(m.pl,m.i); break;
    case 'meteorWarn': NET.meteor[m.pl]={phase:'warning',endAt:performance.now()+m.secs*1000}; break;
    case 'meteorActive': NET.meteor[m.pl]={phase:'active',endAt:performance.now()+(m.secs||12)*1000}; break;
    case 'meteor': if(S.mode==='surface'&&S.planet===m.pl&&surf.built) spawnMeteorAt(m.tx,m.tz,m.sx,m.sz); break;
    case 'meteorEnd': NET.meteor[m.pl]={phase:'idle',endAt:0}; break;
    case 'fire': onRemoteFire(m); break;
    case 'lootSpawn': spawnLootBox(m.id,m.pl,m.pos,m.loot); break;
    case 'lootGone': removeLootBox(m.id); break;
    case 'lootGot': addLoot(m.loot); break;
    case 'sys': addChat(null,m.text,true); break;
    case 'chat': addChat(m.name,m.text,false); break;
    case 'roverSeat': onRoverSeat(m.id,m.pid); break;
    case 'roverMove': onRoverMove(m); break;
    case 'paint': applyPaintById(m.id,m.col); break;
    case 'clock': if(typeof m.tod==='number') dayClock=m.tod*CYCLE_S; break;
    case 'critSnap': applyCritSnap(m.pl,m.crit||[]); break;
    case 'critDead': onCritDead(m); break;
    case 'nade': onRemoteNade(m); break;
    case 'shield': onRemoteShield(m); break;
    case 'stationPlaced': applyStationPlaced(m.st,m.by===NET.pid); break;
    case 'stationRemoved': applyStationRemovedById(m.id,m.by===NET.pid); break;
    case 'prog': applyProg(m); break;
    case 'vitals':
      if(typeof m.o2==='number'&&Math.abs(S.o2-m.o2)>8) S.o2=clamp(m.o2,0,o2Max());
      if(typeof m.fuel==='number'&&Math.abs(S.fuel-m.fuel)>12) S.fuel=clamp(m.fuel,0,100);
      break;
    case 'blackout':
      if(S.running&&S.o2<10){ if(S.mode==='eva') evaEmergency(); else if(S.mode==='surface') doBlackout(); }
      break;
    case 'hurt': onHurt(m); break;
    case 'pdeath': onPDeath(m); break;
    case 'tfire': onTurretFire(m); break;
  }
}
/* ---- server-authoritative damage/death (Phase 2.3) ---- */
function onHurt(m){
  player.hp=Math.max(0,Math.min(HP_MAX,+m.hp||0));
  NET.lastHitBy=m.by;
  if(S.mode==='surface'){
    dmgFlashFx(); SND.hurt();
    spawnBurst(player.x,player.y+1.2,player.z,0xff4040,8,2,2,0.4,3);
  }
}
function onPDeath(m){
  NET.lastHitBy=m.by;
  S.res.fe=0; S.res.cy=0; S.res.bio=0; updateHUDRes();   // server dropped the cache; prog confirms
  if(S.mode==='surface'){
    spawnBurst(player.x,player.y+1,player.z,0xff5050,32,5,6,1.2,3);
    spawnBurst(player.x,player.y+1,player.z,0x553030,16,4,4,1.8,2);
  }
  SND.impact();
  if(S.mode==='surface'&&surf.built) respawnPlayer();
  else { player.hp=HP_MAX; player.invuln=SPAWN_PROT; }
}
function onTurretFire(m){
  if(S.mode!=='surface') return;
  const st=S.structures.find(s=>s.id===m.id&&s.t==='turret');
  if(!st||st.pl!==S.planet||!Array.isArray(m.p)) return;
  tracerFx([st.x,st.y+1.35,st.z],m.p,0xff6a4a);
  const dxs=player.x-st.x,dzs=player.z-st.z;
  if(dxs*dxs+dzs*dzs<1600) SND.shoot();
}
/* ---- server-authoritative progress (Phase 2) ----
   In co-op the server owns resources/tier/weapons/ammo/medkits; every grant
   or payment arrives as a `prog` snapshot. The client only predicts. */
function mpProgBlob(){
  return {tier:S.tier,res:{fe:S.res.fe|0,cy:S.res.cy|0,bio:S.res.bio|0,ch:S.res.ch|0,pe:S.res.pe|0},
    weapons:saveWeapons(),ammo:saveAmmo(),medkits:S.medkits|0,o2:S.o2|0,fuel:S.fuel|0};
}
function applyProg(m){
  if(!m||!m.res) return;
  S.res={fe:m.res.fe|0,cy:m.res.cy|0,bio:m.res.bio|0,ch:m.res.ch|0,pe:m.res.pe|0};
  const newTier=clamp(m.tier|0,1,TIERS.length);
  const tierRose=newTier>S.tier;
  S.tier=newTier;
  S.weapons=readWeapons(m.weapons);
  S.ammo=readAmmo(m.ammo);
  S.medkits=Math.max(0,m.medkits|0);
  if(typeof m.hp==='number') player.hp=clamp(m.hp,0,HP_MAX);
  if(!ownsSlot(S.slot)){ S.slot=0; updateViewmodel(); }
  updateHUDRes(); updateTierBadge(); renderHotbar();
  if(m.ev) progEvent(m.ev);
  else if(tierRose) renderTierList();   // restore from blob: refresh menus, no fanfare
  saveGame();
}
function progEvent(ev){
  if(ev.type==='gain'&&ev.amt>0){ SND.collect(); showToast('+'+ev.amt+' '+RES_NAMES[ev.k]); }
  else if(ev.type==='craft'){
    const c=CRAFT[ev.key];
    if(c){ SND.craft();
      if(c.kind==='ammo') showToast('+'+c.give+' '+AMMO_NAMES[c.ammo]);
      else if(c.kind==='throwable') showToast('+'+c.give+' '+c.name.replace(/ ×\d+$/,'')+'s');
      else if(c.kind==='med') showToast('Med-Pack crafted ('+S.medkits+')');
      else showToast(c.name+' crafted — equip from hotbar');
    }
    if(!$('craftMenu').classList.contains('hidden')) renderCraftGrid();
  }
  else if(ev.type==='med'){
    /* hp itself arrived in this prog snapshot */
    SND.heal(); spawnBurst(player.x,player.y+1,player.z,0x8affb0,12,2,3,0.6,2);
    showToast('+50 HP');
  }
  else if(ev.type==='tier') applyTierUp(ev.n);
}
/* chat / system message overlay (also used by Phase 5) */
const chatMsgs=[];
function escHtml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function addChat(name,text,sys){
  const log=$('chatLog');
  const d=document.createElement('div');
  d.className='chatMsg'+(sys?' sys':'');
  d.innerHTML=sys?escHtml(text):('<b style="color:#7fd6f5">'+escHtml(name)+':</b> '+escHtml(text));
  log.appendChild(d); chatMsgs.push({el:d,t:performance.now()});
  while(chatMsgs.length>6){ const old=chatMsgs.shift(); if(old.el.parentNode) old.el.parentNode.removeChild(old.el); }
  if(sys) SND.blip();
}
function updateChatFade(){
  const now=performance.now();
  for(const c of chatMsgs){ const age=now-c.t; c.el.style.opacity = age>9000?Math.max(0,1-(age-9000)/2000):1; }
}
function openChat(){
  if(!NET.active) return;
  const inp=$('chatInput'); inp.classList.remove('hidden'); inp.value=''; setTimeout(()=>inp.focus(),0);
  if(document.pointerLockElement) document.exitPointerLock();
}
function closeChat(){ const inp=$('chatInput'); inp.classList.add('hidden'); inp.blur(); }
$('chatInput').addEventListener('keydown',e=>{
  e.stopPropagation();
  if(e.code==='Enter'){ const t=$('chatInput').value.trim(); if(t&&NET.active) NET.send({t:'chat',text:t.slice(0,120)}); closeChat(); }
  else if(e.code==='Escape'){ closeChat(); }
});
/* ============================================================
   COMPASS + MINIMAP (Phase 5)
   ============================================================ */
const _pv=new THREE.Vector3();
let compassT=0;
function projNDCx(wx,wz){
  _pv.set(wx,camera.position.y,wz).project(camera);
  if(_pv.z>1) return null;            // behind camera
  return _pv.x;
}
function renderCompass(dt){
  if(!S.running||S.mode!=='surface'){ $('compass').classList.add('hidden'); return; }
  compassT-=dt; if(compassT>0) return; compassT=0.06;
  $('compass').classList.remove('hidden');
  const strip=$('compassStrip'), W=strip.parentElement.clientWidth;
  const px=player.x, pz=player.z, D=1000;
  let html='';
  const mk=(wx,wz,label,color)=>{ const nx=projNDCx(wx,wz); if(nx===null||nx<-1.05||nx>1.05) return;
    html+='<span class="cmkr" style="left:'+((nx*0.5+0.5)*W).toFixed(0)+'px;color:'+(color||'#9fd6ef')+'">'+label+'</span>'; };
  mk(px,pz-D,'N','#cfe8ff'); mk(px+D,pz,'E'); mk(px,pz+D,'S'); mk(px-D,pz,'W');
  if(surf.built) mk(surf.shipPos.x,surf.shipPos.z,'⌂','#7fd6f5');
  const b=beaconOnPlanet(S.planet); if(b) mk(b.x,b.z,'★','#aef9c8');
  if(S.structures.some(s=>s.pl===S.planet&&s.t!=='beacon')){ const c=baseCentroid(); mk(c.x,c.z,'⌗','#ffd9a0'); }
  /* nearest critter — points the way to the hunt */
  if(critters.length){ let best=null,bd=1e9; for(const c of critters){ const dx=c.x-px,dz=c.z-pz,d=dx*dx+dz*dz; if(d<bd){bd=d;best=c;} }
    if(best) mk(best.x,best.z,'❖','#d8b878'); }
  if(NET.active) for(const r of remotes.values()){ if(r.avatar.visible) mk(r.avatar.position.x,r.avatar.position.z,'◆','#'+new THREE.Color(SLOT_COLORS[r.slot%4]).getHexString()); }
  strip.innerHTML=html;
}
let mapOn=false, mapT=0;
function toggleMap(){ mapOn=!mapOn; $('minimap').classList.toggle('hidden',!mapOn||S.mode!=='surface'); if(mapOn) drawMinimap(); SND.blip(); }
function updateMinimap(dt){
  if(!mapOn) return;
  if(S.mode!=='surface'){ $('minimap').classList.add('hidden'); return; }
  $('minimap').classList.remove('hidden');
  mapT-=dt; if(mapT>0) return; mapT=0.25; drawMinimap();
}
function drawMinimap(){
  const cv=$('minimap'), g=cv.getContext('2d'), W=cv.width, H=cv.height, cx=W/2, cy=H/2;
  const R=140, scale=(W/2-6)/R, p=curP(), yaw=player.yaw;
  g.clearRect(0,0,W,H);
  g.save(); g.beginPath(); g.arc(cx,cy,W/2-2,0,Math.PI*2); g.clip();
  g.fillStyle='#'+new THREE.Color(p.surfCol2).getHexString(); g.fillRect(0,0,W,H);
  const sy=Math.sin(yaw), cyaw=Math.cos(yaw);
  const w2m=(wx,wz)=>{ const dx=wx-player.x, dz=wz-player.z;
    const ahead=-(dx*sy+dz*cyaw), side=-dx*cyaw+dz*sy;
    return [cx+side*scale, cy-ahead*scale]; };
  const dot=(wx,wz,col,rad)=>{ const m=w2m(wx,wz); g.fillStyle=col; g.beginPath(); g.arc(m[0],m[1],rad||2,0,Math.PI*2); g.fill(); };
  // resource nodes (alive)
  if(surf.built) for(const nd of surf.nodes){ if(nd.alive) dot(nd.x,nd.z,'#'+new THREE.Color(p.nodeCol).getHexString(),1.6); }
  // structures
  for(const s of S.structures){ if(s.pl!==S.planet) continue;
    dot(s.x,s.z, s.t==='beacon'?'#aef9c8':(s.t==='turret'?'#ff7a6a':(s.t==='rover'?'#ffd060':'#8fb6cc')), s.t==='beacon'?3:2); }
  // wildlife (critters — hunt for Chitin)
  for(const c of critters) dot(c.x,c.z,'#d8b878',1.8);
  // ship
  if(surf.built) dot(surf.shipPos.x,surf.shipPos.z,'#7fd6f5',3);
  // active meteor zone
  const ms=NET.active?(NET.meteor[S.planet]&&NET.meteor[S.planet].phase!=='idle'):(meteorState.phase!=='idle');
  if(ms){ const c=baseCentroid(); const m=w2m(c.x,c.z); g.strokeStyle='rgba(255,90,60,0.8)'; g.lineWidth=2; g.beginPath(); g.arc(m[0],m[1],50*scale,0,Math.PI*2); g.stroke(); }
  // teammates
  if(NET.active) for(const r of remotes.values()){ if(r.avatar.visible) dot(r.avatar.position.x,r.avatar.position.z,'#'+new THREE.Color(SLOT_COLORS[r.slot%4]).getHexString(),3); }
  g.restore();
  // player arrow at center (always pointing up)
  g.fillStyle='#eaffff'; g.beginPath(); g.moveTo(cx,cy-6); g.lineTo(cx-4,cy+5); g.lineTo(cx+4,cy+5); g.closePath(); g.fill();
  // N marker on rim
  g.fillStyle='#cfe8ff'; g.font='10px sans-serif'; g.textAlign='center';
  const nm=w2m(player.x,player.z-1000); const ang=Math.atan2(nm[1]-cy,nm[0]-cx);
  g.fillText('N',cx+Math.cos(ang)*(W/2-10),cy+Math.sin(ang)*(W/2-10)+3);
}
function onRoverSeat(id,pid){
  if(pid===0||pid===undefined) NET.seats.delete(id);
  else NET.seats.set(id,pid);
  /* if someone else claimed the rover we're driving, eject us */
  if(driving&&driving.id===id&&pid&&pid!==myPid()) { driving=null; updateViewmodel(); showToast('Rover taken by another driver'); }
}
function onRoverMove(m){
  const st=S.structures.find(s=>s.id===m.id&&s.t==='rover');
  if(st) st._t={x:+m.x,y:+m.y,z:+m.z,ry:+m.ry};
}

/* ============================================================
   SAVE / LOAD — versioned, bulletproof
   ============================================================ */
function structSave(s){
  const o={t:s.t,pl:s.pl,x:+s.x.toFixed(2),y:+s.y.toFixed(2),z:+s.z.toFixed(2),r:s.r,hp:s.hp|0};
  if(s.owner!==undefined&&s.owner!==null) o.owner=s.owner;
  if(s.ry!==undefined) o.ry=+s.ry.toFixed(3);
  if(s.col!==undefined&&s.col!==null) o.col=s.col;
  return o;
}
function stationSave(p){
  return {t:p.t,x:+p.x.toFixed(2),y:+p.y.toFixed(2),z:+p.z.toFixed(2),
    qx:+p.qx.toFixed(4),qy:+p.qy.toFixed(4),qz:+p.qz.toFixed(4),qw:+p.qw.toFixed(4),r:p.r|0};
}
function buildSaveObj(){
  return {v:SAVE_VER, tier:S.tier, res:{fe:S.res.fe|0,cy:S.res.cy|0,bio:S.res.bio|0,ch:S.res.ch|0,pe:S.res.pe|0},
    structures:S.structures.map(structSave),
    station:S.station.map(stationSave), stationOnline:!!S.stationOnline,
    mode:S.mode==='surface'?'surface':'space', planet:S.planet,
    ppos:S.ppos.map(v=>+v.toFixed(2)), pyaw:+S.pyaw.toFixed(3),
    spos:S.spos.map(v=>+v.toFixed(2)), syaw:+S.syaw.toFixed(3), spitch:+S.spitch.toFixed(3),
    o2:S.o2|0, fuel:S.fuel|0, beacon:!!S.beacon, victoryShown:!!S.victoryShown,
    pc:S.pendingCutscene||null, sound:SND.on,
    weapons:saveWeapons(),
    ammo:saveAmmo(), medkits:S.medkits|0, headbob:S.headbob!==false};
}
function saveGame(){
  if(!S.running) return;
  if(NET.active){ saveMP(); return; }
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(buildSaveObj())); }catch(e){}
}
function saveMP(){
  try{
    localStorage.setItem(mpPlayerKey(),JSON.stringify({tier:S.tier,
      res:{fe:S.res.fe|0,cy:S.res.cy|0,bio:S.res.bio|0,ch:S.res.ch|0,pe:S.res.pe|0},o2:S.o2|0,fuel:S.fuel|0,victoryShown:!!S.victoryShown,
      weapons:saveWeapons(),
      ammo:saveAmmo(), medkits:S.medkits|0, headbob:S.headbob!==false}));
    if(NET.isHost){
      localStorage.setItem(MP_WORLD_KEY,JSON.stringify({v:1,worldId:NET.worldId,savedAt:Date.now(),beacon:!!S.beacon,
        structures:S.structures.map(structSave),station:S.station.map(stationSave),stationOnline:!!S.stationOnline}));
    }
  }catch(e){}
}
function parseSave(json){
  try{
    const d=JSON.parse(json);
    /* migration: accept v1 (pre-combat) and v2; default missing fields */
    if(!d||typeof d.v!=='number'||d.v<1||d.v>SAVE_VER||typeof d.tier!=='number') return null;
    const out={
      tier:clamp(d.tier|0,1,5),
      res:{fe:Math.max(0,d.res&&d.res.fe|0||0),cy:Math.max(0,d.res&&d.res.cy|0||0),bio:Math.max(0,d.res&&d.res.bio|0||0),ch:Math.max(0,d.res&&d.res.ch|0||0),pe:Math.max(0,d.res&&d.res.pe|0||0)},
      structures:[], station:[], stationOnline:!!d.stationOnline,
      mode:(d.mode==='surface'?'surface':'space'),
      planet:PLANETS[d.planet]?d.planet:'rust',
      ppos:Array.isArray(d.ppos)&&d.ppos.length===3?d.ppos.map(Number):[0,0,0],
      pyaw:Number(d.pyaw)||0,
      spos:Array.isArray(d.spos)&&d.spos.length===3?d.spos.map(Number):[300,8,100],
      syaw:Number(d.syaw)||0, spitch:clamp(Number(d.spitch)||0,-1.2,1.2),
      o2:clamp(Number(d.o2)||100,5,200), fuel:clamp(Number(d.fuel)||100,0,100),
      beacon:!!d.beacon, victoryShown:!!d.victoryShown,
      pc:(d.pc&&SHIELDED[d.pc])?d.pc:(d.pvc?'verdant':null),
      sound:d.sound!==false,
      weapons:readWeapons(d.weapons),
      ammo:readAmmo(d.ammo),
      medkits:Math.max(0,d.medkits|0), headbob:d.headbob!==false};
    if(Array.isArray(d.structures)){
      for(const s of d.structures){
        if(out.structures.length>=MAX_STRUCT) break;
        if(!s||!CAT[s.t]||!PLANETS[s.pl]) continue;
        const x=Number(s.x),y=Number(s.y),z=Number(s.z);
        if(!isFinite(x)||!isFinite(y)||!isFinite(z)) continue;
        const st={t:s.t,pl:s.pl,x,y,z,r:((s.r|0)%4+4)%4,hp:clamp(Number(s.hp)||CAT[s.t].hp,1,CAT[s.t].hp)};
        if(s.owner!==undefined&&s.owner!==null) st.owner=s.owner;
        if(s.ry!==undefined&&isFinite(Number(s.ry))) st.ry=Number(s.ry);
        if(s.col!==undefined&&isFinite(Number(s.col))) st.col=Number(s.col)|0;
        out.structures.push(st);
      }
    }
    if(Array.isArray(d.station)){
      for(const p of d.station){
        if(out.station.length>=STATION_MAX) break;
        if(!p||!STATION[p.t]) continue;
        const x=Number(p.x),y=Number(p.y),z=Number(p.z);
        if(!isFinite(x)||!isFinite(y)||!isFinite(z)) continue;
        out.station.push({t:p.t,x,y,z,qx:Number(p.qx)||0,qy:Number(p.qy)||0,qz:Number(p.qz)||0,qw:isFinite(Number(p.qw))?Number(p.qw):1,r:(p.r|0)%4});
      }
    }
    if(out.ppos.some(v=>!isFinite(v))) out.ppos=[0,0,0];
    if(out.spos.some(v=>!isFinite(v))) out.spos=[300,8,100];
    return out;
  }catch(e){ return null; }
}
function loadSavedState(){
  let raw=null;
  try{ raw=localStorage.getItem(SAVE_KEY); }catch(e){}
  if(!raw) return null;
  return parseSave(raw);
}
function applySave(d){
  S.tier=d.tier; S.res=d.res; S.structures=d.structures; S.mode=d.mode; S.planet=d.planet;
  S.ppos=d.ppos; S.pyaw=d.pyaw; S.spos=d.spos; S.syaw=d.syaw; S.spitch=d.spitch;
  S.o2=d.o2; S.fuel=d.fuel; S.beacon=d.beacon; S.victoryShown=d.victoryShown;
  S.station=d.station||[]; S.stationOnline=!!d.stationOnline;
  S.pendingCutscene=d.pc; SND.on=d.sound;
  S.weapons=d.weapons; S.ammo=d.ammo; S.medkits=d.medkits; S.headbob=d.headbob; S.slot=0;
}
function exportSave(){
  const code=btoa(unescape(encodeURIComponent(JSON.stringify(buildSaveObj()))));
  const done=()=>showToast('Save code copied to clipboard');
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(code).then(done).catch(()=>fallbackCopy(code,done));
  } else fallbackCopy(code,done);
}
function fallbackCopy(text,done){
  try{
    const ta=document.createElement('textarea'); ta.value=text;
    ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
  }catch(e){ $('importWrap').classList.remove('hidden'); $('importBox').value=text; showToast('Copy the code from the box below'); }
}
function importSave(code){
  let json=code.trim();
  try{ json=decodeURIComponent(escape(atob(json))); }catch(e){ /* maybe raw JSON */ }
  const d=parseSave(json);
  if(!d){ showToast('Invalid save code'); SND.denied(); return false; }
  try{ localStorage.setItem(SAVE_KEY, json); }catch(e){}
  return d;
}

/* ============================================================
   RENDERER / SCENES / SHARED RESOURCES
   ============================================================ */
let renderer,camera;
try{
  renderer=new THREE.WebGLRenderer({canvas:$('c'),antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.setSize(window.innerWidth,window.innerHeight);
}catch(e){
  document.body.innerHTML='<div style="color:#9fdcf5;padding:40px;font-size:18px">Astravox requires WebGL, which this browser does not support.</div>';
  throw e;
}
camera=new THREE.PerspectiveCamera(74,window.innerWidth/window.innerHeight,0.1,3000);
camera.rotation.order='YXZ';
window.addEventListener('resize',()=>{
  camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);
});

const spaceScene=new THREE.Scene();
const surfScene=new THREE.Scene();
let activeScene=spaceScene;

/* shared geometries */
const GEO={
  box:new THREE.BoxGeometry(1,1,1),
  cyl:new THREE.CylinderGeometry(0.5,0.5,1,10),
  sphere:new THREE.SphereGeometry(0.5,12,9),
  cone:new THREE.ConeGeometry(0.5,1,9),
  dome:new THREE.SphereGeometry(1,14,7,0,Math.PI*2,0,Math.PI/2),
  ico:new THREE.IcosahedronGeometry(0.5,0),
  dodec:new THREE.DodecahedronGeometry(0.5,0),
  torus:new THREE.TorusGeometry(0.5,0.07,8,18),
};
/* shared materials */
function stdMat(c,opt){ return new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:0.65,metalness:0.35},opt||{})); }
function emisMat(c,e,i){ return new THREE.MeshStandardMaterial({color:c,emissive:e,emissiveIntensity:i||1.6,roughness:0.4,metalness:0.1}); }
const MAT={
  metal:stdMat(0x9babb8),
  dark:stdMat(0x46525e,{roughness:0.5,metalness:0.6}),
  trim:stdMat(0x5a7a8e,{roughness:0.45,metalness:0.5}),
  glass:new THREE.MeshStandardMaterial({color:0xaee6ff,transparent:true,opacity:0.32,roughness:0.1,metalness:0.2,side:THREE.DoubleSide}),
  doorM:emisMat(0x3a4654,0x16384a,0.4),
  emisC:emisMat(0x9feaff,0x2fb6e8,1.8),
  emisW:emisMat(0xffffff,0xdfeaf0,1.7),
  emisO:emisMat(0xffb070,0xcc5510,1.4),
  emisR:emisMat(0xff7a6a,0xcc2210,1.7),
  emisG:emisMat(0x8affa8,0x10cc44,1.7),
  emisB:emisMat(0x7aa8ff,0x1040cc,1.7),
  beam:new THREE.MeshBasicMaterial({color:0x9fffc8,transparent:true,opacity:0.28,blending:THREE.AdditiveBlending,depthWrite:false}),
  holo:new THREE.MeshBasicMaterial({color:0x5fe0ff,transparent:true,opacity:0.7,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}),
  flagM:emisMat(0xff6a4a,0x661505,0.6),
  pot:stdMat(0x7a5a40,{roughness:0.9,metalness:0.05}),
  plant:emisMat(0x4adf6a,0x0a5520,0.7),
  cloth:stdMat(0x35628a,{roughness:0.9,metalness:0.02}),
  rug:stdMat(0x6a3a5a,{roughness:0.95,metalness:0.0}),
  wood:stdMat(0x7a5a3a,{roughness:0.85,metalness:0.05}),
  screen:new THREE.MeshBasicMaterial({color:0x5fe0ff,transparent:true,opacity:0.8,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}),
  solar:new THREE.MeshStandardMaterial({color:0x12306a,emissive:0x0a2050,emissiveIntensity:0.6,roughness:0.4,metalness:0.5}),
  ghostOk:new THREE.MeshBasicMaterial({color:0x4aff8a,transparent:true,opacity:0.42,depthWrite:false}),
  ghostBad:new THREE.MeshBasicMaterial({color:0xff5040,transparent:true,opacity:0.42,depthWrite:false}),
};

/* glow sprite texture (procedural radial gradient) */
function makeGlowTex(){
  const cv=document.createElement('canvas'); cv.width=cv.height=64;
  const g=cv.getContext('2d');
  const gr=g.createRadialGradient(32,32,2,32,32,30);
  gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(0.35,'rgba(255,255,255,0.45)'); gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=gr; g.fillRect(0,0,64,64);
  const t=new THREE.CanvasTexture(cv); return t;
}
const GLOW_TEX=makeGlowTex();
const glowMatCache={};
function glowMat(color){
  if(!glowMatCache[color]) glowMatCache[color]=new THREE.SpriteMaterial({map:GLOW_TEX,color,transparent:true,opacity:0.85,blending:THREE.AdditiveBlending,depthWrite:false});
  return glowMatCache[color];
}
function makeGlow(color,scale){
  const sp=new THREE.Sprite(glowMat(color)); sp.scale.set(scale,scale,1); return sp;
}

/* ============================================================
   PARTICLE POOL (shared between scenes)
   ============================================================ */
const PMAX=900;
const pPos=new Float32Array(PMAX*3), pCol=new Float32Array(PMAX*3), pVel=new Float32Array(PMAX*3),
      pLife=new Float32Array(PMAX), pGrav=new Float32Array(PMAX);
let pHead=0;
const pGeo=new THREE.BufferGeometry();
pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));
pGeo.setAttribute('color',new THREE.BufferAttribute(pCol,3));
for(let i=0;i<PMAX;i++){ pPos[i*3+1]=-9999; }
const pMat=new THREE.PointsMaterial({size:0.34,vertexColors:true,transparent:true,opacity:0.95,depthWrite:false,sizeAttenuation:true});
const particles=new THREE.Points(pGeo,pMat);
particles.frustumCulled=false;
const tmpColor=new THREE.Color();
function spawnBurst(x,y,z,color,n,spread,up,life,grav){
  tmpColor.set(color);
  for(let k=0;k<n;k++){
    const i=pHead; pHead=(pHead+1)%PMAX;
    pPos[i*3]=x; pPos[i*3+1]=y; pPos[i*3+2]=z;
    pVel[i*3]=(Math.random()-0.5)*spread;
    pVel[i*3+1]=Math.random()*up+up*0.2;
    pVel[i*3+2]=(Math.random()-0.5)*spread;
    pCol[i*3]=tmpColor.r; pCol[i*3+1]=tmpColor.g; pCol[i*3+2]=tmpColor.b;
    pLife[i]=life*(0.6+Math.random()*0.7); pGrav[i]=grav===undefined?6:grav;
  }
}
function updateParticles(dt){
  let any=false;
  for(let i=0;i<PMAX;i++){
    if(pLife[i]<=0) continue; any=true;
    pLife[i]-=dt;
    if(pLife[i]<=0){ pPos[i*3+1]=-9999; continue; }
    pVel[i*3+1]-=pGrav[i]*dt;
    pPos[i*3]+=pVel[i*3]*dt; pPos[i*3+1]+=pVel[i*3+1]*dt; pPos[i*3+2]+=pVel[i*3+2]*dt;
  }
  if(any){ pGeo.attributes.position.needsUpdate=true; pGeo.attributes.color.needsUpdate=true; }
}

/* ============================================================
   SPACE SCENE — sun, stars, planets, asteroids, ship
   ============================================================ */
spaceScene.background=new THREE.Color(0x01030a);
{
  const amb=new THREE.AmbientLight(0x404a60,0.7); spaceScene.add(amb);
  const sunLight=new THREE.PointLight(0xfff0d8,2.6,0,0); spaceScene.add(sunLight);
}
/* stars */
{
  const n=2600, sp=new Float32Array(n*3), sc=new Float32Array(n*3), rng=mulberry32(99);
  for(let i=0;i<n;i++){
    const r=1400+rng()*900, th=rng()*Math.PI*2, ph=Math.acos(rng()*2-1);
    sp[i*3]=r*Math.sin(ph)*Math.cos(th); sp[i*3+1]=r*Math.cos(ph); sp[i*3+2]=r*Math.sin(ph)*Math.sin(th);
    const b=0.5+rng()*0.5, tint=rng();
    sc[i*3]=b*(tint>0.8?0.8:1); sc[i*3+1]=b*0.95; sc[i*3+2]=b*(tint<0.2?0.85:1);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(sp,3));
  g.setAttribute('color',new THREE.BufferAttribute(sc,3));
  const stars=new THREE.Points(g,new THREE.PointsMaterial({size:2.4,vertexColors:true,sizeAttenuation:false,depthWrite:false}));
  stars.frustumCulled=false;
  spaceScene.add(stars);
}
/* sun */
{
  const sun=new THREE.Mesh(new THREE.SphereGeometry(38,24,18),new THREE.MeshBasicMaterial({color:0xffe8b0}));
  sun.position.set(0,0,0); spaceScene.add(sun);
  const halo=makeGlow('#ffdf9a',260); spaceScene.add(halo);
}
/* asteroids */
{
  const im=new THREE.InstancedMesh(GEO.dodec,stdMat(0x6a6258,{roughness:0.95,metalness:0.1}),90);
  const d=new THREE.Object3D(), rng=mulberry32(777);
  for(let i=0;i<90;i++){
    const r=320+rng()*500, th=rng()*Math.PI*2;
    d.position.set(Math.cos(th)*r,(rng()-0.5)*160,Math.sin(th)*r);
    d.rotation.set(rng()*6,rng()*6,rng()*6);
    const s=2+rng()*7; d.scale.set(s,s*(0.7+rng()*0.6),s);
    d.updateMatrix(); im.setMatrixAt(i,d.matrix);
  }
  im.instanceMatrix.needsUpdate=true; spaceScene.add(im);
}
/* planets (space view) */
const spacePlanets={};
/* signal-interference shields: planet visible from orbit but un-landable until tier */
const SHIELDED={ verdant:{tier:3,col:0xb05aff,wire:0xd08aff,res:'Biolume'},
                 pelagos:{tier:5,col:0x36c6ff,wire:0x8af0ff,res:'Abyssal Pearl'} };
const shieldGroups={};
for(const key in PLANETS){
  const p=PLANETS[key];
  const m=new THREE.Mesh(new THREE.SphereGeometry(p.r,28,20),
    new THREE.MeshStandardMaterial({color:p.surfCol,roughness:0.9,metalness:0.05,emissive:p.surfCol2,emissiveIntensity:0.12}));
  m.position.set(p.pos[0],p.pos[1],p.pos[2]);
  spaceScene.add(m);
  const atmo=makeGlow('#'+new THREE.Color(p.surfCol).offsetHSL(0,0.1,0.25).getHexString(),p.r*3.4);
  atmo.position.copy(m.position); spaceScene.add(atmo);
  spacePlanets[key]=m;
}
for(const key in SHIELDED){ /* signal-interference shields (verdant, pelagos) */
  const cfg=SHIELDED[key], p=PLANETS[key];
  const grp=new THREE.Group();
  const sh=new THREE.Mesh(new THREE.SphereGeometry(p.r*1.18,24,16),
    new THREE.MeshBasicMaterial({color:cfg.col,transparent:true,opacity:0.22,blending:THREE.AdditiveBlending,depthWrite:false}));
  const wire=new THREE.Mesh(new THREE.IcosahedronGeometry(p.r*1.2,1),
    new THREE.MeshBasicMaterial({color:cfg.wire,wireframe:true,transparent:true,opacity:0.4,depthWrite:false}));
  sh.material.userData={o0:0.22}; wire.material.userData={o0:0.4};
  grp.add(sh); grp.add(wire);
  grp.position.set(p.pos[0],p.pos[1],p.pos[2]);
  spaceScene.add(grp); shieldGroups[key]=grp;
}

/* ship (primitive-built, reused in space + landed on surface) */
function buildShip(){
  const g=new THREE.Group();
  const body=new THREE.Mesh(GEO.cyl,stdMat(0xb8c4d0,{metalness:0.6,roughness:0.35}));
  body.scale.set(2.2,5.4,2.2); body.rotation.x=Math.PI/2; g.add(body);
  const nose=new THREE.Mesh(GEO.cone,stdMat(0x8a98a8,{metalness:0.6,roughness:0.3}));
  nose.scale.set(2.2,2.6,2.2); nose.rotation.x=-Math.PI/2; nose.position.z=-4; g.add(nose);
  const canopy=new THREE.Mesh(GEO.sphere,new THREE.MeshStandardMaterial({color:0x4adfff,roughness:0.1,metalness:0.3,emissive:0x0a4a66,emissiveIntensity:0.8}));
  canopy.scale.set(1.5,1.1,2.2); canopy.position.set(0,1,-1.2); g.add(canopy);
  for(const sx of [-1,1]){
    const wing=new THREE.Mesh(GEO.box,stdMat(0x7a88a0,{metalness:0.55,roughness:0.4}));
    wing.scale.set(4.4,0.22,2.6); wing.position.set(sx*3,-0.3,1.2); wing.rotation.z=sx*-0.12; g.add(wing);
    const tip=new THREE.Mesh(GEO.sphere,MAT.emisR);
    tip.scale.set(0.3,0.3,0.3); tip.position.set(sx*5.1,-0.55,1.2); g.add(tip);
  }
  const engine=new THREE.Mesh(GEO.cyl,stdMat(0x4a5260,{metalness:0.7,roughness:0.3}));
  engine.scale.set(1.4,1.2,1.4); engine.rotation.x=Math.PI/2; engine.position.z=3.2; g.add(engine);
  const engGlow=makeGlow('#7fd6ff',5); engGlow.position.set(0,0,4.2); engGlow.name='engGlow'; g.add(engGlow);
  const legs=new THREE.Group(); legs.name='legs';
  for(const [lx,lz] of [[-1.8,1.8],[1.8,1.8],[0,-2.6]]){
    const leg=new THREE.Mesh(GEO.cyl,MAT.dark);
    leg.scale.set(0.24,2.4,0.24); leg.position.set(lx,-1.7,lz); leg.rotation.z=lx*0.18; legs.add(leg);
  }
  g.add(legs);
  return g;
}
const ship=buildShip();
spaceScene.add(ship);
ship.position.fromArray(S.spos);

/* ---------- orbital station (Phase 7): core + placed pieces ---------- */
function buildStationCore(){
  const g=new THREE.Group();
  const hub=new THREE.Mesh(GEO.sphere,stdMat(0x8a98a8,{metalness:0.6,roughness:0.4})); hub.scale.set(9,9,9); g.add(hub);
  const ring=new THREE.Mesh(GEO.torus,MAT.metal); ring.scale.set(20,20,20); g.add(ring);
  const ring2=new THREE.Mesh(GEO.torus,MAT.metal); ring2.scale.set(20,20,20); ring2.rotation.x=Math.PI/2; g.add(ring2);
  for(const d of CORE_DIRS){
    const n=new THREE.Mesh(GEO.cyl,MAT.dark); n.scale.set(1.8,2,1.8);
    n.position.copy(d).multiplyScalar(CORE_R-1);
    n.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d);
    g.add(n);
  }
  const beacon=new THREE.Mesh(GEO.sphere,MAT.emisC); beacon.scale.set(2.6,2.6,2.6); beacon.name='coreBeacon'; g.add(beacon);
  return g;
}
const stationGroup=new THREE.Group(); spaceScene.add(stationGroup);   // placed pieces
const stationCore=buildStationCore(); stationCore.position.copy(STATION_POS); stationCore.visible=false; spaceScene.add(stationCore);
const stationGlow=makeGlow('#8fe8ff',150); stationGlow.position.copy(STATION_POS); stationGlow.visible=false; spaceScene.add(stationGlow);

/* ============================================================
   REMOTE PLAYERS — co-op avatars, ships, name tags
   ============================================================ */
const remotes=new Map();
const SLOT_COLORS=[0x4fc3ff,0xffb04f,0x7fff9a,0xff7ab0];
function makeNameTag(name){
  const cv=document.createElement('canvas'); cv.width=256; cv.height=64;
  const g=cv.getContext('2d');
  g.font='bold 30px Segoe UI, Arial, sans-serif';
  g.textAlign='center'; g.textBaseline='middle';
  g.shadowColor='rgba(0,0,0,0.9)'; g.shadowBlur=8;
  g.fillStyle='#bdf0ff';
  g.fillText(String(name).toUpperCase().slice(0,14),128,32);
  const tex=new THREE.CanvasTexture(cv);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  sp.scale.set(3,0.75,1);
  return sp;
}
function buildHeldWeapon(kind){
  const g=new THREE.Group(); g.name='w_'+kind;
  if(kind==='blade'){
    const h=new THREE.Mesh(GEO.box,MAT.dark); h.scale.set(0.05,0.14,0.05); g.add(h);
    const e=new THREE.Mesh(GEO.box,MAT.emisC); e.scale.set(0.03,0.6,0.012); e.position.y=0.36; g.add(e);
  } else if(kind==='pistol'){
    const b=new THREE.Mesh(GEO.box,MAT.metal); b.scale.set(0.07,0.09,0.24); b.position.set(0,0,-0.06); g.add(b);
    const gr=new THREE.Mesh(GEO.box,MAT.dark); gr.scale.set(0.06,0.14,0.07); gr.position.set(0,-0.09,0.03); g.add(gr);
    const mz=new THREE.Mesh(GEO.sphere,emisMat(0xffd060,0xcc8000,1.8)); mz.scale.set(0.04,0.04,0.04); mz.position.set(0,0,-0.2); g.add(mz);
  } else if(kind==='rifle'){
    const b=new THREE.Mesh(GEO.box,MAT.dark); b.scale.set(0.07,0.1,0.46); b.position.set(0,0,-0.12); g.add(b);
    const br=new THREE.Mesh(GEO.cyl,MAT.metal); br.scale.set(0.03,0.32,0.03); br.rotation.x=Math.PI/2; br.position.set(0,0,-0.34); g.add(br);
    const mz=new THREE.Mesh(GEO.sphere,emisMat(0x7fff9a,0x10cc44,1.8)); mz.scale.set(0.045,0.045,0.045); mz.position.set(0,0,-0.5); g.add(mz);
  } else { /* tool */
    const b=new THREE.Mesh(GEO.cyl,MAT.metal); b.scale.set(0.05,0.34,0.05); b.rotation.x=Math.PI/2; b.position.set(0,0,-0.12); g.add(b);
    const e=new THREE.Mesh(GEO.sphere,MAT.emisC); e.scale.set(0.06,0.06,0.06); e.position.set(0,0,-0.28); g.add(e);
  }
  g.rotation.x=Math.PI/2; g.visible=false;
  return g;
}
function buildAvatar(slot,name){
  const g=new THREE.Group();
  const tint=new THREE.MeshStandardMaterial({color:SLOT_COLORS[slot%4],emissive:SLOT_COLORS[slot%4],emissiveIntensity:0.6,roughness:0.5});
  const suit=stdMat(0xd8dde4,{roughness:0.7});
  const body=new THREE.Mesh(GEO.cyl,suit); body.scale.set(0.55,0.75,0.4); body.position.y=0.85; g.add(body);
  const helmet=new THREE.Mesh(GEO.sphere,new THREE.MeshStandardMaterial({color:0x9fd8ff,roughness:0.15,metalness:0.3,emissive:0x16384a,emissiveIntensity:0.6}));
  helmet.scale.set(0.44,0.44,0.44); helmet.position.y=1.45; g.add(helmet);
  const pack=new THREE.Mesh(GEO.box,MAT.dark); pack.scale.set(0.42,0.55,0.22); pack.position.set(0,0.95,0.28); g.add(pack);
  const stripe=new THREE.Mesh(GEO.box,tint); stripe.scale.set(0.58,0.1,0.44); stripe.position.y=1.16; g.add(stripe);
  /* limbs as hip/shoulder-pivoted groups */
  const mkLimb=(nm,hx,hy,sc)=>{ const grp=new THREE.Group(); grp.name=nm; grp.position.set(hx,hy,0);
    const seg=new THREE.Mesh(GEO.cyl,suit); seg.scale.set(sc,0.5,sc); seg.position.y=-0.25; grp.add(seg); g.add(grp); return grp; };
  mkLimb('legL',-0.15,0.52,0.16); mkLimb('legR',0.15,0.52,0.16);
  mkLimb('armL',-0.38,1.12,0.13);
  const armR=mkLimb('armR',0.38,1.12,0.13);
  /* held weapon mount in right hand */
  const hand=new THREE.Group(); hand.name='hand'; hand.position.set(0,-0.46,0.05);
  for(const k of ['tool','blade','pistol','rifle']) hand.add(buildHeldWeapon(k));
  armR.add(hand);
  /* spawn-protection shimmer */
  const shimmer=new THREE.Mesh(GEO.sphere,new THREE.MeshBasicMaterial({color:0x9fe8ff,transparent:true,opacity:0.22,blending:THREE.AdditiveBlending,depthWrite:false}));
  shimmer.scale.set(1.0,1.5,1.0); shimmer.position.y=0.9; shimmer.name='shimmer'; shimmer.visible=false; g.add(shimmer);
  const tag=makeNameTag(name); tag.position.y=2.2; g.add(tag);
  g.visible=false;
  return g;
}
function addRemote(pid,name,slot){
  if(remotes.has(pid)) removeRemote(pid);
  const av=buildAvatar(slot,name);
  surfScene.add(av);
  const shp=buildShip();
  const legs=shp.getObjectByName('legs'); if(legs) legs.visible=false;
  const tag=makeNameTag(name); tag.position.y=4.4; shp.add(tag);
  shp.visible=false;
  spaceScene.add(shp);
  const hand=av.getObjectByName('hand');
  remotes.set(pid,{name,slot,snaps:[],mode:'space',pl:'rust',avatar:av,ship:shp,wp:0,iv:false,dr:0,swingT:0,animPhase:0,_spd:0,
    legL:av.getObjectByName('legL'),legR:av.getObjectByName('legR'),armL:av.getObjectByName('armL'),armR:av.getObjectByName('armR'),
    shimmer:av.getObjectByName('shimmer'),
    weps:{tool:hand.getObjectByName('w_tool'),blade:hand.getObjectByName('w_blade'),pistol:hand.getObjectByName('w_pistol'),rifle:hand.getObjectByName('w_rifle')}});
}
function removeRemote(pid){
  const r=remotes.get(pid); if(!r) return;
  surfScene.remove(r.avatar); spaceScene.remove(r.ship);
  remotes.delete(pid);
}
function clearRemotes(){ for(const pid of [...remotes.keys()]) removeRemote(pid); }
function remotePU(m){
  const r=remotes.get(m.pid); if(!r) return;
  r.mode=m.mode; r.pl=m.pl; r.wp=m.wp|0; r.iv=!!m.iv; r.dr=m.dr|0; if(m.sw) r.swingT=0.26;
  r.snaps.push({t:performance.now(),x:m.pos[0],y:m.pos[1],z:m.pos[2],yaw:m.yaw,pitch:m.pitch});
  if(r.snaps.length>12) r.snaps.shift();
}
function updateRemotes(dt){
  if(!NET.active) return;
  dt=dt||0.016;
  const rt=performance.now()-120;
  for(const r of remotes.values()){
    const sn=r.snaps;
    const surfVis=S.mode==='surface'&&r.mode==='surface'&&r.pl===S.planet&&sn.length>0;
    const spaceVis=S.mode==='space'&&r.mode==='space'&&sn.length>0;
    r.avatar.visible=surfVis;
    r.ship.visible=spaceVis;
    if(!sn.length||(!surfVis&&!spaceVis)) continue;
    let a=sn[sn.length-1], b=a, k=1;
    for(let i=sn.length-1;i>0;i--){
      if(sn[i-1].t<=rt){ a=sn[i-1]; b=sn[i]; break; }
    }
    if(b.t>a.t) k=clamp((rt-a.t)/(b.t-a.t),0,1);
    if(performance.now()-b.t>700){ a=b; k=1; }
    let dy=b.yaw-a.yaw;
    dy=((dy+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
    const x=lerp(a.x,b.x,k), y=lerp(a.y,b.y,k), z=lerp(a.z,b.z,k), yaw=a.yaw+dy*k;
    if(surfVis){
      r.avatar.position.set(x,y,z);
      r.avatar.rotation.y=yaw;
      animateAvatar(r,x,y,z,dt);
    } else {
      r.ship.position.set(x,y,z);
      r.ship.rotation.order='YXZ';
      r.ship.rotation.set(lerp(a.pitch,b.pitch,k),yaw,0);
    }
  }
}
function animateAvatar(r,x,y,z,dt){
  /* horizontal speed from last two snapshots */
  const sn=r.snaps; let spd=0;
  if(sn.length>=2){ const p=sn[sn.length-1], q=sn[sn.length-2], ddt=(p.t-q.t)/1000;
    if(ddt>0) spd=Math.hypot(p.x-q.x,p.z-q.z)/ddt; }
  r._spd=lerp(r._spd,spd,0.3);
  const ground=terrainH(x,z,curP());
  const airborne=(y-ground)>0.7&&!r.dr;
  const moving=r._spd>0.6&&!airborne&&!r.dr;
  if(airborne){
    r.legL.rotation.x=-0.5; r.legR.rotation.x=0.45; r.armL.rotation.x=-1.3; r.armR.rotation.x=-0.7;
  } else if(moving){
    r.animPhase+=dt*Math.min(15,5+r._spd*1.5);
    const s=Math.sin(r.animPhase)*0.7;
    r.legL.rotation.x=s; r.legR.rotation.x=-s;
    r.armL.rotation.x=-s*0.8; r.armR.rotation.x=s*0.5;
  } else {
    r.legL.rotation.x=lerp(r.legL.rotation.x,0,0.2); r.legR.rotation.x=lerp(r.legR.rotation.x,0,0.2);
    r.armL.rotation.x=lerp(r.armL.rotation.x,Math.sin(performance.now()*0.002)*0.04,0.2);
    r.armR.rotation.x=lerp(r.armR.rotation.x,r.wp>0?-0.5:-0.2,0.2);
  }
  if(r.swingT>0){ r.swingT-=dt; r.armR.rotation.x=-1.3*Math.sin((1-r.swingT/0.26)*Math.PI); }
  const w=r.weps;
  w.tool.visible=(r.wp===0); w.blade.visible=(r.wp===1); w.pistol.visible=(r.wp===2); w.rifle.visible=(r.wp===3);
  r.shimmer.visible=!!r.iv;
  r.avatar.visible=!r.dr;   // hide on-foot avatar while driving (rover shows them)
}
function sendPU(){
  if(S.mode==='surface'){
    NET.send({t:'pu',pos:[+player.x.toFixed(2),+player.y.toFixed(2),+player.z.toFixed(2)],
      yaw:+player.yaw.toFixed(3),pitch:+player.pitch.toFixed(3),mode:'surface',pl:S.planet,
      wp:S.slot, iv:player.invuln>0?1:0, dr:driving?driving.id:0, sw:swingT>0?1:0,
      sp:puSprint?1:0, jt:puJet?1:0});
  } else if(S.mode==='eva'){
    NET.send({t:'pu',pos:[+evaPos.x.toFixed(1),+evaPos.y.toFixed(1),+evaPos.z.toFixed(1)],
      yaw:+evaYaw.toFixed(3),pitch:+evaPitch.toFixed(3),mode:'space',pl:S.planet,ev:1});
  } else {
    NET.send({t:'pu',pos:[+ship.position.x.toFixed(1),+ship.position.y.toFixed(1),+ship.position.z.toFixed(1)],
      yaw:+S.syaw.toFixed(3),pitch:+S.spitch.toFixed(3),mode:'space',pl:S.planet});
  }
}

/* ============================================================
   SURFACE SCENE (rebuilt per landing)
   ============================================================ */
/* WORLD_R imported from shared/constants.js; terrainH/terrainHWater from
   shared/world.js — same deterministic heightfield on client and server */
let surf={built:false, planet:null, terrain:null, group:null, nodes:[], nodeMesh:null,
          shipPos:new THREE.Vector3(), domes:[], glows:[], dirLight:null, water:null};
function curP(){ return PLANETS[S.planet]; }
function isDeepWater(x,z){ return curP().water && terrainH(x,z,curP()) < SEA_Y-1.6; }
function updateWater(){
  if(!surf.water) return;
  const t=performance.now()*0.001, pos=surf.water.geo.attributes.position, base=surf.water.base;
  for(let i=0;i<pos.count;i++){
    const x=base[i*3], z=base[i*3+2];
    pos.setY(i, Math.sin(x*0.06+t*1.1)*0.34 + Math.sin(z*0.045+t*0.85)*0.3 + Math.sin((x+z)*0.03+t*1.6)*0.16);
  }
  pos.needsUpdate=true;
}

function buildSurface(planetKey){
  /* tear down previous */
  if(surf.group){ surfScene.remove(surf.group); surf.group.traverse(o=>{ if(o.geometry&&!Object.values(GEO).includes(o.geometry)) o.geometry.dispose(); }); }
  if(surf.dirLight){ surfScene.remove(surf.dirLight); surfScene.remove(surf.dirLight.target); }
  surfScene.children.slice().forEach(c=>{ if(c.isLight) surfScene.remove(c); });

  S.planet=planetKey;
  const p=PLANETS[planetKey];
  const g=new THREE.Group();
  surf.group=g; surf.planet=planetKey; surf.built=true;
  surfScene.background=new THREE.Color(p.sky);
  surfScene.fog=new THREE.Fog(p.fog,60,420);

  /* lights */
  const hemi=new THREE.HemisphereLight(p.sun,p.surfCol2,0.85); surfScene.add(hemi);
  const dl=new THREE.DirectionalLight(p.sun,1.25); dl.position.set(120,180,60); surfScene.add(dl); surfScene.add(dl.target);
  surf.dirLight=dl; surf.hemi=hemi;
  const amb=new THREE.AmbientLight(0x404050,0.45); surfScene.add(amb);
  surf.amb=amb;

  /* terrain */
  const seg=120, size=820;
  const tg=new THREE.PlaneGeometry(size,size,seg,seg);
  tg.rotateX(-Math.PI/2);
  const pos=tg.attributes.position;
  const cols=new Float32Array(pos.count*3);
  const c1=new THREE.Color(p.surfCol), c2=new THREE.Color(p.surfCol2), cc=new THREE.Color();
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), z=pos.getZ(i);
    const h=terrainH(x,z,p);
    pos.setY(i,h);
    const t=clamp(0.5+h*0.06+ (vnoise(x*0.08,z*0.08,p.seed+51)-0.5)*0.5,0,1);
    cc.copy(c2).lerp(c1,t);
    cols[i*3]=cc.r; cols[i*3+1]=cc.g; cols[i*3+2]=cc.b;
  }
  tg.setAttribute('color',new THREE.BufferAttribute(cols,3));
  tg.computeVertexNormals();
  const terrain=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,metalness:0.02}));
  g.add(terrain); surf.terrain=terrain;

  /* horizon skirt */
  const skirt=new THREE.Mesh(new THREE.RingGeometry(size*0.49,1600,32),
    new THREE.MeshBasicMaterial({color:p.fog,side:THREE.DoubleSide}));
  skirt.rotation.x=-Math.PI/2; skirt.position.y=-4; g.add(skirt);

  /* water plane (Pelagos) — transparent, cheap vertex waves */
  surf.water=null;
  if(p.water){
    const wseg=40, wsize=940;
    const wg=new THREE.PlaneGeometry(wsize,wsize,wseg,wseg);
    wg.rotateX(-Math.PI/2);
    const water=new THREE.Mesh(wg,new THREE.MeshStandardMaterial({color:0x2bb4ae,transparent:true,opacity:0.62,roughness:0.18,metalness:0.45,side:THREE.DoubleSide}));
    water.position.y=SEA_Y; g.add(water);
    surf.water={mesh:water,geo:wg,base:wg.attributes.position.array.slice()};
  }

  /* rocks / flora / resource nodes — deterministic shared layout
     (the server validates mining against the SAME node data) */
  const layout=surfaceLayout(p);
  {
    const im=new THREE.InstancedMesh(GEO.dodec,stdMat(p.rockCol,{roughness:0.95,metalness:0.05}),layout.rocks.length);
    const d=new THREE.Object3D();
    layout.rocks.forEach((rk,i)=>{
      d.position.set(rk.x,terrainH(rk.x,rk.z,p)+0.1,rk.z);
      d.rotation.set(rk.rx,rk.ry,rk.rz);
      d.scale.set(rk.s,rk.sy,rk.s);
      d.updateMatrix(); im.setMatrixAt(i,d.matrix);
    });
    im.instanceMatrix.needsUpdate=true; g.add(im);
  }
  /* flora / planet-specific props (instanced) */
  {
    const isV=planetKey==='verdant';
    const mat=isV? emisMat(p.floraCol,0x5a1a8a,0.8) : stdMat(p.floraCol,{roughness:0.85});
    const geo=isV? GEO.sphere : GEO.cone;
    const im=new THREE.InstancedMesh(geo,mat,layout.flora.length);
    const d=new THREE.Object3D();
    layout.flora.forEach((f,i)=>{
      d.position.set(f.x,terrainH(f.x,f.z,p)+(isV? f.s*0.8 : f.s*0.5),f.z);
      d.rotation.set(0,f.ry,0);
      d.scale.set(f.s*(isV?1:0.7),f.s*1.6,f.s*(isV?1:0.7));
      d.updateMatrix(); im.setMatrixAt(i,d.matrix);
    });
    im.instanceMatrix.needsUpdate=true; g.add(im);
  }
  /* resource nodes (instanced crystals) */
  {
    surf.nodes=[];
    const im=new THREE.InstancedMesh(GEO.ico,emisMat(p.nodeCol,p.nodeEmis,1.9),layout.nodes.length);
    const d=new THREE.Object3D();
    layout.nodes.forEach((nd,i)=>{
      surf.nodes.push({x:nd.x,y:nd.y,z:nd.z,s:nd.s,alive:true,respawn:0,rot:nd.rot});
      d.position.set(nd.x,nd.y+nd.s*0.45,nd.z);
      d.rotation.set(nd.tx,nd.ty,nd.tz);
      d.scale.set(nd.s,nd.s*1.7,nd.s);
      d.updateMatrix(); im.setMatrixAt(i,d.matrix);
    });
    im.instanceMatrix.needsUpdate=true; surf.nodeMesh=im; g.add(im);
    const glows=new THREE.Group();
    for(const nd of surf.nodes){
      const gl=makeGlow('#'+new THREE.Color(p.nodeCol).getHexString(),2.4);
      gl.position.set(nd.x,nd.y+nd.s,nd.z); glows.add(gl); nd.glow=gl;
    }
    g.add(glows);
  }
  /* landed ship position */
  const sx=8, sz=2;
  surf.shipPos.set(sx,terrainH(sx,sz,p)+2.3,sz);

  surfScene.add(g);
  refreshStructures();
  if(NET.active&&NET.deadNodes[planetKey]){
    for(const i of NET.deadNodes[planetKey]){
      if(surf.nodes[i]){ surf.nodes[i].alive=false; nodeMatrixUpdate(i); }
    }
  }
}
function nodeMatrixUpdate(i){
  const nd=surf.nodes[i], d=new THREE.Object3D();
  d.position.set(nd.x,nd.y+nd.s*0.45,nd.z);
  d.rotation.set(0,nd.rot,0);
  const sc=nd.alive?1:0.0001;
  d.scale.set(nd.s*sc,nd.s*1.7*sc,nd.s*sc);
  d.updateMatrix(); surf.nodeMesh.setMatrixAt(i,d.matrix);
  surf.nodeMesh.instanceMatrix.needsUpdate=true;
  if(nd.glow) nd.glow.visible=nd.alive;
}
/* ============================================================
   STRUCTURES — instanced rendering, placement, damage
   ============================================================ */
const structMeshes={};   // type -> [InstancedMesh per part]
const placedByType={};   // type -> [structure refs] (current planet, index == instanceId)
const structGroup=new THREE.Group();
surfScene.add(structGroup);
const auxGroup=new THREE.Group();   // domes, glows, beams
surfScene.add(auxGroup);

for(const t in CAT){
  const def=CAT[t];
  if(def.dynamic){ structMeshes[t]=[]; continue; }   // rovers render as their own groups
  structMeshes[t]=def.parts.map(part=>{
    const im=new THREE.InstancedMesh(GEO[part.g],MAT[part.m],MAX_STRUCT);
    im.count=0; im.userData.stype=t; im.frustumCulled=false;
    im.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(MAX_STRUCT*3).fill(1),3);
    structGroup.add(im);
    return im;
  });
}
const _m1=new THREE.Matrix4(), _m2=new THREE.Matrix4(), _q=new THREE.Quaternion(),
      _e=new THREE.Euler(), _v=new THREE.Vector3(), _sv=new THREE.Vector3(), _pc=new THREE.Color();

function structMatrix(st,part,out,slideX){
  _e.set(0,st.r*Math.PI/2,0); _q.setFromEuler(_e);
  _m1.compose(_v.set(st.x,st.y,st.z),_q,_sv.set(1,1,1));
  const pr=part.r||[0,0,0];
  _e.set(pr[0],pr[1],pr[2]);
  _m2.compose(_v.set(part.o[0]+(slideX||0),part.o[1],part.o[2]),_q.setFromEuler(_e),_sv.set(part.s[0],part.s[1],part.s[2]));
  out.multiplyMatrices(_m1,_m2);
}
/* world->local for a structure rotated by r*90° (matches three.js R_y) */
function toLocal(st,wx,wz,out){
  const a=st.r*Math.PI/2, c=Math.cos(a), s=Math.sin(a);
  const dx=wx-st.x, dz=wz-st.z;
  out.lx=dx*c-dz*s; out.lz=dx*s+dz*c; out.c=c; out.s=s;
}
function refreshStructures(){
  for(const t in CAT) placedByType[t]=[];
  for(const st of S.structures){ if(st.pl===S.planet) placedByType[st.t].push(st); if(st.t==='door') st.open=0; }
  const M=new THREE.Matrix4();
  for(const t in CAT){
    const def=CAT[t];
    if(def.dynamic) continue;
    const list=placedByType[t];
    def.parts.forEach((part,pi)=>{
      const im=structMeshes[t][pi];
      im.count=list.length;
      for(let i=0;i<list.length;i++){
        structMatrix(list[i],part,M); im.setMatrixAt(i,M);
        const c=list[i].col; _pc.set(c!=null?c:0xffffff); im.setColorAt(i,_pc);
      }
      im.instanceMatrix.needsUpdate=true;
      if(im.instanceColor) im.instanceColor.needsUpdate=true;
    });
  }
  rebuildAux();
  syncRovers();
  updateCapNote();
}
let shieldDomes=[];   // {x,y,z,r,mesh,st}
const structGlows=[]; // lamp/beacon glow sprites — brightened at night (own material so node/rover glows stay put)
function rebuildAux(){
  while(auxGroup.children.length) auxGroup.remove(auxGroup.children[0]);
  shieldDomes=[]; structGlows.length=0;
  for(const st of S.structures){
    if(st.pl!==S.planet) continue;
    const def=CAT[st.t];
    if(def.glow){
      const gl=makeGlow(def.glow.c,def.glow.s);
      gl.material=gl.material.clone(); gl.userData._o0=gl.material.opacity;  // isolate from shared cached glowMat
      gl.position.set(st.x,st.y+def.glow.y,st.z); auxGroup.add(gl); structGlows.push(gl);
    }
    if(st.t==='shieldgen'&&st.hp>0){
      const dome=new THREE.Mesh(new THREE.SphereGeometry(def.shieldR,20,12,0,Math.PI*2,0,Math.PI/2),
        new THREE.MeshBasicMaterial({color:0x4fc9ff,transparent:true,opacity:0.1,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
      dome.position.set(st.x,st.y,st.z); auxGroup.add(dome);
      const wire=new THREE.Mesh(new THREE.SphereGeometry(def.shieldR,14,8,0,Math.PI*2,0,Math.PI/2),
        new THREE.MeshBasicMaterial({color:0x7fdcff,wireframe:true,transparent:true,opacity:0.07,depthWrite:false}));
      wire.position.copy(dome.position); auxGroup.add(wire);
      shieldDomes.push({x:st.x,y:st.y,z:st.z,r:def.shieldR,mesh:dome,st});
    }
  }
  /* beacon safe-zone ground ring (no PvP inside) */
  const b=beaconOnPlanet(S.planet);
  if(b){
    const ring=new THREE.Mesh(new THREE.RingGeometry(SAFE_R-0.5,SAFE_R,56),
      new THREE.MeshBasicMaterial({color:0x6fffb0,transparent:true,opacity:0.2,side:THREE.DoubleSide,depthWrite:false}));
    ring.rotation.x=-Math.PI/2; ring.position.set(b.x,terrainH(b.x,b.z,curP())+0.12,b.z); auxGroup.add(ring);
  }
}
function structCount(){ return S.structures.length; }
function crateCount(){ return S.structures.filter(s=>s.t==='crate'&&s.hp>0).length; }
function carryCap(){ return R.carryCap(S.structures); }
function updateCapNote(){ $('capNote').textContent='CARRY CAP '+carryCap()+' / RESOURCE · PIECES '+structCount()+'/'+MAX_STRUCT; }

/* ---------- player collision vs structures ---------- */
const PR=0.35;           // player body radius
const _loc={lx:0,lz:0,c:1,s:0};
/* COLLIDERS (collision data) imported from shared/catalog.js */
function doorBoxes(st){
  const b=[{cx:1.45,hx:0.56,hz:0.16},{cx:-1.45,hx:0.56,hz:0.16}];
  if((st.open||0)<0.5) b.push({cx:0,hx:0.9,hz:0.12});
  return b;
}
function collidePlayer(){
  /* landed ship hull */
  if(surf.built){
    const dsx=player.x-surf.shipPos.x, dsz=player.z-surf.shipPos.z;
    const d=Math.hypot(dsx,dsz);
    if(d<3.1&&player.y<surf.shipPos.y+1.6){
      const f=d<0.001?3.1:3.1/d;
      player.x=surf.shipPos.x+dsx*f; player.z=surf.shipPos.z+dsz*f;
    }
  }
  for(let it=0;it<2;it++){
    for(const t in COLLIDERS){
      const col=COLLIDERS[t], list=placedByType[t]||[];
      for(const st of list){
        const dx=player.x-st.x, dz=player.z-st.z;
        if(dx*dx+dz*dz>49) continue;
        const head=player.y+1.7;
        if(col.r!==undefined){          /* cylinder props */
          if(player.y>=st.y+col.h-0.4||head<=st.y) continue;
          const d=Math.hypot(dx,dz), rr=col.r+PR;
          if(d<rr){ const f=d<0.001?rr:rr/d; player.x=st.x+dx*f; player.z=st.z+dz*f; }
          continue;
        }
        toLocal(st,player.x,player.z,_loc);
        let lx=_loc.lx, lz=_loc.lz;
        const c=_loc.c, s=_loc.s;
        if(col.ramp){                   /* solid wedge, walkable on top */
          if(Math.abs(lx)>2+PR||Math.abs(lz)>2+PR) continue;
          const sy2=st.y+0.31+clamp((2-lz)/4,0,1)*3;
          if(player.y>=sy2-0.65||head<=st.y) continue;
          const px=(2+PR)-Math.abs(lx), pzl=(2+PR)-lz, pzh=lz+(2+PR);
          let ox=0,oz=0;
          if(px<=pzl&&px<=pzh) ox=(lx>=0?1:-1)*px;
          else if(pzl<=pzh) oz=pzl; else oz=-pzh;
          player.x+=ox*c+oz*s; player.z+=-ox*s+oz*c;
          continue;
        }
        if(player.y>=st.y+col.h-col.step||head<=st.y) continue;
        const boxes=col.door?doorBoxes(st):col.boxes;
        for(const b of boxes){
          const bx=lx-b.cx;
          const hx=b.hx+PR, hz=b.hz+PR;
          if(Math.abs(bx)>=hx||Math.abs(lz)>=hz) continue;
          const px=hx-Math.abs(bx), pz=hz-Math.abs(lz);
          let ox=0,oz=0;
          if(px<pz) ox=(bx>=0?1:-1)*px; else oz=(lz>=0?1:-1)*pz;
          player.x+=ox*c+oz*s; player.z+=-ox*s+oz*c;
          lx+=ox; lz+=oz;
        }
      }
    }
  }
}
/* doors slide open when the player is near */
const _doorM=new THREE.Matrix4();
function updateDoors(dt){
  const list=placedByType.door||[];
  const def=CAT.door;
  for(let i=0;i<list.length;i++){
    const st=list[i];
    const dx=player.x-st.x, dz=player.z-st.z;
    let near=dx*dx+dz*dz<7.5;
    if(!near&&NET.active){
      for(const r of remotes.values()){
        if(!r.avatar.visible) continue;
        const ax=r.avatar.position.x-st.x, az=r.avatar.position.z-st.z;
        if(ax*ax+az*az<7.5){ near=true; break; }
      }
    }
    const target=near?1:0;
    const cur=st.open||0;
    if(Math.abs(target-cur)<0.005) continue;
    st.open=cur+(target-cur)*Math.min(1,dt*6);
    const slide=st.open*1.55;
    for(const pi of [3,4]){
      structMatrix(st,def.parts[pi],_doorM,slide);
      structMeshes.door[pi].setMatrixAt(i,_doorM);
      structMeshes.door[pi].instanceMatrix.needsUpdate=true;
    }
  }
}

/* walkable height: terrain + floors/ramps/crates — shared logic, S.* state */
function groundYAt(x,z,curY){ return R.groundYAt(S.structures,S.planet,x,z,curY); }

/* ============================================================
   PLAYER (surface) + first-person tool
   ============================================================ */
const player={x:0,y:0,z:0,vy:0,yaw:0,pitch:0,grounded:true,h:1.7,hp:HP_MAX,invuln:0};
const tool=new THREE.Group();
{
  const grip=new THREE.Mesh(GEO.box,MAT.dark); grip.scale.set(0.07,0.2,0.1); grip.position.set(0,-0.07,0.05); tool.add(grip);
  const barrel=new THREE.Mesh(GEO.cyl,MAT.metal); barrel.scale.set(0.05,0.3,0.05);
  barrel.rotation.x=Math.PI/2; barrel.position.set(0,0.03,-0.1); tool.add(barrel);
  const emitter=new THREE.Mesh(GEO.sphere,MAT.emisC); emitter.scale.set(0.05,0.05,0.05); emitter.position.set(0,0.03,-0.26); tool.add(emitter);
  const hand=new THREE.Mesh(GEO.sphere,stdMat(0xc8a888,{roughness:0.8})); hand.scale.set(0.09,0.07,0.12); hand.position.set(0,-0.13,0.1); tool.add(hand);
  tool.position.set(0.34,-0.3,-0.55);
  camera.add(tool);
}
surfScene.add(camera);

function o2Max(){ return R.o2Max(S.tier); }
function shipNearbyOnSurface(){
  const dx=player.x-surf.shipPos.x, dz=player.z-surf.shipPos.z;
  return dx*dx+dz*dz<400;
}
function inO2Range(){
  if(shipNearbyOnSurface()) return true;
  for(const t in CAT){
    const def=CAT[t]; if(!def.o2r) continue;
    for(const st of placedByType[t]||[]){
      if(st.hp<=0) continue;
      const dx=player.x-st.x, dz=player.z-st.z;
      if(dx*dx+dz*dz<def.o2r*def.o2r) return true;
    }
  }
  return false;
}

/* ============================================================
   MINING
   ============================================================ */
let mineTarget=-1, mineProgress=0;
function findMineTarget(){
  let best=-1,bd=5.2*5.2;
  const fx=-Math.sin(player.yaw), fz=-Math.cos(player.yaw);
  for(let i=0;i<surf.nodes.length;i++){
    const nd=surf.nodes[i]; if(!nd.alive) continue;
    const dx=nd.x-player.x, dz=nd.z-player.z, d2=dx*dx+dz*dz;
    if(d2>bd) continue;
    const d=Math.sqrt(d2)||1;
    if((dx/d)*fx+(dz/d)*fz<0.35&&d2>1.4) continue;
    bd=d2; best=i;
  }
  return best;
}
function updateMining(dt,interactHeld){
  mineTarget=findMineTarget();
  if(mineTarget<0||!interactHeld){ mineProgress=0; return; }
  mineProgress+=dt;
  const nd=surf.nodes[mineTarget];
  if(Math.random()<dt*14){
    spawnBurst(nd.x,nd.y+nd.s,nd.z,curP().nodeCol,2,2.4,2.2,0.5,7);
    SND.mine();
  }
  if(mineProgress>=1.4){
    mineProgress=0;
    const key=curP().res;
    if(S.res[key]>=carryCap()){ showToast('Storage full — build more crates'); SND.denied(); return; }
    if(NET.active){ NET.send({t:'mine',pl:S.planet,i:mineTarget}); return; }
    applyNodeDead(S.planet,mineTarget,true);
  }
}
function applyNodeDead(pl,i,byMe){
  if(NET.active) (NET.deadNodes[pl]=NET.deadNodes[pl]||new Set()).add(i);
  if(S.mode==='surface'&&pl===S.planet&&surf.built&&surf.nodes[i]){
    const nd=surf.nodes[i];
    if(nd.alive){
      nd.alive=false; nd.respawn=180;
      nodeMatrixUpdate(i);
      spawnBurst(nd.x,nd.y+nd.s,nd.z,PLANETS[pl].nodeCol,16,4,4,0.9,7);
    }
  }
  if(byMe&&!NET.active){   // co-op: the server grants and confirms via prog
    const key=PLANETS[pl].res, amt=4+Math.floor(Math.random()*3);
    S.res[key]=Math.max(S.res[key],Math.min(carryCap(),S.res[key]+amt));
    SND.collect();
    showToast('+'+amt+' '+RES_NAMES[key]);
    updateHUDRes();
  }
}
function applyNodeAlive(pl,i){
  if(NET.deadNodes[pl]) NET.deadNodes[pl].delete(i);
  if(S.mode==='surface'&&pl===S.planet&&surf.built&&surf.nodes[i]){
    surf.nodes[i].alive=true; surf.nodes[i].respawn=0;
    nodeMatrixUpdate(i);
  }
}
function updateNodes(dt){
  if(NET.active) return; /* respawns are server-owned in co-op */
  for(let i=0;i<surf.nodes.length;i++){
    const nd=surf.nodes[i];
    if(!nd.alive){
      nd.respawn-=dt;
      if(nd.respawn<=0){ nd.alive=true; nodeMatrixUpdate(i); }
    }
  }
}

/* ============================================================
   BUILDING — ghost, placement, removal, repair
   ============================================================ */
const raycaster=new THREE.Raycaster();
let buildSel=null, ghost=null, ghostRot=0, ghostOK=false, removeMode=false, ghostPlaceRot=0, freePlace=false;
const ghostPos=new THREE.Vector3();
const snapMarker=new THREE.Mesh(new THREE.TorusGeometry(0.55,0.09,6,18),
  new THREE.MeshBasicMaterial({color:0x7fffc0,transparent:true,opacity:0.95,depthTest:false}));
snapMarker.rotation.x=-Math.PI/2; snapMarker.visible=false; snapMarker.renderOrder=999;
surfScene.add(snapMarker);

function canAfford(cost){ return R.canAfford(S.res,cost); }
function payCost(cost){ R.payCost(S.res,cost); updateHUDRes(); }
function costStr(cost){ return Object.keys(cost).map(k=>cost[k]+' '+RES_NAMES[k]).join(' + '); }

function selectBuild(t){
  const def=CAT[t];
  if(def.tier>0&&def.tier>S.tier){ SND.denied(); showToast('Requires Tier '+def.tier); return; }
  if(t==='beacon'&&S.beacon){ showToast('The Beacon is already placed'); return; }
  buildSel=t; removeMode=false;
  if(ghost){ surfScene.remove(ghost); ghost=null; }
  ghost=new THREE.Group();
  if(def.parts.length){
    for(const part of def.parts){
      const m=new THREE.Mesh(GEO[part.g],MAT.ghostOk);
      m.position.fromArray(part.o);
      if(part.r) m.rotation.set(part.r[0],part.r[1],part.r[2]);
      m.scale.fromArray(part.s);
      ghost.add(m);
    }
  } else {  /* dynamic (rover): simple footprint box */
    const m=new THREE.Mesh(GEO.box,MAT.ghostOk); m.scale.set(2.6,1.5,3.8); m.position.y=0.9; ghost.add(m);
  }
  surfScene.add(ghost);
  closePanel('buildMenu');
  showToast(def.name+(SNAP_PIECES.has(t)?' — snaps to nearby pieces · R cycles orientation · G free-place':' — R rotates')+' · X cancels');
  $('mPlace').classList.remove('hidden');
  $('mFree').classList.toggle('hidden',!SNAP_PIECES.has(t));
  $('mFree').textContent=freePlace?'FREE':'SNAP';
}
function cancelBuild(){
  buildSel=null;
  if(ghost){ surfScene.remove(ghost); ghost=null; }
  snapMarker.visible=false;
  $('mPlace').classList.add('hidden');
  $('mFree').classList.add('hidden');
}
/* nearest valid socket to the aim point, or null — shared logic, S.* state */
function findSnap(ax,az){ return R.findSnap(S.structures,S.planet,buildSel,ax,az,SNAP_R); }
function occupiedAt(x,y,z){ return R.occupiedAt(S.structures,S.planet,buildSel,x,y,z); }
function updateGhost(){
  if(!buildSel||!ghost) return;
  const def=CAT[buildSel];
  raycaster.setFromCamera({x:0,y:0},camera);
  raycaster.far=18;
  const targets=[surf.terrain];
  for(const t in structMeshes) for(const im of structMeshes[t]) if(im.count>0) targets.push(im);
  const hits=raycaster.intersectObjects(targets,false);
  let pt=null, stackY=null;
  if(hits.length){ pt=hits[0].point; if(hits[0].object.isInstancedMesh) stackY=pt.y; }
  else {
    const dir=new THREE.Vector3(); camera.getWorldDirection(dir);
    pt=new THREE.Vector3(player.x,0,player.z).addScaledVector(new THREE.Vector3(dir.x,0,dir.z).normalize(),7);
    pt.y=terrainH(pt.x,pt.z,curP());
  }
  let gx,gz,gy, snapped=false;
  if(!freePlace&&SNAP_PIECES.has(buildSel)){
    const snap=findSnap(pt.x,pt.z);
    if(snap){
      const n=snap.rots.length, wr=snap.rots[((ghostRot%n)+n)%n];
      gx=snap.x; gy=snap.y; gz=snap.z; ghostPlaceRot=wr; snapped=true;
      ghost.rotation.y=wr*Math.PI/2;
      snapMarker.visible=true; snapMarker.position.set(gx,gy+0.05,gz);
    }
  }
  if(!snapped){
    if(def.decor||['crate','lightpole','relay','shieldgen','armory','turret','beacon','rover','pillar','pillar2','pillar3','beam'].indexOf(buildSel)>=0){ gx=Math.round(pt.x*2)/2; gz=Math.round(pt.z*2)/2; }
    else { gx=Math.round(pt.x/GRID)*GRID; gz=Math.round(pt.z/GRID)*GRID; }
    gy=(stackY!==null)?Math.round(stackY/0.5)*0.5:groundYAt(gx,gz,1e9);
    ghostPlaceRot=ghostRot;
    ghost.rotation.y=ghostRot*Math.PI/2;
    snapMarker.visible=false;
  }
  ghostPos.set(gx,gy,gz);
  ghost.position.copy(ghostPos);
  const inB=Math.hypot(gx,gz)<WORLD_R-6;
  const dx=gx-player.x,dz=gz-player.z;
  ghostOK=inB&&(dx*dx+dz*dz<500)&&canAfford(def.cost)&&structCount()<MAX_STRUCT&&!occupiedAt(gx,gy,gz);
  ghost.children.forEach(m=>m.material=ghostOK?MAT.ghostOk:MAT.ghostBad);
}
function placeStructure(){
  if(!buildSel||!ghost) return;
  const def=CAT[buildSel];
  if(structCount()>=MAX_STRUCT){ showToast('Construction limit reached ('+MAX_STRUCT+' pieces) — remove something first'); SND.denied(); return; }
  if(buildSel==='turret'){ let mine=0; for(const s of S.structures) if(s.t==='turret'&&s.owner===myPid()) mine++;
    if(mine>=8){ showToast('Turret limit reached (8 per player)'); SND.denied(); return; } }
  if(!canAfford(def.cost)){ showToast('Need '+costStr(def.cost)); SND.denied(); return; }
  if(!ghostOK){ SND.denied(); return; }
  if(NET.active){
    NET.send({t:'place',st:{t:buildSel,pl:S.planet,x:+ghostPos.x.toFixed(2),y:+ghostPos.y.toFixed(2),z:+ghostPos.z.toFixed(2),r:ghostPlaceRot}});
    return;
  }
  applyPlaced({t:buildSel,pl:S.planet,x:ghostPos.x,y:ghostPos.y,z:ghostPos.z,r:ghostPlaceRot,hp:def.hp},true);
}
function applyPlaced(m,byMe){
  const def=CAT[m.t]; if(!def) return;
  const st={t:m.t,pl:m.pl,x:m.x,y:m.y,z:m.z,r:m.r,hp:m.hp!==undefined?m.hp:def.hp};
  if(m.id!==undefined) st.id=m.id;
  if(m.owner!==undefined&&m.owner!==null) st.owner=m.owner;
  else if(def.owned&&byMe) st.owner=myPid();
  if(m.ry!==undefined) st.ry=m.ry;
  if(m.col!==undefined) st.col=m.col;
  S.structures.push(st);
  if(S.mode==='surface'&&st.pl===S.planet){
    refreshStructures();
    spawnBurst(st.x,st.y+1,st.z,0x7fd6ff,12,3,3,0.6,5);
  } else updateCapNote();
  if(byMe){ if(!NET.active) payCost(def.cost); SND.place(); }   // co-op: server pays, prog confirms
  if(st.t==='beacon'){
    S.beacon=true;
    if(byMe) cancelBuild();
    triggerVictory(); saveGame(); return;
  }
  if(byMe){
    if(!canAfford(def.cost)){ cancelBuild(); showToast('Out of resources for '+def.name); }
    saveGame();
  }
}
function aimedStructure(){
  raycaster.setFromCamera({x:0,y:0},camera);
  raycaster.far=14;
  const targets=[];
  for(const t in structMeshes) for(const im of structMeshes[t]) if(im.count>0) targets.push(im);
  for(const m of roverMeshes.values()) targets.push(m);
  const hits=raycaster.intersectObjects(targets,true);
  for(const h of hits){
    const o=h.object;
    if(o.isInstancedMesh){ const st=(placedByType[o.userData.stype]||[])[h.instanceId]; if(st) return st; }
    else { let p=o; while(p&&!p.userData.st) p=p.parent; if(p&&p.userData.st) return p.userData.st; }
  }
  return null;
}
function removeStructure(){
  const st=aimedStructure();
  if(!st){ showToast('Aim at a structure to remove it'); return; }
  if(st.t==='beacon'){ showToast('The Beacon cannot be removed'); SND.denied(); return; }
  if(NET.active){ NET.send({t:'remove',id:st.id}); return; }
  applyRemoved(st,true);
}
function applyRemovedById(id,byMe){
  const st=S.structures.find(s=>s.id===id);
  if(st) applyRemoved(st,byMe);
}
function applyRemoved(st,byMe){
  const def=CAT[st.t];
  if(byMe&&!NET.active){   // co-op: the server refunds and confirms via prog
    const rf=R.refundFor(def.cost); for(const k in rf) S.res[k]=Math.min(carryCap(),S.res[k]+rf[k]);
    updateHUDRes();
  }
  S.structures.splice(S.structures.indexOf(st),1);
  if(S.mode==='surface'&&st.pl===S.planet){
    refreshStructures();
    spawnBurst(st.x,st.y+1,st.z,0xff8a5a,10,3,2.5,0.6,6);
  } else updateCapNote();
  if(byMe) SND.remove();
  saveGame();
}
function applyHpById(id,hp){
  const st=S.structures.find(s=>s.id===id);
  if(st) applyHp(st,hp);
}
function applyHp(st,hp){
  st.hp=hp;
  if(S.mode==='surface'&&st.pl===S.planet) rebuildAux();
}
function applyDestroyedById(id){
  const st=S.structures.find(s=>s.id===id);
  if(!st) return;
  S.structures.splice(S.structures.indexOf(st),1);
  if(S.mode==='surface'&&st.pl===S.planet){
    refreshStructures();
    spawnBurst(st.x,st.y+1,st.z,0xff8a5a,12,4,3,0.8,6);
    showToast(CAT[st.t].name+' destroyed by meteor!');
  } else updateCapNote();
}
let repairHold=0;
function updateRepair(dt,interactHeld,target){
  if(!target||target.hp>=CAT[target.t].hp||!interactHeld){ repairHold=0; return false; }
  if(S.res.fe<2){ if(interactHeld&&repairHold===0){showToast('Repair needs 2 Ferrite'); SND.denied();} repairHold=0.01; return false; }
  repairHold+=dt;
  if(Math.random()<dt*10) spawnBurst(target.x,target.y+1.2,target.z,0x7fd6ff,2,1.5,2,0.4,4);
  if(repairHold>=0.8){
    repairHold=0;
    if(NET.active) NET.send({t:'repair',id:target.id});   // server pays the 2 Ferrite + confirms
    else { S.res.fe-=2; updateHUDRes(); applyHp(target,CAT[target.t].hp); }
    SND.place(); showToast(CAT[target.t].name+' repaired');
  }
  return true;
}

/* ============================================================
   PAINT TOOL + BLUEPRINTS (Phase 2)
   ============================================================ */
/* PAINT_COLORS imported from shared/catalog.js */
let paintMode=false, paintColor=0xff5050;
function renderPaintGrid(){
  const g=$('paintGrid'); g.innerHTML='';
  for(const c of PAINT_COLORS){
    const d=document.createElement('div'); d.className='swatch';
    d.style.background='#'+c.toString(16).padStart(6,'0');
    d.addEventListener('click',()=>{ startPaint(c); });
    g.appendChild(d);
  }
}
function startPaint(c){
  paintColor=c; paintMode=true; cancelBuild(); closeAllPanels();
  showToast('Paint mode — aim at a piece and click. X exits'); SND.blip();
  $('mPlace').classList.remove('hidden');
}
function exitPaint(){ paintMode=false; $('mPlace').classList.add('hidden'); }
function paintAimed(){
  const st=aimedStructure();
  if(!st){ showToast('Aim at a structure to paint'); return; }
  if(NET.active) NET.send({t:'paint',id:st.id,col:paintColor});
  else applyPaint(st,paintColor);
}
function applyPaint(st,col){
  st.col=col;
  if(S.mode==='surface'&&st.pl===S.planet) refreshStructures();
  SND.place(); saveGame();
}
function applyPaintById(id,col){ const st=S.structures.find(s=>s.id===id); if(st) applyPaint(st,col); }

/* ---------- blueprints ---------- */
const BP_KEY='astravox_blueprints_v1';   /* BP_MAX imported from shared/constants.js */
let bpSelecting=false, bpDrag=null;   // {x0,y0}
function loadBlueprints(){ try{ return JSON.parse(localStorage.getItem(BP_KEY))||{}; }catch(e){ return {}; } }
function saveBlueprints(b){ try{ localStorage.setItem(BP_KEY,JSON.stringify(b)); }catch(e){} }
function openBlueprints(){ renderBlueprintList(); openPanel('blueprintPanel'); }
function renderBlueprintList(){
  const list=$('blueprintList'); const bps=loadBlueprints(); list.innerHTML='';
  const names=Object.keys(bps);
  if(!names.length){ list.innerHTML='<div style="color:#7fa8c4;font-size:12.5px">No blueprints yet. Use "Select & Save" to capture structures around you.</div>'; return; }
  for(const nm of names){
    const bp=bps[nm];
    const row=document.createElement('div'); row.className='bpItem';
    row.innerHTML='<b>'+escHtml(nm)+' ('+bp.pieces.length+')</b>';
    const stamp=document.createElement('button'); stamp.textContent='STAMP'; stamp.addEventListener('click',()=>{ startStamp(bp); });
    const exp=document.createElement('button'); exp.textContent='EXPORT'; exp.addEventListener('click',()=>exportBlueprint(nm,bp));
    const del=document.createElement('button'); del.textContent='✕'; del.addEventListener('click',()=>{ const b=loadBlueprints(); delete b[nm]; saveBlueprints(b); renderBlueprintList(); });
    row.appendChild(stamp); row.appendChild(exp); row.appendChild(del);
    list.appendChild(row);
  }
}
function exportBlueprint(nm,bp){
  const code=btoa(unescape(encodeURIComponent(JSON.stringify({n:nm,p:bp.pieces}))));
  const done=()=>showToast('Blueprint code copied');
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done).catch(()=>fallbackCopy(code,done));
  else fallbackCopy(code,done);
}
function importBlueprint(code){
  let o; try{ o=JSON.parse(decodeURIComponent(escape(atob(code.trim())))); }catch(e){ showToast('Invalid blueprint code'); return; }
  if(!o||!Array.isArray(o.p)){ showToast('Invalid blueprint code'); return; }
  const pieces=o.p.filter(q=>q&&CAT[q.t]).slice(0,BP_MAX).map(q=>({t:q.t,dx:+q.dx,dy:+q.dy,dz:+q.dz,r:(q.r|0)%4,col:q.col}));
  const bps=loadBlueprints(); bps[(o.n||'imported').slice(0,24)]={pieces}; saveBlueprints(bps);
  renderBlueprintList(); showToast('Blueprint imported');
}
/* selection: drag a box on screen, capture structures whose screen point is inside */
function beginBpSelect(){
  if(S.mode!=='surface'){ showToast('Blueprints are saved on a planet surface'); return; }
  bpSelecting=true; closeAllPanels();
  if(document.pointerLockElement) document.exitPointerLock();
  showToast('Drag a box over your structures, then release to name & save. Esc cancels');
}
const _sv2=new THREE.Vector3();
function structScreen(st){
  _sv2.set(st.x,st.y+1,st.z).project(camera);
  if(_sv2.z>1) return null;
  return { x:(_sv2.x*0.5+0.5)*window.innerWidth, y:(-_sv2.y*0.5+0.5)*window.innerHeight };
}
function finishBpSelect(x0,y0,x1,y1){
  bpSelecting=false; $('bpSel').style.display='none';
  const lx=Math.min(x0,x1), rx=Math.max(x0,x1), ty=Math.min(y0,y1), by=Math.max(y0,y1);
  if(rx-lx<12||by-ty<12){ return; }
  const sel=[];
  for(const st of S.structures){
    if(st.pl!==S.planet) continue;
    const sc=structScreen(st); if(!sc) continue;
    if(sc.x>=lx&&sc.x<=rx&&sc.y>=ty&&sc.y<=by) sel.push(st);
    if(sel.length>=BP_MAX) break;
  }
  if(!sel.length){ showToast('No structures in selection'); return; }
  // origin = centroid (x,z), min y
  let cx=0,cz=0,my=1e9; for(const s of sel){ cx+=s.x; cz+=s.z; my=Math.min(my,s.y); }
  cx/=sel.length; cz/=sel.length;
  const pieces=sel.map(s=>({t:s.t,dx:+(s.x-cx).toFixed(2),dy:+(s.y-my).toFixed(2),dz:+(s.z-cz).toFixed(2),r:s.r,col:s.col}));
  const nm=(prompt&&prompt('Name this blueprint ('+pieces.length+' pieces):','Home'))||('bp'+(Object.keys(loadBlueprints()).length+1));
  const bps=loadBlueprints(); bps[nm.slice(0,24)]={pieces}; saveBlueprints(bps);
  showToast('Saved blueprint "'+nm+'" ('+pieces.length+' pieces)'); SND.tierUp();
}
/* stamping: ghost the footprint at the aim point, validate cost, place all */
let bpStamp=null, bpStampRot=0;
function startStamp(bp){
  closeAllPanels(); cancelBuild(); exitPaint();
  bpStamp=bp; bpStampRot=0;
  if(bpGhost){ surfScene.remove(bpGhost); bpGhost=null; }
  bpGhost=new THREE.Group();
  for(const q of bp.pieces){
    const def=CAT[q.t]; if(!def||!def.parts.length) continue;
    const sub=new THREE.Group(); sub.position.set(q.dx,q.dy,q.dz); sub.rotation.y=q.r*Math.PI/2;
    for(const part of def.parts){ const m=new THREE.Mesh(GEO[part.g],MAT.ghostOk); m.position.fromArray(part.o); if(part.r) m.rotation.set(part.r[0],part.r[1],part.r[2]); m.scale.fromArray(part.s); sub.add(m); }
    bpGhost.add(sub);
  }
  surfScene.add(bpGhost);
  showToast('Stamp: aim & click to place all · R rotates · X cancels'); $('mPlace').classList.remove('hidden');
}
let bpGhost=null;
function cancelStamp(){ bpStamp=null; if(bpGhost){ surfScene.remove(bpGhost); bpGhost=null; } $('mPlace').classList.add('hidden'); }
function bpCost(bp){ const cost={}; for(const q of bp.pieces){ const c=CAT[q.t].cost; for(const k in c) cost[k]=(cost[k]||0)+c[k]; } return cost; }
function updateStampGhost(){
  if(!bpStamp||!bpGhost) return;
  raycaster.setFromCamera({x:0,y:0},camera); raycaster.far=40;
  const hits=raycaster.intersectObject(surf.terrain,false);
  let bx,bz,by;
  if(hits.length){ bx=Math.round(hits[0].point.x/GRID)*GRID; bz=Math.round(hits[0].point.z/GRID)*GRID; by=hits[0].point.y; }
  else { const dir=new THREE.Vector3(); camera.getWorldDirection(dir); bx=Math.round((player.x+dir.x*8)/GRID)*GRID; bz=Math.round((player.z+dir.z*8)/GRID)*GRID; by=terrainH(bx,bz,curP()); }
  bpGhost.position.set(bx,by,bz); bpGhost.rotation.y=bpStampRot*Math.PI/2;
  const cost=bpCost(bpStamp);
  const ok=canAfford(cost)&&structCount()+bpStamp.pieces.length<=MAX_STRUCT&&Math.hypot(bx,bz)<WORLD_R-10;
  bpGhost.traverse(o=>{ if(o.isMesh) o.material=ok?MAT.ghostOk:MAT.ghostBad; });
  bpStamp._ok=ok; bpStamp._at={x:bx,y:by,z:bz};
}
function placeStamp(){
  if(!bpStamp) return;
  const cost=bpCost(bpStamp);
  if(!bpStamp._ok){ if(!canAfford(cost)) showToast('Need '+costStr(cost)); else showToast('Cannot stamp here'); SND.denied(); return; }
  if(structCount()+bpStamp.pieces.length>MAX_STRUCT){ showToast('Would exceed the '+MAX_STRUCT+'-piece limit'); SND.denied(); return; }
  if(!NET.active) payCost(cost);   // co-op: server pays per accepted piece
  const at=bpStamp._at, a=bpStampRot*Math.PI/2, c=Math.cos(a), s=Math.sin(a);
  for(const q of bpStamp.pieces){
    const wx=at.x+q.dx*c+q.dz*s, wz=at.z-q.dx*s+q.dz*c, wy=at.y+q.dy, wr=((q.r+bpStampRot)%4+4)%4;
    if(NET.active) NET.send({t:'place',st:{t:q.t,pl:S.planet,x:+wx.toFixed(2),y:+wy.toFixed(2),z:+wz.toFixed(2),r:wr,col:q.col}});
    else applyPlaced({t:q.t,pl:S.planet,x:wx,y:wy,z:wz,r:wr,hp:CAT[q.t].hp,col:q.col},false);
  }
  if(!NET.active){ refreshStructures(); SND.tierUp(); saveGame(); }
  showToast('Stamped '+bpStamp.pieces.length+' pieces'); SND.place();
  cancelStamp();
}
$('bpSelectBtn').addEventListener('click',beginBpSelect);
$('bpImportBtn').addEventListener('click',()=>{ $('bpImportWrap').classList.toggle('hidden'); });
$('bpImportGo').addEventListener('click',()=>{ importBlueprint($('bpImportBox').value); });

/* ============================================================
   COMBAT — weapons, firing, damage, death/loot, safe zone
   ============================================================ */
SND.swing=function(){ this.tone(430,0.12,'sawtooth',0.06,170); };
SND.shoot=function(){ this.tone(720,0.07,'square',0.05,300); };
SND.shootHvy=function(){ this.tone(540,0.07,'square',0.05,240); };
SND.hurt=function(){ this.tone(200,0.16,'square',0.08,90); };
SND.heal=function(){ [440,660,880].forEach((f,i)=>setTimeout(()=>this.tone(f,0.12,'sine',0.07),i*70)); };
SND.craft=function(){ [330,494,660].forEach((f,i)=>setTimeout(()=>this.tone(f,0.13,'triangle',0.08),i*80)); };
SND.poof=function(){ this.tone(300,0.18,'sine',0.05,90); setTimeout(()=>this.tone(170,0.16,'triangle',0.04,70),40); };

let driving=null;          // rover entity when seated (Phase 4)
let weaponCd=0, swingT=0, fireHeld=false;
const weaponVM={};
function buildWeaponVMs(){
  const blade=new THREE.Group();
  const hilt=new THREE.Mesh(GEO.box,MAT.dark); hilt.scale.set(0.05,0.16,0.05); hilt.position.set(0,-0.05,0); blade.add(hilt);
  const guard=new THREE.Mesh(GEO.box,MAT.metal); guard.scale.set(0.16,0.03,0.05); guard.position.set(0,0.03,0); blade.add(guard);
  const edge=new THREE.Mesh(GEO.box,MAT.emisC); edge.scale.set(0.028,0.72,0.012); edge.position.set(0,0.44,0); blade.add(edge);
  blade.position.set(0.32,-0.32,-0.5); blade.rotation.set(-0.5,0.12,0); weaponVM.blade=blade;
  const pistol=new THREE.Group();
  const pgr=new THREE.Mesh(GEO.box,MAT.dark); pgr.scale.set(0.06,0.16,0.07); pgr.position.set(0,-0.08,0.03); pistol.add(pgr);
  const pbd=new THREE.Mesh(GEO.box,MAT.metal); pbd.scale.set(0.07,0.09,0.26); pbd.position.set(0,0.02,-0.08); pistol.add(pbd);
  const pmz=new THREE.Mesh(GEO.sphere,emisMat(0xffd060,0xcc8000,1.9)); pmz.scale.set(0.035,0.035,0.035); pmz.position.set(0,0.02,-0.22); pmz.name='muz'; pistol.add(pmz);
  pistol.position.set(0.3,-0.27,-0.45); weaponVM.pistol=pistol;
  const rifle=new THREE.Group();
  const rbd=new THREE.Mesh(GEO.box,MAT.dark); rbd.scale.set(0.07,0.1,0.5); rbd.position.set(0,-0.02,-0.12); rifle.add(rbd);
  const rbar=new THREE.Mesh(GEO.cyl,MAT.metal); rbar.scale.set(0.03,0.34,0.03); rbar.rotation.x=Math.PI/2; rbar.position.set(0,0,-0.36); rifle.add(rbar);
  const rsc=new THREE.Mesh(GEO.box,MAT.metal); rsc.scale.set(0.04,0.06,0.12); rsc.position.set(0,0.08,-0.05); rifle.add(rsc);
  const rmz=new THREE.Mesh(GEO.sphere,emisMat(0x7fff9a,0x10cc44,1.9)); rmz.scale.set(0.04,0.04,0.04); rmz.position.set(0,0,-0.52); rmz.name='muz'; rifle.add(rmz);
  rifle.position.set(0.28,-0.25,-0.4); weaponVM.rifle=rifle;
  /* Lance Beam — long sniper rail with scope + emitter */
  const lance=new THREE.Group();
  const lbd=new THREE.Mesh(GEO.box,MAT.dark); lbd.scale.set(0.07,0.1,0.62); lbd.position.set(0,-0.02,-0.18); lance.add(lbd);
  const lrail=new THREE.Mesh(GEO.cyl,MAT.metal); lrail.scale.set(0.028,0.6,0.028); lrail.rotation.x=Math.PI/2; lrail.position.set(0,0.04,-0.4); lance.add(lrail);
  const lsc=new THREE.Mesh(GEO.box,MAT.dark); lsc.scale.set(0.05,0.07,0.18); lsc.position.set(0,0.1,-0.06); lance.add(lsc);
  const lmz=new THREE.Mesh(GEO.sphere,emisMat(0xb060ff,0x6010aa,1.9)); lmz.scale.set(0.05,0.05,0.05); lmz.position.set(0,0.04,-0.7); lmz.name='muz'; lance.add(lmz);
  lance.position.set(0.27,-0.24,-0.38); weaponVM.lance=lance;
  /* Inferno Thrower — bulky nozzle + tank */
  const inferno=new THREE.Group();
  const ibd=new THREE.Mesh(GEO.box,MAT.dark); ibd.scale.set(0.1,0.12,0.4); ibd.position.set(0,-0.02,-0.1); inferno.add(ibd);
  const inoz=new THREE.Mesh(GEO.cyl,MAT.metal); inoz.scale.set(0.06,0.3,0.06); inoz.rotation.x=Math.PI/2; inoz.position.set(0,0,-0.34); inferno.add(inoz);
  const itank=new THREE.Mesh(GEO.cyl,stdMat(0xb5481f,{roughness:0.6,metalness:0.4})); itank.scale.set(0.09,0.26,0.09); itank.position.set(-0.02,-0.12,0.06); inferno.add(itank);
  const ipilot=new THREE.Mesh(GEO.sphere,emisMat(0xff7020,0xcc3000,2.0)); ipilot.scale.set(0.04,0.04,0.04); ipilot.position.set(0,0.03,-0.5); ipilot.name='muz'; inferno.add(ipilot);
  inferno.position.set(0.28,-0.26,-0.4); weaponVM.inferno=inferno;
  /* Plasma Grenade in hand */
  const gren=new THREE.Group();
  const gb=new THREE.Mesh(GEO.sphere,stdMat(0x355a3a,{roughness:0.5,metalness:0.4})); gb.scale.set(0.09,0.11,0.09); gren.add(gb);
  const gr1=new THREE.Mesh(GEO.cyl,emisMat(0x7fff9a,0x20cc55,1.8)); gr1.scale.set(0.1,0.03,0.1); gr1.position.y=0.02; gren.add(gr1);
  gren.position.set(0.3,-0.32,-0.4); weaponVM.grenade=gren;
  /* Deployable Shield disc in hand */
  const shd=new THREE.Group();
  const sdisc=new THREE.Mesh(GEO.cyl,stdMat(0x3a5a72,{roughness:0.4,metalness:0.6})); sdisc.scale.set(0.16,0.05,0.16); sdisc.rotation.x=Math.PI/2; shd.add(sdisc);
  const score=new THREE.Mesh(GEO.sphere,emisMat(0x7fdcff,0x1080cc,1.8)); score.scale.set(0.06,0.06,0.06); score.position.z=-0.03; shd.add(score);
  shd.position.set(0.3,-0.3,-0.42); weaponVM.shield=shd;
  for(const g of [blade,pistol,rifle,lance,inferno,gren,shd]){ g.visible=false; camera.add(g); }
}
buildWeaponVMs();
function curWeapon(){ return WEAPONS[SLOT_KEYS[S.slot]]; }
function ownsSlot(i){ const k=SLOT_KEYS[i]; return i===0 || !!S.weapons[k]; }
function updateViewmodel(){
  const surf2=S.mode==='surface'&&!driving;
  tool.visible=(S.slot===0&&surf2);
  for(const k of WEP_KEYS){ if(weaponVM[k]) weaponVM[k].visible=(SLOT_KEYS[S.slot]===k&&surf2); }
}
function setSlot(i){
  if(i<0||i>=SLOT_KEYS.length) return;
  if(!ownsSlot(i)){ showToast(WEAPONS[SLOT_KEYS[i]].name+' — craft it at an Armory'); SND.denied(); return; }
  S.slot=i; updateViewmodel(); renderHotbar(); SND.blip();
}
/* safe zone */
function beaconOnPlanet(pl){ pl=pl||S.planet; for(const st of S.structures){ if(st.t==='beacon'&&st.pl===pl) return st; } return null; }
function inSafeZone(x,z){ return R.inSafeZone(S.structures,S.planet,x,z); }

/* transient visual fx (tracers, muzzle flashes) */
const transientFx=[];
function pushFx(o,life,o0){ o.userData._fx={life,max:life,o0:o0||1}; surfScene.add(o); transientFx.push(o); }
function updateFx(dt){
  for(let i=transientFx.length-1;i>=0;i--){
    const o=transientFx[i], f=o.userData._fx; f.life-=dt;
    const k=clamp(f.life/f.max,0,1);
    if(o.material&&o.material.opacity!==undefined) o.material.opacity=k*f.o0;
    if(f.life<=0){ surfScene.remove(o); if(o.material&&o.material.dispose) o.material.dispose(); transientFx.splice(i,1); }
  }
}
const _cw=new THREE.Vector3(), _cf=new THREE.Vector3();
function camWorld(){ camera.getWorldPosition(_cw); camera.getWorldDirection(_cf); }
function tracerFx(a,b,col,width){
  const len=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])||0.01;
  const m=new THREE.Mesh(GEO.box,new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.9,blending:THREE.AdditiveBlending,depthWrite:false}));
  m.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
  const wd=width||0.05; m.scale.set(wd,wd,len); m.lookAt(b[0],b[1],b[2]);
  pushFx(m,width?0.16:0.08,0.9);
}
function muzzleFlash(col){
  camWorld();
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:GLOW_TEX,color:col,transparent:true,opacity:0.85,blending:THREE.AdditiveBlending,depthWrite:false}));
  sp.scale.set(0.7,0.7,1);
  sp.position.set(_cw.x+_cf.x*0.55,_cw.y+_cf.y*0.55-0.08,_cw.z+_cf.z*0.55);
  pushFx(sp,0.06,0.85);
}
function aimPoint(dist){ camWorld(); return [_cw.x+_cf.x*dist,_cw.y+_cf.y*dist,_cw.z+_cf.z*dist]; }
function avatarHitCenter(r){ return [r.avatar.position.x,r.avatar.position.y+1,r.avatar.position.z]; }
function fireWeapon(){
  if(driving||S.mode!=='surface') return;
  const w=curWeapon();
  if(w.thrown) return;                 // grenade/shield throw on a fresh press (throwGadget)
  if(weaponCd>0) return;
  if(w.melee){ weaponCd=w.cd; swingT=0.26; SND.swing(); doAttack(w,S.slot,'melee'); return; }
  if(w.cone){ fireInferno(w); return; }
  const use=w.ammoUse||1;
  if(S.ammo[w.ammo]<use){ SND.denied(); showToast('Out of '+AMMO_NAMES[w.ammo]); weaponCd=0.3; renderHotbar(); return; }
  S.ammo[w.ammo]-=use; weaponCd=w.cd;
  (w.lance?SND.lance:(w.ammo==='heavy'?SND.shootHvy:SND.shoot)).call(SND);
  muzzleFlash(w.col);
  doAttack(w,S.slot,'ranged');
  renderHotbar();
}
function doAttack(w,wp,kind){
  camWorld();
  startleCritters(player.x,player.z,16);
  let hitPid=null, hitDist=w.range;
  const safe=inSafeZone(player.x,player.z);
  if(NET.active&&!safe){
    for(const [pid,r] of remotes){
      if(!r.avatar.visible) continue;
      const c=avatarHitCenter(r), mx=c[0]-_cw.x,my=c[1]-_cw.y,mz=c[2]-_cw.z;
      const tca=mx*_cf.x+my*_cf.y+mz*_cf.z;
      if(tca<0||tca>hitDist) continue;
      if(kind==='melee'){
        const d=Math.hypot(mx,my,mz)||1;
        if((mx/d)*_cf.x+(my/d)*_cf.y+(mz/d)*_cf.z<1-w.arc) continue;
        if(d>w.range) continue;
        hitDist=d; hitPid=pid;
      } else {
        const perp2=mx*mx+my*my+mz*mz-tca*tca;
        if(perp2>0.85*0.85) continue;
        hitDist=tca; hitPid=pid;
      }
    }
  }
  /* critters (solo + MP) — compete with any player hit on distance; nearest wins */
  let critTarget=null;
  for(const c of critters){
    if(c.pl!==S.planet) continue;
    const cx=c.x-_cw.x, cyv=(c.y+0.4)-_cw.y, cz=c.z-_cw.z;
    const tca=cx*_cf.x+cyv*_cf.y+cz*_cf.z;
    if(tca<0||tca>hitDist) continue;
    if(kind==='melee'){
      const d=Math.hypot(cx,cyv,cz)||1;
      if((cx/d)*_cf.x+(cyv/d)*_cf.y+(cz/d)*_cf.z<1-w.arc) continue;
      if(d>w.range) continue;
      hitDist=d; critTarget=c; hitPid=null;
    } else {
      const perp2=cx*cx+cyv*cyv+cz*cz-tca*tca;
      if(perp2>0.9*0.9) continue;
      hitDist=tca; critTarget=c; hitPid=null;
    }
  }
  let end = critTarget ? [critTarget.x,critTarget.y+0.45,critTarget.z]
            : hitPid!==null ? avatarHitCenter(remotes.get(hitPid))
            : (kind==='ranged' ? aimPoint(w.range) : aimPoint(w.range*0.7));
  /* deployable shield walls block ranged shots */
  if(kind==='ranged'){
    const b=shotBlocked([_cw.x,_cw.y,_cw.z],end);
    if(b){ end=b; hitPid=null; critTarget=null; spawnBurst(b[0],b[1],b[2],0x7fdcff,9,2.4,2.4,0.4,2); SND.shieldHit(); }
  }
  if(kind==='ranged') tracerFx([_cw.x+_cf.x*0.45,_cw.y+_cf.y*0.45-0.08,_cw.z+_cf.z*0.45],end,w.col,w.lance?0.16:0);
  else spawnBurst(end[0],end[1],end[2],0x9feaff,5,2,2,0.3,1);
  if(hitPid!==null) spawnBurst(end[0],end[1],end[2],0xffd0a0,9,2,2,0.4,3);
  if(NET.active){
    NET.send({t:'fire',wp,o:[+_cw.x.toFixed(2),+_cw.y.toFixed(2),+_cw.z.toFixed(2)],p:[+end[0].toFixed(2),+end[1].toFixed(2),+end[2].toFixed(2)],
      target:hitPid!==null?hitPid:undefined});   // damage is computed server-side
  }
  if(critTarget) hitCritter(critTarget,w.dmg,end,wp);
}
function muzzleAt(pos,col){
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:GLOW_TEX,color:col,transparent:true,opacity:0.85,blending:THREE.AdditiveBlending,depthWrite:false}));
  sp.scale.set(0.6,0.6,1); sp.position.set(pos[0],pos[1],pos[2]); pushFx(sp,0.06,0.85);
}
function onRemoteFire(m){
  if(m.p){
    if(m.wp===5){            // inferno cone flame
      if(m.o){ const ox=m.o[0],oy=m.o[1],oz=m.o[2], dx=m.p[0]-ox,dy=m.p[1]-oy,dz=m.p[2]-oz, d=Math.hypot(dx,dy,dz)||1;
        for(let i=0;i<4;i++){ const sp=2+Math.random()*9; spawnBurst(ox+dx/d*sp,oy+dy/d*sp,oz+dz/d*sp,i%2?0xff7020:0xffb050,1,1.6,1.0,0.4,-1.5); } }
    } else if(m.wp===4){     // lance beam
      if(m.o){ tracerFx(m.o,m.p,0xb060ff,0.16); muzzleAt(m.o,0xb060ff); }
    } else if(m.wp>=2){
      const col=m.wp===2?0xffd060:0x7fff9a; if(m.o){ tracerFx(m.o,m.p,col); muzzleAt(m.o,col); }
    } else { spawnBurst(m.p[0],m.p[1],m.p[2],0x9feaff,5,2,2,0.3,1); const r=remotes.get(m.by); if(r) r.swingT=0.26; }
  }
  /* damage no longer rides the fire relay — the server sends 'hurt'/'pdeath' */
}
function openCraftMenu(){ renderCraftGrid(); openPanel('craftMenu'); }

/* ============================================================
   ROVER — drivable buggy (Phase 4)
   ============================================================ */
let localStructId=1;
const roverMeshes=new Map();
function buildRover(){
  const g=new THREE.Group();
  const body=new THREE.Mesh(GEO.box,stdMat(0xc9923a,{roughness:0.6,metalness:0.4})); body.scale.set(2.4,0.7,3.6); body.position.y=0.95; g.add(body);
  const nose=new THREE.Mesh(GEO.box,stdMat(0xa9772a,{roughness:0.6,metalness:0.4})); nose.scale.set(2.2,0.4,0.8); nose.position.set(0,0.75,-1.9); g.add(nose);
  const cab=new THREE.Mesh(GEO.box,new THREE.MeshStandardMaterial({color:0x4adfff,transparent:true,opacity:0.4,roughness:0.1,emissive:0x0a4a66,emissiveIntensity:0.6}));
  cab.scale.set(1.8,0.7,1.4); cab.position.set(0,1.5,-0.3); g.add(cab);
  const bar=new THREE.Mesh(GEO.box,MAT.dark); bar.scale.set(1.9,0.12,0.12); bar.position.set(0,1.95,0.5); g.add(bar);
  for(const [wx,wz] of [[-1.25,1.25],[1.25,1.25],[-1.25,-1.25],[1.25,-1.25]]){
    const w=new THREE.Mesh(GEO.cyl,MAT.dark); w.scale.set(0.85,0.55,0.85); w.rotation.z=Math.PI/2; w.position.set(wx,0.55,wz); g.add(w);
  }
  for(const hx of [-0.7,0.7]){
    const beam=new THREE.Mesh(GEO.cone,new THREE.MeshBasicMaterial({color:0xfff4cc,transparent:true,opacity:0.16,blending:THREE.AdditiveBlending,depthWrite:false}));
    beam.scale.set(1.5,4.2,1.5); beam.rotation.x=-Math.PI/2; beam.position.set(hx,0.85,-3.4); g.add(beam);
    const lamp=new THREE.Mesh(GEO.sphere,MAT.emisW); lamp.scale.set(0.2,0.2,0.2); lamp.position.set(hx,0.85,-2.0); g.add(lamp);
  }
  return g;
}
function syncRovers(){
  const want=new Set();
  for(const st of S.structures){
    if(st.t!=='rover'||st.pl!==S.planet) continue;
    if(st.id===undefined) st.id=myPid()+'_r'+(localStructId++);
    if(st.ry===undefined) st.ry=st.r*Math.PI/2;
    want.add(st.id);
    if(!roverMeshes.has(st.id)){ const m=buildRover(); m.userData.st=st; surfScene.add(m); roverMeshes.set(st.id,m); }
    else roverMeshes.get(st.id).userData.st=st;
  }
  for(const [id,m] of roverMeshes){ if(!want.has(id)){ surfScene.remove(m); roverMeshes.delete(id); } }
}
function updateRoverMeshes(dt){
  for(const [id,m] of roverMeshes){
    const st=m.userData.st;
    if(st._t&&!(driving&&driving.id===id)){
      const k=Math.min(1,dt*10);
      st.x=lerp(st.x,st._t.x,k); st.y=lerp(st.y,st._t.y,k); st.z=lerp(st.z,st._t.z,k);
      let d=st._t.ry-(st.ry||0); d=((d+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI; st.ry=(st.ry||0)+d*k;
    }
    m.position.set(st.x,st.y,st.z); m.rotation.y=st.ry||0;
  }
}
function nearRover(){
  for(const st of placedByType.rover||[]){
    if(NET.active){ const seat=NET.seats.get(st.id); if(seat&&seat!==myPid()) continue; }
    const dx=player.x-st.x, dz=player.z-st.z;
    if(dx*dx+dz*dz<16) return st;
  }
  return null;
}
function enterRover(st){
  if(NET.active){
    const seat=NET.seats.get(st.id);
    if(seat&&seat!==myPid()){ showToast('Rover is occupied'); SND.denied(); return; }
    NET.seats.set(st.id,myPid()); NET.send({t:'roverSeat',id:st.id});
  }
  driving=st; st._t=null;
  cancelBuild(); updateViewmodel();
  showToast('Driving — W/S accelerate, A/D steer, E to exit');
  SND.place();
}
function exitRover(){
  const st=driving; if(!st){ return; }
  if(NET.active){ NET.seats.delete(st.id); NET.send({t:'roverSeatClear',id:st.id}); }
  driving=null;
  /* place player just beside the rover on the ground */
  const fx=-Math.sin(st.ry||0), fz=-Math.cos(st.ry||0);
  player.x=st.x+fz*2.2; player.z=st.z-fx*2.2;     // step out to the side
  player.y=groundYAt(player.x,player.z,1e9); player.vy=0; player.yaw=st.ry||0;
  updateViewmodel();
  saveGame();
}
function updateRover(dt){
  const st=driving;
  /* input */
  let thr=0, steer=0;
  if(keys.KeyW||keys.ArrowUp) thr+=1; if(keys.KeyS||keys.ArrowDown) thr-=1;
  if(keys.KeyA||keys.ArrowLeft) steer-=1; if(keys.KeyD||keys.ArrowRight) steer+=1;
  if(joy.active){ thr+=-joy.y; steer+=joy.x; }
  const maxSp=15;
  st._sp=(st._sp||0)+thr*22*dt;
  if(thr===0) st._sp*=Math.pow(0.25,dt);
  st._sp=clamp(st._sp,-maxSp*0.45,maxSp);
  st.ry=(st.ry||0)-steer*1.5*dt*clamp(Math.abs(st._sp)/4,0.2,1)*(st._sp<0?-1:1);
  const fx=-Math.sin(st.ry), fz=-Math.cos(st.ry);
  st.x+=fx*st._sp*dt; st.z+=fz*st._sp*dt;
  /* terrain follow + suspension */
  const pr=Math.hypot(st.x,st.z); if(pr>WORLD_R-4){ st.x*=(WORLD_R-4)/pr; st.z*=(WORLD_R-4)/pr; st._sp*=0.3; }
  /* Hover Module (Tier 5): skim across water on Pelagos with a slight bob */
  let baseGy=terrainH(st.x,st.z,curP());
  const hover=curP().water&&S.tier>=5;
  if(hover) baseGy=Math.max(baseGy,SEA_Y)+Math.sin(performance.now()*0.003)*0.12;
  const gy=baseGy+0.7;
  st.y=lerp(st.y===undefined?gy:st.y,gy,Math.min(1,dt*8));
  /* driver shares rover location for O2/turret/meteor systems */
  player.x=st.x; player.z=st.z; player.y=st.y;
  /* O2 (open-top cockpit) */
  puSprint=false; puJet=false;
  const safe=inO2Range();
  if(safe) S.o2=Math.min(o2Max(),S.o2+28*dt); else S.o2=Math.max(0,S.o2-1.15*dt);
  if(S.o2<=0){ exitRover(); doBlackout(); return; }
  /* HUD */
  $('o2bar').style.width=(S.o2/o2Max()*100)+'%';
  $('o2bar').classList.toggle('low',S.o2/o2Max()<0.25&&!safe);
  $('hpbar').style.width=(player.hp/HP_MAX*100)+'%';
  setPrompt('<span class="key">E</span>EXIT ROVER · W/S drive · A/D steer'); setMAct('EXIT'); mFire=false;
  $('prog').classList.add('hidden');
  /* sync */
  if(NET.active){ const nw=performance.now(); if(nw-(NET.lastRover||0)>90){ NET.lastRover=nw;
    NET.send({t:'roverMove',id:st.id,x:+st.x.toFixed(2),y:+st.y.toFixed(2),z:+st.z.toFixed(2),ry:+st.ry.toFixed(3)}); } }
  /* exit */
  if(justE){ exitRover(); justE=false; }
  /* world timers still run while driving */
  updateNodes(dt); updateMeteors(dt); updateLoot(dt); updateTurrets(dt); updateRoverMeshes(dt); updateCritters(dt); updateHeavyWeapons(dt); updateWater();
  dayClock+=dt; applyDayNight();
  S.ppos=[player.x,player.y,player.z]; S.pyaw=st.ry||0;
  renderRoverCam();
}
function renderRoverCam(){
  const st=driving; const fx=-Math.sin(st.ry||0), fz=-Math.cos(st.ry||0);
  camera.position.set(st.x-fx*7.5,st.y+4.2,st.z-fz*7.5);
  camera.lookAt(st.x+fx*5,st.y+1.0,st.z+fz*5);
}
function dmgFlashFx(){
  const f=$('dmgFlash'); f.style.boxShadow='inset 0 0 150px rgba(255,30,30,0.7)';
  setTimeout(()=>{ f.style.boxShadow='inset 0 0 150px rgba(255,30,30,0)'; },120);
}
function applyDamageToSelf(dmg){
  if(NET.active) return;   // co-op damage arrives only via server 'hurt'/'pdeath'
  if(!S.running||S.mode!=='surface') return;
  if(player.invuln>0||inSafeZone(player.x,player.z)) return;
  player.hp=Math.max(0,player.hp-dmg);
  dmgFlashFx(); SND.hurt();
  spawnBurst(player.x,player.y+1.2,player.z,0xff4040,8,2,2,0.4,3);
  if(player.hp<=0) die();
}
let soloLootId=1;
function die(){
  /* solo only — in co-op the server decides deaths and sends 'pdeath' */
  const loot={fe:S.res.fe|0,cy:S.res.cy|0,bio:S.res.bio|0};
  S.res={fe:0,cy:0,bio:0,ch:S.res.ch|0,pe:S.res.pe|0}; updateHUDRes();   // Chitin & Pearls kept through death
  spawnBurst(player.x,player.y+1,player.z,0xff5050,32,5,6,1.2,3);
  spawnBurst(player.x,player.y+1,player.z,0x553030,16,4,4,1.8,2);
  SND.impact();
  const pos=[+player.x.toFixed(2),+player.y.toFixed(2),+player.z.toFixed(2)];
  if(loot.fe||loot.cy||loot.bio) spawnLootBox('Lsolo'+(soloLootId++),S.planet,pos,loot);
  respawnPlayer();
}
function respawnPlayer(){
  if(driving) exitRover();
  player.x=surf.shipPos.x-3; player.z=surf.shipPos.z+3;
  player.y=groundYAt(player.x,player.z,1e9); player.vy=0;
  player.hp=HP_MAX; S.o2=o2Max(); player.invuln=SPAWN_PROT;
  $('protRing').classList.remove('hidden');
  showToast('Recovered at base — '+SPAWN_PROT+'s spawn protection',3000);
}
/* loot containers */
const lootBoxes=new Map();
function makeLootMesh(){
  const g=new THREE.Group();
  const b=new THREE.Mesh(GEO.box,new THREE.MeshStandardMaterial({color:0x2a3440,emissive:0xffc040,emissiveIntensity:0.8,roughness:0.5}));
  b.scale.set(0.9,0.7,0.9); b.position.y=0.4; b.name='box'; g.add(b);
  const gl=makeGlow('#ffd070',2.6); gl.position.y=0.7; g.add(gl);
  return g;
}
function spawnLootBox(id,pl,pos,loot){
  if(lootBoxes.has(id)) return;
  const g=makeLootMesh(); g.position.set(pos[0],pos[1],pos[2]); surfScene.add(g);
  lootBoxes.set(id,{mesh:g,pl,pos,loot});
}
function removeLootBox(id){ const c=lootBoxes.get(id); if(c){ surfScene.remove(c.mesh); lootBoxes.delete(id); } }
function clearLoot(){ for(const id of [...lootBoxes.keys()]) removeLootBox(id); }
function addLoot(loot){
  if(!NET.active){   // co-op: the server grants on lootClaim and confirms via prog
    const cap=carryCap();
    S.res.fe=Math.min(cap,S.res.fe+(loot.fe|0));
    S.res.cy=Math.min(cap,S.res.cy+(loot.cy|0));
    S.res.bio=Math.min(cap,S.res.bio+(loot.bio|0));
    updateHUDRes();
  }
  SND.collect(); showToast('Recovered cache');
}
function updateLoot(dt){
  for(const [id,c] of lootBoxes){
    const vis=(c.pl===S.planet&&S.mode==='surface');
    c.mesh.visible=vis; if(!vis) continue;
    c.mesh.rotation.y+=dt*1.2;
    const bx=c.mesh.getObjectByName('box'); if(bx) bx.position.y=0.4+Math.sin(performance.now()*0.004)*0.08;
    const dx=player.x-c.pos[0], dz=player.z-c.pos[2];
    if(dx*dx+dz*dz<6.25&&!driving){
      if(NET.active){ NET.send({t:'lootClaim',id}); removeLootBox(id); }
      else { addLoot(c.loot); removeLootBox(id); spawnBurst(c.pos[0],c.pos[1]+0.6,c.pos[2],0xffd070,10,2,2,0.5,2); }
    }
  }
}

/* ---------- Armory craft menu ---------- */
function nearArmory(){
  for(const st of placedByType.armory||[]){ if(st.hp<=0) continue; const dx=player.x-st.x,dz=player.z-st.z; if(dx*dx+dz*dz<16) return st; }
  return null;
}
function renderCraftGrid(){
  const grid=$('craftGrid'); grid.innerHTML='';
  const sec=t=>{ const d=document.createElement('div'); d.className='cSection'; d.textContent=t; grid.appendChild(d); };
  const item=key=>{
    const c=CRAFT[key];
    const cost = key==='medpack'?medCost():c.cost;
    const locked = c.tier>S.tier;
    const owned = (c.kind==='weapon'||c.kind==='gadget')&&S.weapons[c.own||key];
    const d=document.createElement('div');
    d.className='cItem'+(locked?' locked':'')+(owned?' owned':'');
    d.innerHTML='<div class="cn">'+c.ic+' '+c.name+'</div>'+(c.desc?'<div class="cd">'+c.desc+'</div>':'')+
      '<div class="cc">'+Object.keys(cost).map(k=>'<span style="color:'+RES_DOTS[k]+'">'+cost[k]+' '+RES_NAMES[k]+'</span>').join(' · ')+'</div>'+
      (locked?'<div class="ct" style="color:#ff9a8a">Requires Tier '+c.tier+'</div>':owned?'<div class="ct">✓ Crafted</div>':'');
    if(!locked&&!owned) d.addEventListener('click',()=>craft(key));
    grid.appendChild(d);
  };
  sec('Weapons'); ['blade','pistol','rifle','lance','inferno'].forEach(item);
  sec('Heavy Ordnance'); ['grenade','shield'].forEach(item);
  sec('Ammo'); ['light','heavy','lightC','heavyC','fuel'].forEach(item);
  sec('Medical'); ['medpack','medChit'].forEach(item);
}
function craft(key){
  const c=CRAFT[key];
  if(c.tier>S.tier){ SND.denied(); return; }
  if((c.kind==='weapon'||c.kind==='gadget')&&S.weapons[c.own||key]){ showToast('Already crafted'); return; }
  const cost=key==='medpack'?medCost():c.cost;
  if(!canAfford(cost)){ SND.denied(); showToast('Need '+costStr(cost)); return; }
  if(NET.active){ NET.send({t:'craft',key}); return; }   // server validates, pays & confirms
  payCost(cost);
  if(c.kind==='weapon'){ S.weapons[key]=true; showToast(c.name+' crafted — equip from hotbar'); }
  else if(c.kind==='ammo'){ S.ammo[c.ammo]+=c.give; showToast('+'+c.give+' '+AMMO_NAMES[c.ammo]); }
  else if(c.kind==='med'){ S.medkits++; showToast('Med-Pack crafted ('+S.medkits+')'); }
  else if(c.kind==='throwable'){ S.weapons[c.own]=true; S.ammo[c.ammo]+=c.give; showToast('+'+c.give+' '+c.name.replace(/ ×\d+$/,'')+'s'); }
  else if(c.kind==='gadget'){ S.weapons[c.own]=true; showToast(c.name+' crafted — equip from hotbar'); }
  SND.craft();
  renderCraftGrid(); renderHotbar(); saveGame();
}
function useMed(){
  if(S.medkits<=0){ showToast('No Med-Packs — craft at an Armory'); SND.denied(); return; }
  if(player.hp>=HP_MAX){ showToast('Health already full'); return; }
  if(NET.active){ NET.send({t:'useMed'}); return; }   // server spends the kit; heal lands via prog ev
  S.medkits--; player.hp=Math.min(HP_MAX,player.hp+50);
  SND.heal(); spawnBurst(player.x,player.y+1,player.z,0x8affb0,12,2,3,0.6,2);
  showToast('+50 HP'); renderHotbar(); saveGame();
}
/* ---------- hotbar HUD ---------- */
function renderHotbar(){
  const hb=$('hotbar'); hb.innerHTML='';
  for(let i=0;i<SLOT_KEYS.length;i++){
    const k=SLOT_KEYS[i], w=WEAPONS[k];
    const d=document.createElement('div');
    d.className='slot'+(i===S.slot?' sel':'')+(ownsSlot(i)?'':' locked');
    const ic=SLOT_ICONS[i];
    let amm='';
    if(w.ammo) amm='<span class="sa">'+(S.ammo[w.ammo]|0)+'</span>';
    d.innerHTML='<span class="sk">'+(i+1)+'</span><span class="si">'+ic+'</span>'+amm;
    if(w.ammo&&S.ammo[w.ammo]<=0&&ownsSlot(i)) d.classList.add('noammo');
    d.addEventListener('click',()=>setSlot(i));
    d.addEventListener('touchstart',e=>{e.preventDefault();setSlot(i);},{passive:false});
    hb.appendChild(d);
  }
  const med=document.createElement('div'); med.id='medSlot';
  med.innerHTML='+<span class="sa">'+(S.medkits|0)+'</span>';
  med.addEventListener('click',useMed);
  med.addEventListener('touchstart',e=>{e.preventDefault();useMed();},{passive:false});
  hb.appendChild(med);
}

/* ============================================================
   SENTRY TURRETS — track & shoot non-owner players
   ============================================================ */
/* TURRET_* imported from shared/constants.js */
function structMatrixHead(st,part,out,yawAbs){
  _e.set(0,yawAbs,0); _q.setFromEuler(_e);
  _m1.compose(_v.set(st.x,st.y,st.z),_q,_sv.set(1,1,1));
  const pr=part.r||[0,0,0];
  _e.set(pr[0],pr[1],pr[2]);
  _m2.compose(_v.set(part.o[0],part.o[1],part.o[2]),_q.setFromEuler(_e),_sv.set(part.s[0],part.s[1],part.s[2]));
  out.multiplyMatrices(_m1,_m2);
}
function turretTarget(st){
  let best=TURRET_R*TURRET_R, found=null;
  const me=myPid();
  if(st.owner!==me&&!inSafeZone(player.x,player.z)){
    const dx=player.x-st.x,dz=player.z-st.z,d2=dx*dx+dz*dz;
    if(d2<best){ best=d2; found={x:player.x,y:player.y,z:player.z,me:true}; }
  }
  if(NET.active) for(const [pid,r] of remotes){
    if(pid===st.owner||!r.avatar.visible) continue;
    const ax=r.avatar.position.x,az=r.avatar.position.z;
    if(inSafeZone(ax,az)) continue;
    const dx=ax-st.x,dz=az-st.z,d2=dx*dx+dz*dz;
    if(d2<best){ best=d2; found={x:ax,y:r.avatar.position.y,z:az,me:false}; }
  }
  return found;
}
function turretFire(st,tg){
  const o=[st.x,st.y+1.35,st.z], p=[tg.x,tg.y+1,tg.z];
  tracerFx(o,p,0xff6a4a);
  const dxs=player.x-st.x,dzs=player.z-st.z;
  if(dxs*dxs+dzs*dzs<1600) SND.shoot();
  if(tg.me) applyDamageToSelf(TURRET_DMG);
}
function updateTurrets(dt){
  const list=placedByType.turret||[];
  if(!list.length) return;
  const def=CAT.turret;
  for(let i=0;i<list.length;i++){
    const st=list[i];
    if(st._tyaw===undefined) st._tyaw=st.r*Math.PI/2;
    let tg=null;
    if(st.hp>0&&!inSafeZone(st.x,st.z)) tg=turretTarget(st);
    let desired = tg ? Math.atan2(-(tg.x-st.x),-(tg.z-st.z)) : st._tyaw+dt*0.6;
    let dy=desired-st._tyaw; dy=((dy+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
    st._tyaw+=dy*Math.min(1,dt*6);
    for(const pi of def.headParts){ structMatrixHead(st,def.parts[pi],_doorM,st._tyaw); structMeshes.turret[pi].setMatrixAt(i,_doorM); }
    if(tg&&st.hp>0&&!NET.active){   // co-op: the SERVER simulates turret fire ('tfire')
      st._tfire=(st._tfire||0)-dt;
      if(st._tfire<=0&&Math.abs(dy)<0.5){ st._tfire=TURRET_CD; turretFire(st,tg); }
    } else st._tfire=0.4;
  }
  for(const pi of def.headParts) structMeshes.turret[pi].instanceMatrix.needsUpdate=true;
}

/* ============================================================
   CRITTERS & HUNTING (Phase 4) — passive fauna, zero threat.
   They wander, flee on approach/fire, and drop Chitin when defeated.
   Solo simulates locally; in co-op the server owns spawns/positions
   (coarse snapshots) and we interpolate, exactly like remote players.
   ============================================================ */
/* CRITTERS / CRIT_BY_PLANET imported from shared/catalog.js; CRIT_CAP from shared/constants.js */
const critters=[];                 // client entities (both solo + MP)
let critSpawnT=3, soloCritId=1;

function addChitin(n){
  n=Math.max(0,n|0); if(!n) return;
  S.res.ch=Math.min(carryCap(),(S.res.ch|0)+n);
  updateHUDRes(); SND.collect(); showToast('+'+n+' Chitin');
}
function buildCritter(type,pkey){
  const p=PLANETS[pkey], def=CRITTERS[type];
  const g=new THREE.Group();
  const mats=[], legs=[]; let head=null;
  const bodyCol = (type==='floater'||type==='skimmer')? p.nodeCol : (type==='hopper'? p.floraCol : p.surfCol2);
  const bMat = def.hover? emisMat(bodyCol,p.nodeEmis,0.9) : stdMat(bodyCol,{roughness:0.85,metalness:0.05});
  const eyeMat=emisMat(0xffe6a0,0xcc6600,1.6); mats.push(bMat,eyeMat);
  const eye=(ex,ey,ez,s,parent)=>{ const e=new THREE.Mesh(GEO.sphere,eyeMat); e.scale.set(s,s,s); e.position.set(ex,ey,ez); (parent||g).add(e); };
  const leg=(hx,hz,len)=>{ const grp=new THREE.Group(); grp.position.set(hx,def.off,hz);
    const seg=new THREE.Mesh(GEO.cyl,bMat); seg.scale.set(0.08,len,0.08); seg.position.y=-len/2; grp.add(seg); g.add(grp); legs.push(grp); };
  if(type==='skitterer'){
    const body=new THREE.Mesh(GEO.sphere,bMat); body.scale.set(0.5,0.32,0.7); body.position.y=def.off; g.add(body);
    const carap=new THREE.Mesh(GEO.dome,bMat); carap.scale.set(0.55,0.42,0.78); carap.position.y=def.off; g.add(carap);
    for(const sx of [-0.32,0.32]) for(const sz of [-0.3,0,0.3]) leg(sx,sz,def.off+0.12);
    eye(-0.14,def.off+0.12,0.34,0.08); eye(0.14,def.off+0.12,0.34,0.08);
  } else if(type==='grazer'){
    const body=new THREE.Mesh(GEO.box,bMat); body.scale.set(0.9,0.7,1.5); body.position.y=def.off; g.add(body);
    head=new THREE.Group(); head.position.set(0,def.off+0.12,0.78);
    const hm=new THREE.Mesh(GEO.box,bMat); hm.scale.set(0.5,0.45,0.5); hm.position.set(0,0,0.15); head.add(hm);
    eye(-0.15,0.05,0.4,0.07,head); eye(0.15,0.05,0.4,0.07,head);
    g.add(head);
    for(const sx of [-0.35,0.35]) for(const sz of [-0.55,0.55]) leg(sx,sz,def.off+0.05);
  } else if(type==='floater'){
    const body=new THREE.Mesh(GEO.dome,bMat); body.scale.set(0.7,0.62,0.7); g.add(body);
    const under=new THREE.Mesh(GEO.sphere,bMat); under.scale.set(0.55,0.3,0.55); under.position.y=-0.08; g.add(under);
    for(let i=0;i<5;i++){ const a=i/5*6.283; const t=new THREE.Group(); t.position.set(Math.cos(a)*0.26,-0.12,Math.sin(a)*0.26);
      const seg=new THREE.Mesh(GEO.cyl,bMat); seg.scale.set(0.05,0.7,0.05); seg.position.y=-0.35; t.add(seg); g.add(t); legs.push(t); }
    g.add(makeGlow('#'+new THREE.Color(p.nodeCol).getHexString(),1.9));
    eye(0,0.06,0.45,0.12);
  } else if(type==='skimmer'){
    const body=new THREE.Mesh(GEO.sphere,bMat); body.scale.set(0.55,0.18,0.85); g.add(body);   // flat skimming body
    const fin=new THREE.Mesh(GEO.cone,bMat); fin.scale.set(0.2,0.45,0.2); fin.rotation.x=Math.PI/2; fin.position.set(0,0.12,-0.45); g.add(fin);
    for(const sx of [-0.3,0.3]){ const l=new THREE.Group(); l.position.set(sx,-0.06,0.2);
      const seg=new THREE.Mesh(GEO.cyl,bMat); seg.scale.set(0.05,0.4,0.05); seg.position.y=-0.2; l.add(seg); g.add(l); legs.push(l); }
    g.add(makeGlow('#'+new THREE.Color(p.nodeCol).getHexString(),1.4));
    eye(-0.13,0.06,0.42,0.08); eye(0.13,0.06,0.42,0.08);
  } else { /* hopper */
    const body=new THREE.Mesh(GEO.sphere,bMat); body.scale.set(0.45,0.52,0.45); body.position.y=def.off; g.add(body);
    for(const ex of [-0.16,0.16]){ const ear=new THREE.Mesh(GEO.cone,bMat); ear.scale.set(0.12,0.36,0.12); ear.position.set(ex,def.off+0.46,0); g.add(ear); }
    for(const sx of [-0.18,0.18]) leg(sx,0,def.off);
    eye(-0.13,def.off+0.15,0.3,0.07); eye(0.13,def.off+0.15,0.3,0.07);
  }
  return {group:g,legs,head,mats};
}
function critterById(id){ for(const c of critters) if(c.id===id) return c; return null; }
function spawnCritterEntity(id,type,x,z){
  const def=CRITTERS[type]; if(!def) return null;
  const built=buildCritter(type,S.planet);
  surfScene.add(built.group);
  const p=PLANETS[S.planet];
  const c={id,type,def,pl:S.planet,group:built.group,legs:built.legs,head:built.head,mats:built.mats,
    poofCol:def.hover?p.nodeCol:p.floraCol,
    x,z,y:0,vx:0,vz:1,spd:0,state:'wander',wanderT:Math.random()*2,idleT:0,startle:0,
    animP:Math.random()*6,bobP:Math.random()*6,hopP:0,hp:def.hp,st:0,sx:undefined,sz:undefined};
  built.group.position.set(x,critGroundY(x,z)+(def.hover||def.off||0.4),z);
  critters.push(c); return c;
}
function removeCritterEntity(id){
  const i=critters.findIndex(c=>c.id===id); if(i<0) return;
  const c=critters[i]; surfScene.remove(c.group);
  if(c.mats) for(const m of c.mats){ if(m&&m.dispose) m.dispose(); }
  critters.splice(i,1);
}
function clearCritters(){ for(let i=critters.length-1;i>=0;i--) removeCritterEntity(critters[i].id); critters.length=0; }
function critterPoof(x,y,z,col){
  spawnBurst(x,y+0.3,z,col||0xcfe0d8,16,2.6,2.6,0.7,3);
  spawnBurst(x,y+0.3,z,0xffffff,6,1.6,1.6,0.4,2);
  SND.poof();
}
/* nudge nearby critters into flight when shots go off near them (solo) */
function startleCritters(x,z,r){
  if(NET.active) return; const r2=r*r;
  for(const c of critters){ const dx=c.x-x,dz=c.z-z; if(dx*dx+dz*dz<r2){ c.startle=Math.max(c.startle,1.8); c.state='flee'; } }
}
/* apply damage to a critter (server-authoritative in MP) — shared by gun/grenade/flame.
   In co-op we send the WEAPON used; the server computes damage itself. */
function damageCritter(c,dmg,wp){
  if(NET.active){ NET.send({t:'critHit',id:c.id,wp:wp===undefined?S.slot:wp}); c.startle=2; c.st=1; c.state='flee'; return; }
  c.hp-=dmg; c.startle=2.5; c.state='flee';
  if(c.hp<=0){
    const n=c.def.ch[0]+Math.floor(Math.random()*(c.def.ch[1]-c.def.ch[0]+1));
    critterPoof(c.x,c.y,c.z,c.poofCol); addChitin(n); removeCritterEntity(c.id);
  }
}
/* called by doAttack when a critter is the aim target */
function hitCritter(c,dmg,pos,wp){
  spawnBurst(pos[0],pos[1],pos[2],c.poofCol||0xffd0a0,6,1.6,1.6,0.3,2);
  damageCritter(c,dmg,wp);
}
/* ground level a critter rides at — water creatures stay on the sea surface */
function critGroundY(x,z){ const p=curP(); const g=terrainH(x,z,p); return p.water?Math.max(g,SEA_Y):g; }
/* shared placement + procedural animation */
function updateCritterMesh(c,dt,moving){
  const gy=critGroundY(c.x,c.z);
  let y;
  if(c.def.hover){ c.bobP+=dt*1.5; y=gy+c.def.hover+Math.sin(c.bobP)*c.def.bob; }
  else if(c.def.hop&&moving){ c.hopP+=dt*9; y=gy+c.def.off+Math.abs(Math.sin(c.hopP))*0.5; }
  else { y=gy+c.def.off; }
  c.y=y; c.group.position.set(c.x,y,c.z);
  if(moving){
    const yaw=Math.atan2(c.vx,c.vz);
    let d=yaw-c.group.rotation.y; d=((d+Math.PI)%6.283+6.283)%6.283-Math.PI;
    c.group.rotation.y+=d*Math.min(1,dt*8);
  }
  if(c.legs&&c.legs.length){
    if(moving){ c.animP+=dt*(c.state==='flee'?16:9);
      for(let i=0;i<c.legs.length;i++) c.legs[i].rotation.x=Math.sin(c.animP+i*1.1)*0.6; }
    else for(const l of c.legs) l.rotation.x*=0.9;
  }
  if(c.head) c.head.rotation.x=moving?Math.sin(c.animP*0.5)*0.12:Math.sin(performance.now()*0.002)*0.1;
}
function critSpawnSolo(){
  const types=CRIT_BY_PLANET[S.planet]||['skitterer'];
  for(let tries=0;tries<12;tries++){
    const ang=Math.random()*6.283, rad=50+Math.random()*260;
    const x=Math.cos(ang)*rad, z=Math.sin(ang)*rad;
    if(Math.hypot(x,z)>WORLD_R-10) continue;
    if(inSafeZone(x,z)) continue;
    const dx=x-player.x, dz=z-player.z; if(dx*dx+dz*dz<900) continue;   // spawn out of immediate view
    spawnCritterEntity('cs'+(soloCritId++),types[Math.floor(Math.random()*types.length)],x,z);
    return;
  }
}
function updateCrittersSolo(dt){
  if(S.mode!=='surface'||!surf.built) return;
  critSpawnT-=dt;
  if(critters.length<CRIT_CAP&&critSpawnT<=0){ critSpawnT=4+Math.random()*6; critSpawnSolo(); }
  const px=player.x, pz=player.z, b=beaconOnPlanet(S.planet);
  for(const c of critters){
    const def=c.def;
    const dx=c.x-px, dz=c.z-pz, pdist=Math.hypot(dx,dz);
    if(c.startle>0) c.startle-=dt;
    if(pdist<def.fleeR){
      const inv=1/(pdist||1); c.vx=dx*inv; c.vz=dz*inv; c.spd=def.speed*1.5; c.state='flee'; c.idleT=0;
    } else if(c.startle>0){
      const inv=1/(pdist||1); c.vx=dx*inv; c.vz=dz*inv; c.spd=def.speed*1.4; c.state='flee';
    } else {
      c.state='wander'; c.wanderT-=dt;
      if(c.wanderT<=0){ c.wanderT=1.5+Math.random()*3;
        if(Math.random()<0.3) c.idleT=0.6+Math.random()*1.2;
        else { const a=Math.random()*6.283; c.vx=Math.cos(a); c.vz=Math.sin(a); } }
      if(c.idleT>0){ c.idleT-=dt; c.spd=0; } else c.spd=def.speed*0.5;
    }
    c.x+=c.vx*c.spd*dt; c.z+=c.vz*c.spd*dt;
    const r=Math.hypot(c.x,c.z);
    if(r>WORLD_R-6){ c.x*=(WORLD_R-6)/r; c.z*=(WORLD_R-6)/r; c.vx=-c.vx; c.vz=-c.vz; }
    if(b){ const bx=c.x-b.x, bz=c.z-b.z, bd=Math.hypot(bx,bz);
      if(bd<SAFE_R+2){ const f=(SAFE_R+2)/(bd||1); c.x=b.x+bx*f; c.z=b.z+bz*f; c.vx=bx/(bd||1); c.vz=bz/(bd||1); } }
    updateCritterMesh(c,dt,c.spd>0.1);
  }
}
function applyCritSnap(pl,list){
  if(!NET.active) return;
  /* ignore snapshots for other planets — transitions clear critters explicitly */
  if(pl!==S.planet||S.mode!=='surface') return;
  const seen=new Set();
  for(const it of list){
    if(!CRITTERS[it.ty]) continue;
    seen.add(it.id);
    let c=critterById(it.id);
    if(!c) c=spawnCritterEntity(it.id,it.ty,it.x,it.z);
    if(c){ c.sx=it.x; c.sz=it.z; c.st=it.st|0; }
  }
  for(let i=critters.length-1;i>=0;i--) if(!seen.has(critters[i].id)) removeCritterEntity(critters[i].id);
}
function updateCrittersMP(dt){
  for(const c of critters){
    if(c.sx===undefined) continue;
    const ox=c.x, oz=c.z, k=Math.min(1,dt*6);
    c.x=lerp(c.x,c.sx,k); c.z=lerp(c.z,c.sz,k);
    const mvx=c.x-ox, mvz=c.z-oz, ms=Math.hypot(mvx,mvz);
    if(ms>0.001){ c.vx=mvx/ms; c.vz=mvz/ms; }
    c.state=c.st===1?'flee':'wander';
    updateCritterMesh(c,dt,ms>dt*0.4);
  }
}
function onCritDead(m){
  const c=critterById(m.id);
  const x=c?c.x:m.x, z=c?c.z:m.z, y=c?c.y:terrainH(m.x,m.z,curP())+0.4;
  critterPoof(x,y,z,c?c.poofCol:0xcfe0d8);
  if(c) removeCritterEntity(m.id);
  /* the Chitin grant arrives via the server's prog snapshot */
}
function updateCritters(dt){ if(NET.active) updateCrittersMP(dt); else updateCrittersSolo(dt); }
function soloSpawnInitial(){
  if(NET.active) return;
  const n=Math.min(CRIT_CAP,6+Math.floor(Math.random()*3));
  for(let i=0;i<n;i++) critSpawnSolo();
  critSpawnT=4+Math.random()*6;
}

/* ============================================================
   HEAVY WEAPONS (Phase 5) — Plasma Grenade, Deployable Shield,
   Lance Beam, Inferno Thrower. Throwables + shield walls are
   client-relayed (transient combat fx); damage stays client-
   authoritative (each victim applies to itself), critters go
   through the server like all other critter damage.
   ============================================================ */
SND.lance=function(){ this.tone(220,0.5,'sawtooth',0.09,1400); setTimeout(()=>this.tone(900,0.18,'square',0.05,300),30); };
SND.flame=function(){ this.tone(120+Math.random()*60,0.16,'sawtooth',0.035,70); };
SND.throwG=function(){ this.tone(360,0.12,'triangle',0.06,180); };
SND.boom=function(){ this.tone(70,0.5,'sawtooth',0.14,28); setTimeout(()=>this.tone(140,0.3,'square',0.07,40),20); };
SND.shieldUp=function(){ [330,494,659].forEach((f,i)=>setTimeout(()=>this.tone(f,0.16,'sine',0.06),i*55)); };
SND.shieldHit=function(){ this.tone(720,0.12,'sine',0.05,420); };

/* GREN_* / SHIELD_LIFE / SHIELD_CD imported from shared/constants.js */
let nadeCd=0, shieldCd=0, infDmgT=0, infFlameT=0, infNetT=0;
const throwables=[];     // {kind,mesh,x,y,z,vx,vy,vz,fuse,owned,yaw0}
const shieldWalls=[];    // {x,y,z,yaw,hw,h,t,owned,mesh}

/* ---- viewmodel meshes for thrown devices ---- */
function makeGrenadeProj(){
  const g=new THREE.Group();
  const b=new THREE.Mesh(GEO.sphere,stdMat(0x2f5238,{roughness:0.5,metalness:0.4})); b.scale.set(0.22,0.26,0.22); g.add(b);
  const r=new THREE.Mesh(GEO.cyl,emisMat(0x7fff9a,0x20cc55,2.0)); r.scale.set(0.26,0.06,0.26); g.add(r); g.userData.ring=r;
  return g;
}
function makeShieldProj(){
  const g=new THREE.Group();
  const d=new THREE.Mesh(GEO.cyl,stdMat(0x3a5a72,{roughness:0.4,metalness:0.6})); d.scale.set(0.34,0.12,0.34); d.rotation.z=Math.PI/2; g.add(d);
  const c=new THREE.Mesh(GEO.sphere,emisMat(0x7fdcff,0x1080cc,1.9)); c.scale.set(0.14,0.14,0.14); g.add(c);
  return g;
}
function addThrowable(kind,o,v,owned){
  const mesh=kind==='grenade'?makeGrenadeProj():makeShieldProj();
  mesh.position.set(o[0],o[1],o[2]); surfScene.add(mesh);
  throwables.push({kind,mesh,x:o[0],y:o[1],z:o[2],vx:v[0],vy:v[1],vz:v[2],fuse:GREN_FUSE,owned:!!owned,yaw0:Math.atan2(v[0],v[2])});
}
function removeThrowable(i){ const t=throwables[i]; if(t){ surfScene.remove(t.mesh); throwables.splice(i,1); } }
function clearThrowables(){ for(let i=throwables.length-1;i>=0;i--) removeThrowable(i); }
function updateThrowables(dt){
  for(let i=throwables.length-1;i>=0;i--){
    const t=throwables[i];
    t.vy-=18*dt;
    t.x+=t.vx*dt; t.y+=t.vy*dt; t.z+=t.vz*dt;
    const gy=groundYAt(t.x,t.z,1e9);
    if(t.y<=gy+0.22){
      if(t.kind==='shield'){ deployShieldWall(t); removeThrowable(i); continue; }
      t.y=gy+0.22; t.vy*=-0.4; t.vx*=0.55; t.vz*=0.55;
      if(Math.abs(t.vy)<1.2){ t.vy=0; t.vx*=0.6; t.vz*=0.6; }
    }
    const r=Math.hypot(t.x,t.z); if(r>WORLD_R-2){ t.x*=(WORLD_R-2)/r; t.z*=(WORLD_R-2)/r; t.vx*=-0.4; t.vz*=-0.4; }
    t.mesh.position.set(t.x,t.y,t.z); t.mesh.rotation.x+=dt*4; t.mesh.rotation.y+=dt*3;
    if(t.kind==='grenade'){
      t.fuse-=dt;
      const blink=t.fuse<1?(Math.sin(performance.now()*0.02*(2-t.fuse))>0):true;
      if(t.mesh.userData.ring) t.mesh.userData.ring.visible=blink;
      if(Math.random()<dt*8) spawnBurst(t.x,t.y+0.1,t.z,0x7fff9a,1,0.6,0.6,0.3,2);
      if(t.fuse<=0){ explodeGrenade(t); removeThrowable(i); }
    }
  }
}
function explodeGrenade(t){
  const fl=makeGlow('#ffd070',14); fl.position.set(t.x,t.y+0.6,t.z); pushFx(fl,0.18,0.95);
  spawnBurst(t.x,t.y+0.3,t.z,0xff8020,34,8,8,0.9,4);
  spawnBurst(t.x,t.y+0.3,t.z,0xffe070,16,5,6,0.6,2);
  spawnBurst(t.x,t.y+0.2,t.z,0x553028,14,5,4,1.4,2);
  SND.boom();
  /* players: each client applies blast to ITSELF (safe zone / invuln respected) */
  const dx=player.x-t.x, dy=(player.y+1)-t.y, dz=player.z-t.z, d=Math.hypot(dx,dy,dz);
  if(d<GREN_R){ const dmg=Math.round(GREN_DMG*(1-d/GREN_R)); if(dmg>0) applyDamageToSelf(dmg); }
  /* critters: solo only — in co-op the server resolves the blast on its own sim */
  if(t.owned&&!NET.active){
    for(let k=critters.length-1;k>=0;k--){ const c=critters[k]; if(c.pl!==S.planet) continue;
      const cd=Math.hypot(c.x-t.x,(c.y+0.4)-t.y,c.z-t.z);
      if(cd<GREN_R) damageCritter(c,Math.round(GREN_DMG*(1-cd/GREN_R)),6);
    }
  }
  /* grenades do NOT damage structures (by design) */
}
/* ---- deployable shield walls ---- */
function deployShieldWall(t){ addShieldWall(t.x,terrainH(t.x,t.z,curP()),t.z,t.yaw0,t.owned); }
function addShieldWall(x,baseY,z,yaw,owned){
  const W=5, H=3.2;
  const g=new THREE.Group();
  const panel=new THREE.Mesh(GEO.box,new THREE.MeshBasicMaterial({color:0x4fc9ff,transparent:true,opacity:0.22,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  panel.scale.set(W,H,0.12); panel.position.y=H/2; g.add(panel);
  const wire=new THREE.Mesh(new THREE.BoxGeometry(W,H,0.12),new THREE.MeshBasicMaterial({color:0x9fe6ff,wireframe:true,transparent:true,opacity:0.5,depthWrite:false}));
  wire.position.y=H/2; g.add(wire);
  for(const sx of [-W/2,W/2]){ const post=new THREE.Mesh(GEO.cyl,MAT.metal); post.scale.set(0.12,H,0.12); post.position.set(sx,H/2,0); g.add(post); }
  g.position.set(x,baseY,z); g.rotation.y=yaw; surfScene.add(g);
  shieldWalls.push({x,y:baseY,z,yaw,hw:W/2,h:H,t:SHIELD_LIFE,owned:!!owned,mesh:g,panel});
  SND.shieldUp();
  spawnBurst(x,baseY+H*0.5,z,0x7fdcff,18,3,4,0.7,1);
}
function removeShieldWall(i){ const w=shieldWalls[i]; if(w){ surfScene.remove(w.mesh); shieldWalls.splice(i,1); } }
function clearShieldWalls(){ for(let i=shieldWalls.length-1;i>=0;i--) removeShieldWall(i); }
function updateShieldWalls(dt){
  for(let i=shieldWalls.length-1;i>=0;i--){
    const w=shieldWalls[i]; w.t-=dt;
    if(w.t<=0){ removeShieldWall(i); continue; }
    w.panel.material.opacity=0.12+0.12*Math.abs(Math.sin(performance.now()*0.004))*(w.t<3?w.t/3:1);
  }
}
/* segment(o->e) vs shield-wall rectangles — shared logic over local walls */
function shotBlocked(o,e){ return R.shotBlocked(shieldWalls,o,e); }
/* ---- throwing ---- */
function throwGadget(w){
  if(w.thrown==='grenade'){
    if(inSafeZone(player.x,player.z)){ SND.denied(); showToast('Weapons disabled in safe zone'); return; }
    if((S.ammo.nade|0)<=0){ SND.denied(); showToast('No Plasma Grenades — craft at an Armory'); return; }
    if(nadeCd>0) return; nadeCd=0.55;
    S.ammo.nade--; renderHotbar();
    camWorld();
    const o=[_cw.x+_cf.x*0.5,_cw.y+_cf.y*0.5,_cw.z+_cf.z*0.5];
    const v=[_cf.x*22,_cf.y*22+3.5,_cf.z*22];
    addThrowable('grenade',o,v,true); SND.throwG();
    if(NET.active) NET.send({t:'nade',o:o.map(n=>+n.toFixed(2)),v:v.map(n=>+n.toFixed(2))});
  } else { /* shield */
    if(shieldCd>0){ SND.denied(); showToast('Shield recharging — '+Math.ceil(shieldCd)+'s'); return; }
    shieldCd=SHIELD_CD;
    camWorld();
    const o=[_cw.x+_cf.x*0.5,_cw.y+_cf.y*0.5,_cw.z+_cf.z*0.5];
    const v=[_cf.x*16,_cf.y*16+2.5,_cf.z*16];
    addThrowable('shield',o,v,true); SND.throwG();
    if(NET.active) NET.send({t:'shield',o:o.map(n=>+n.toFixed(2)),v:v.map(n=>+n.toFixed(2))});
    showToast('Shield deployed'); renderHotbar();
  }
}
function onRemoteNade(m){
  const r=remotes.get(m.by); if(S.mode!=='surface'||(r&&r.pl!==S.planet)) return;
  if(Array.isArray(m.o)&&Array.isArray(m.v)) addThrowable('grenade',m.o,m.v,false);
}
function onRemoteShield(m){
  const r=remotes.get(m.by); if(S.mode!=='surface'||(r&&r.pl!==S.planet)) return;
  if(Array.isArray(m.o)&&Array.isArray(m.v)) addThrowable('shield',m.o,m.v,false);
}
/* ---- inferno cone ---- */
function fireInferno(w){
  if(weaponCd>0) return; weaponCd=w.cd;
  if(S.ammo.fuel<=0){ SND.denied(); showToast('Out of Fuel'); weaponCd=0.4; renderHotbar(); return; }
  camWorld();
  /* flame visual every shot */
  for(let i=0;i<3;i++){ const sp=1.5+Math.random()*(w.range-1.5);
    const px=_cw.x+_cf.x*sp+(Math.random()-0.5)*sp*0.18, py=_cw.y+_cf.y*sp+(Math.random()-0.5)*sp*0.14, pz=_cw.z+_cf.z*sp+(Math.random()-0.5)*sp*0.18;
    spawnBurst(px,py,pz,i%2?0xff7020:0xffb050,1,1.6,1.0,0.4,-1.5); }
  infFlameT-=w.cd; if(infFlameT<=0){ infFlameT=0.11; SND.flame(); }
  /* fuel + damage on a slower cadence to keep network/damage sane */
  infDmgT-=w.cd;
  if(infDmgT<=0){
    infDmgT=0.12;
    S.ammo.fuel=Math.max(0,S.ammo.fuel-1); renderHotbar();
    const safe=inSafeZone(player.x,player.z);
    for(let k=critters.length-1;k>=0;k--){ const c=critters[k]; if(c.pl!==S.planet) continue;
      const dx=c.x-_cw.x, dy=(c.y+0.4)-_cw.y, dz=c.z-_cw.z, d=Math.hypot(dx,dy,dz);
      if(d>w.range||d<0.1) continue;
      if((dx/d)*_cf.x+(dy/d)*_cf.y+(dz/d)*_cf.z<w.coneCos) continue;
      damageCritter(c,w.dmg,5);
    }
    if(NET.active){
      const tip=aimPoint(w.range);
      let sent=false;
      if(!safe) for(const [pid,r] of remotes){ if(!r.avatar.visible) continue;
        const ctr=avatarHitCenter(r), dx=ctr[0]-_cw.x,dy=ctr[1]-_cw.y,dz=ctr[2]-_cw.z, d=Math.hypot(dx,dy,dz);
        if(d>w.range||d<0.1) continue;
        if((dx/d)*_cf.x+(dy/d)*_cf.y+(dz/d)*_cf.z<w.coneCos) continue;
        if(inSafeZone(r.avatar.position.x,r.avatar.position.z)) continue;
        NET.send({t:'fire',wp:5,o:[+_cw.x.toFixed(2),+_cw.y.toFixed(2),+_cw.z.toFixed(2)],p:[+ctr[0].toFixed(2),+ctr[1].toFixed(2),+ctr[2].toFixed(2)],target:pid}); sent=true;
      }
      const nw=performance.now();
      if(!sent&&nw-infNetT>150){ infNetT=nw;
        NET.send({t:'fire',wp:5,o:[+_cw.x.toFixed(2),+_cw.y.toFixed(2),+_cw.z.toFixed(2)],p:[+tip[0].toFixed(2),+tip[1].toFixed(2),+tip[2].toFixed(2)]}); }
    }
  }
}
/* ---- grenade throw arc preview ---- */
let nadeArc=null, nadeRing=null;
(function(){
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(22*3),3));
  nadeArc=new THREE.Line(g,new THREE.LineBasicMaterial({color:0x7fff9a,transparent:true,opacity:0.8,depthTest:false}));
  nadeArc.frustumCulled=false; nadeArc.renderOrder=998; nadeArc.visible=false; surfScene.add(nadeArc);
  nadeRing=new THREE.Mesh(new THREE.TorusGeometry(0.7,0.07,6,18),new THREE.MeshBasicMaterial({color:0x7fff9a,transparent:true,opacity:0.9,depthTest:false}));
  nadeRing.rotation.x=-Math.PI/2; nadeRing.renderOrder=998; nadeRing.visible=false; surfScene.add(nadeRing);
})();
function updateNadeAim(){
  const show=S.mode==='surface'&&!driving&&!buildSel&&!paintMode&&!bpStamp&&SLOT_KEYS[S.slot]==='grenade'&&(S.ammo.nade|0)>0;
  nadeArc.visible=show; nadeRing.visible=show;
  if(!show) return;
  camWorld();
  let x=_cw.x+_cf.x*0.5, y=_cw.y+_cf.y*0.5, z=_cw.z+_cf.z*0.5;
  let vx=_cf.x*22, vy=_cf.y*22+3.5, vz=_cf.z*22;
  const pos=nadeArc.geometry.attributes.position.array;
  const step=0.05; let n=0, lx=x,ly=y,lz=z;
  for(let i=0;i<22;i++){
    pos[i*3]=x; pos[i*3+1]=y; pos[i*3+2]=z; lx=x; ly=y; lz=z; n=i;
    vy-=18*step; x+=vx*step; y+=vy*step; z+=vz*step;
    if(y<=groundYAt(x,z,1e9)+0.2){ pos[(i+1>21?21:i+1)*3]=x; break; }
  }
  for(let i=n+1;i<22;i++){ pos[i*3]=lx; pos[i*3+1]=ly; pos[i*3+2]=lz; }
  nadeArc.geometry.attributes.position.needsUpdate=true;
  nadeRing.position.set(lx,groundYAt(lx,lz,1e9)+0.08,lz);
}
function updateHeavyWeapons(dt){
  nadeCd=Math.max(0,nadeCd-dt); shieldCd=Math.max(0,shieldCd-dt);
  updateThrowables(dt); updateShieldWalls(dt);
  /* Lance emitter visibly winds up while the (slow) cooldown recovers — visual only */
  const lv=weaponVM.lance;
  if(lv&&lv.visible){
    const w=curWeapon(); const charge=w.lance?clamp(1-weaponCd/w.cd,0,1):1;
    const muz=lv.getObjectByName('muz');
    if(muz){ muz.material.emissiveIntensity=0.3+1.9*charge; const s=0.05*(0.5+0.5*charge); muz.scale.set(s,s,s); }
  }
}
function primaryDown(){
  if(S.mode!=='surface'||driving||buildSel||paintMode||bpStamp) return;
  if(S.slot<=0) return;
  const w=curWeapon();
  if(w.thrown) throwGadget(w); else fireHeld=true;
}

/* ============================================================
   DAY / NIGHT CYCLE (Phase 3) — shared ~10 min cycle per planet
   ============================================================ */
/* CYCLE_S imported from shared/constants.js */
let dayClock=300;                 // seconds; start near noon (tod 0.5)
const dnBaseFog=new THREE.Color(), dnBaseSky=new THREE.Color();
const _ngSky=new THREE.Color(0x05070d), _ngFog=new THREE.Color(0x080c16);
let surfStars=null;
(function(){
  const n=900, sp=new Float32Array(n*3), rng=mulberry32(555);
  for(let i=0;i<n;i++){ const r=900,th=rng()*Math.PI*2,ph=Math.acos(rng());
    sp[i*3]=r*Math.sin(ph)*Math.cos(th); sp[i*3+1]=r*Math.cos(ph)+15; sp[i*3+2]=r*Math.sin(ph)*Math.sin(th); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(sp,3));
  surfStars=new THREE.Points(g,new THREE.PointsMaterial({color:0xcfe0ff,size:2,sizeAttenuation:false,transparent:true,opacity:0,depthWrite:false}));
  surfStars.frustumCulled=false; surfScene.add(surfStars);
})();
function todNow(){ return R.todOf(dayClock); }
function meteorActiveNow(){
  if(NET.active){ const m=NET.meteor[S.planet]; return !!(m&&m.phase&&m.phase!=='idle'); }
  return meteorState.phase==='warning'||meteorState.phase==='active';
}
function applyDayNight(){
  if(!surf.built) return;
  const p=curP(), tod=todNow();
  const sunUp=Math.sin((tod-0.25)*Math.PI*2);      // 1 noon, -1 midnight
  const day=clamp((sunUp+0.25)/1.15,0,1);
  if(surf.hemi) surf.hemi.intensity=0.12+0.78*day;
  if(surf.dirLight) surf.dirLight.intensity=0.08+1.2*day;
  if(surf.amb) surf.amb.intensity=0.16+0.34*day;
  dnBaseSky.copy(_ngSky).lerp(_tmpC.set(p.sky),day);
  dnBaseFog.copy(_ngFog).lerp(_tmpC.set(p.fog),day);
  surfScene.background=dnBaseSky;
  if(!meteorActiveNow()&&surfScene.fog) surfScene.fog.color.copy(dnBaseFog);
  if(surfStars) surfStars.material.opacity=clamp(1-day*1.3,0,1)*0.9;
  /* lamps/beacons glow stronger after dark so they actually matter at night */
  const glowK=0.45+0.95*(1-day);
  for(const gl of structGlows) gl.material.opacity=Math.min(1,gl.userData._o0*glowK);
}
const _tmpC=new THREE.Color(), _tmpC2=new THREE.Color();

/* ============================================================
   METEOR SHOWERS
   ============================================================ */
const meteors=[]; // {mesh,glow,vx,vy,vz,tx,ty,tz}
const METEOR_MAT=emisMat(0xffa040,0xcc3300,2.2);
const meteorState={phase:'idle', t:120+Math.random()*120, klaxT:0, hits:0};
function baseCentroid(){
  let n=0,x=0,z=0;
  for(const st of S.structures){ if(st.pl===S.planet){x+=st.x;z+=st.z;n++;} }
  if(!n) return {x:player.x,z:player.z};
  return {x:x/n,z:z/n};
}
function spawnMeteor(){
  const c=baseCentroid();
  const tx=c.x+(Math.random()-0.5)*90, tz=c.z+(Math.random()-0.5)*90;
  const ang=Math.random()*Math.PI*2, dist=140;
  const sx=tx+Math.cos(ang)*dist*0.4, sz=tz+Math.sin(ang)*dist*0.4;
  spawnMeteorAt(tx,tz,sx,sz);
}
function spawnMeteorAt(tx,tz,sx,sz){
  const ty=terrainH(tx,tz,curP());
  const h=160;
  const mesh=new THREE.Mesh(GEO.ico,METEOR_MAT);
  const sc=0.8+Math.random()*1.4; mesh.scale.set(sc,sc,sc);
  mesh.position.set(sx,h,sz);
  const glow=makeGlow('#ff9a50',7); glow.position.copy(mesh.position);
  surfScene.add(mesh); surfScene.add(glow);
  const T=2.2;
  meteors.push({mesh,glow,vx:(tx-sx)/T,vy:(ty-h)/T,vz:(tz-sz)/T,tx,ty,tz});
}
function meteorImpact(m){
  spawnBurst(m.tx,m.ty+0.5,m.tz,0xffa040,26,9,8,1.1,9);
  spawnBurst(m.tx,m.ty+0.5,m.tz,0x885040,14,5,5,1.6,4);
  SND.impact();
  if(NET.active) return; /* co-op: damage is resolved by the server (hp/destroyed messages) */
  if(meteorState.hits>=6) return; // damage cap per shower
  for(const st of S.structures.slice()){
    if(st.pl!==S.planet) continue;
    const dx=st.x-m.tx, dz=st.z-m.tz;
    if(dx*dx+dz*dz>49) continue;
    if(st.t==='beacon') continue;
    let shielded=false;
    for(const d of shieldDomes){
      if(d.st.hp<=0) continue;
      const ddx=m.tx-d.x, ddz=m.tz-d.z;
      if(ddx*ddx+ddz*ddz<d.r*d.r){ shielded=true; break; }
    }
    if(shielded) continue;
    meteorState.hits++;
    st.hp-=35;
    const def=CAT[st.t];
    if(st.hp<=0){
      if(def.noKill){ st.hp=10; showToast(def.name+' badly damaged — repair it!'); }
      else {
        S.structures.splice(S.structures.indexOf(st),1);
        showToast(def.name+' destroyed by meteor!');
      }
    }
    refreshStructures();
    if(meteorState.hits>=6) break;
  }
}
function domeBlockCheck(m){
  for(const d of shieldDomes){
    if(d.st.hp<=0) continue;
    const dx=m.mesh.position.x-d.x, dy=m.mesh.position.y-d.y, dz=m.mesh.position.z-d.z;
    if(dx*dx+dy*dy+dz*dz<d.r*d.r){
      spawnBurst(m.mesh.position.x,m.mesh.position.y,m.mesh.position.z,0x7fdcff,20,7,4,0.8,2);
      d.mesh.material.opacity=0.45; SND.impact();
      return true;
    }
  }
  return false;
}
let netKlaxT=0, netBanner=false;
function netMeteorTick(dt){
  const st=NET.meteor[S.planet];
  const now=performance.now();
  const showing=st&&st.phase!=='idle'&&now<st.endAt+5000;
  if(!showing){
    if(netBanner){
      netBanner=false;
      $('banner').classList.add('hidden');
      if(surfScene.fog) surfScene.fog.color.copy(dnBaseFog);
    }
    return;
  }
  if(!netBanner){ netBanner=true; $('banner').classList.remove('hidden'); }
  if(st.phase==='warning'){
    const secs=Math.max(0,Math.ceil((st.endAt-now)/1000));
    $('banner').textContent='⚠ METEOR SHOWER INBOUND — '+secs+'s ⚠';
    netKlaxT-=dt;
    if(netKlaxT<=0){ SND.klaxon(); netKlaxT=1.1; }
    surfScene.fog.color.lerpColors(dnBaseFog,_tmpC2.set(0x661a0a),0.35+0.25*Math.sin(performance.now()*0.008));
  } else {
    $('banner').textContent='☄ METEOR SHOWER IN PROGRESS ☄';
  }
}
function updateMeteors(dt){
  if(S.mode!=='surface'){ return; }
  if(NET.active){ netMeteorTick(dt); updateMeteorVisuals(dt); return; }
  const ms=meteorState;
  if(ms.phase==='idle'){
    ms.t-=dt;
    if(ms.t<=0){ ms.phase='warning'; ms.t=20; ms.klaxT=0; ms.hits=0;
      $('banner').classList.remove('hidden');
      $('banner').textContent='⚠ METEOR SHOWER INBOUND — 20s — GET TO SHELTER ⚠'; }
  } else if(ms.phase==='warning'){
    ms.t-=dt; ms.klaxT-=dt;
    $('banner').textContent='⚠ METEOR SHOWER INBOUND — '+Math.ceil(ms.t)+'s ⚠';
    if(ms.klaxT<=0){ SND.klaxon(); ms.klaxT=1.1; }
    surfScene.fog.color.lerpColors(dnBaseFog,_tmpC2.set(0x661a0a),0.35+0.25*Math.sin(performance.now()*0.008));
    if(ms.t<=0){ ms.phase='active'; ms.t=12; ms.klaxT=0;
      $('banner').textContent='☄ METEOR SHOWER IN PROGRESS ☄'; }
  } else if(ms.phase==='active'){
    ms.t-=dt; ms.klaxT-=dt;
    if(ms.klaxT<=0&&meteors.length<10){ spawnMeteor(); ms.klaxT=0.55+Math.random()*0.6; }
    if(ms.t<=0){ ms.phase='idle'; ms.t=170+Math.random()*140;
      $('banner').classList.add('hidden');
      surfScene.fog.color.copy(dnBaseFog); }
  }
  updateMeteorVisuals(dt);
}
function updateMeteorVisuals(dt){
  for(let i=meteors.length-1;i>=0;i--){
    const m=meteors[i];
    m.mesh.position.x+=m.vx*dt; m.mesh.position.y+=m.vy*dt; m.mesh.position.z+=m.vz*dt;
    m.glow.position.copy(m.mesh.position);
    if(Math.random()<dt*22) spawnBurst(m.mesh.position.x,m.mesh.position.y,m.mesh.position.z,0xff8030,1,1,0.5,0.5,-1);
    let done=false;
    if(domeBlockCheck(m)) done=true;
    else if(m.mesh.position.y<=m.ty+0.6){ meteorImpact(m); done=true; }
    if(done){ surfScene.remove(m.mesh); surfScene.remove(m.glow); m.mesh.geometry===GEO.ico||m.mesh.geometry.dispose(); meteors.splice(i,1); }
  }
  for(const d of shieldDomes){ if(d.mesh.material.opacity>0.1) d.mesh.material.opacity=Math.max(0.1,d.mesh.material.opacity-dt*0.5); }
  /* smoke from damaged structures */
  if(Math.random()<dt*4){
    for(const st of S.structures){
      if(st.pl!==S.planet) continue;
      if(st.hp<CAT[st.t].hp*0.6&&Math.random()<0.4){
        spawnBurst(st.x,st.y+1.6,st.z,0x555555,2,0.8,1.6,1.6,-1.2);
        if(Math.random()<0.3) spawnBurst(st.x,st.y+1.2,st.z,0xffcc55,1,1.2,1.6,0.3,5);
      }
    }
  }
}
function clearMeteors(){
  for(const m of meteors){ surfScene.remove(m.mesh); surfScene.remove(m.glow); }
  meteors.length=0;
  meteorState.phase='idle'; meteorState.t=120+Math.random()*120;
  netBanner=false;
  $('banner').classList.add('hidden');
}
/* ============================================================
   HUD / PANELS / MENUS
   ============================================================ */
let toastTimer=null;
function showToast(msg,dur){
  const t=$('toast'); t.textContent=msg; t.style.opacity=1;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{t.style.opacity=0;},dur||2400);
}
function updateHUDRes(){
  $('rFe').textContent=S.res.fe; $('rCy').textContent=S.res.cy; $('rBio').textContent=S.res.bio; $('rCh').textContent=S.res.ch|0; $('rPe').textContent=S.res.pe|0;
  $('resPearl').classList.toggle('hidden', !(S.tier>=5||(S.res.pe|0)>0));
}
function updateTierBadge(){ $('tierBadge').textContent='TIER '+S.tier+' ▸'; }
function setPrompt(html){ $('prompt').innerHTML=html; }
function setMAct(label){ $('mAct').textContent=label; }
function flashFx(){ const f=$('flash'); f.style.transition='none'; f.style.opacity=0.85;
  requestAnimationFrame(()=>{ f.style.transition='opacity 1.2s'; f.style.opacity=0; }); }

const PANELS=['buildMenu','tierMenu','settings','mpSetup','craftMenu','paintPanel','blueprintPanel','stationMenu'];
function anyPanelOpen(){ return PANELS.some(p=>!$(p).classList.contains('hidden')); }
function closePanel(id){ $(id).classList.add('hidden'); }
function closeAllPanels(){ PANELS.forEach(closePanel); }
function openPanel(id){
  closeAllPanels();
  $(id).classList.remove('hidden');
  if(document.pointerLockElement) document.exitPointerLock();
}
document.querySelectorAll('.closeX').forEach(b=>b.addEventListener('click',()=>closePanel(b.dataset.close)));

function renderBuildGrid(){
  const grid=$('buildGrid'); grid.innerHTML='';
  const addSection=t=>{ const d=document.createElement('div'); d.className='bSection'; d.textContent=t; grid.appendChild(d); };
  const addItem=key=>{
    const def=CAT[key];
    const locked=def.tier>0&&def.tier>S.tier;
    const d=document.createElement('div');
    d.className='bItem'+(locked?' locked':'');
    d.innerHTML='<div class="ic">'+def.ic+'</div><div class="nm">'+def.name+'</div><div class="cs">'+
      Object.keys(def.cost).map(k=>'<span style="color:'+RES_DOTS[k]+'">'+def.cost[k]+'</span>').join(' · ')+'</div>'+
      (locked?'<div class="lk">TIER '+def.tier+'</div>':'');
    if(!locked) d.addEventListener('click',()=>{ SND.blip(); selectBuild(key); });
    grid.appendChild(d);
  };
  addSection('Tools');
  const tool=(ic,nm,fn)=>{ const d=document.createElement('div'); d.className='bItem'; d.innerHTML='<div class="ic">'+ic+'</div><div class="nm">'+nm+'</div><div class="cs">free</div>'; d.addEventListener('click',()=>{ SND.blip(); fn(); }); grid.appendChild(d); };
  tool('◑','Paint Tool',()=>{ renderPaintGrid(); openPanel('paintPanel'); });
  tool('▤','Blueprints',openBlueprints);
  addSection('Structures');
  for(const k of ['floor','halffloor','foundation','wall','halfwall','window','door','ramp','beam','pillar','pillar2','pillar3','flatroof','dome','roof45','roofcorner','lightpole','crate','relay','shieldgen','armory','turret','rover','beacon']) addItem(k);
  addSection('Decorations — any tier');
  for(const k of ['flag','planter','holosign','lampR','lampG','lampB','table','antenna']) addItem(k);
  addSection('Furniture & Interior');
  for(const k of ['bed','chair','console','shelf','rug','ceilinglight','locker','railing']) addItem(k);
}
function renderTierList(){
  const list=$('tierList'); list.innerHTML='';
  for(const td of TIERS){
    const row=document.createElement('div');
    row.className='tierRow'+(td.n===S.tier?' cur':'');
    let h='<h3>TIER '+td.n+(td.n<=S.tier?' <span class="done">— UNLOCKED ✓</span>':'')+'</h3><ul>'+
      td.perks.map(p=>'<li>'+p+'</li>').join('')+'</ul>';
    if(td.cost&&td.n>S.tier) h+='<div class="cost">Cost: '+costStr(td.cost)+'</div>';
    row.innerHTML=h;
    if(td.n===S.tier+1){
      const btn=document.createElement('button');
      btn.className='unlockBtn';
      btn.textContent=canAfford(td.cost)?('UNLOCK TIER '+td.n):('UNLOCK TIER '+td.n+' — need more resources');
      btn.disabled=!canAfford(td.cost);
      btn.addEventListener('click',()=>unlockTier(td.n));
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
}
function unlockTier(n){
  const td=TIERS[n-1];
  if(n!==S.tier+1||!canAfford(td.cost)){ SND.denied(); return; }
  if(NET.active){ NET.send({t:'tierUp'}); return; }   // server validates, pays & confirms
  payCost(td.cost);
  applyTierUp(n);
}
function applyTierUp(n){
  const td=TIERS[n-1];
  S.tier=n;
  SND.tierUp(); flashFx();
  spawnBurst(player.x,player.y+1.5,player.z,0x9feaff,30,5,6,1.3,4);
  showToast('⬆ TIER '+n+' UNLOCKED — '+td.perks[0],3500);
  if(n>=2) S.o2=Math.max(S.o2,o2Max()*0.7);
  if(n>=5) S.o2=Math.max(S.o2,o2Max()*0.6);     // bigger tank on tier 5
  if(n===3){
    $('fuelwrap').classList.remove('hidden');
    S.pendingCutscene='verdant';
    if(S.mode==='space') startShieldCutscene('verdant');
    else showToast('⬆ TIER 3 — Jetpack online. Verdant signal shield is collapsing... visible from orbit.',4500);
  }
  if(n===5){
    S.pendingCutscene='pelagos';
    if(S.mode==='space') startShieldCutscene('pelagos');
    else showToast('⬆ TIER 5 — Hover Module & O₂ tank online. Pelagos signal shield is collapsing... visible from orbit.',4500);
  }
  updateStationVisibility();
  updateTierBadge(); renderTierList(); renderBuildGrid(); renderCraftGrid(); saveGame();
}
function triggerVictory(){
  if(S.victoryShown){ showToast('Beacon placed.'); return; }
  S.victoryShown=true;
  SND.victory();
  const b=S.structures.find(s=>s.t==='beacon');
  if(b) for(let i=0;i<9;i++) setTimeout(()=>{
    spawnBurst(b.x+(Math.random()-0.5)*12,b.y+4+Math.random()*8,b.z+(Math.random()-0.5)*12,
      [0x7fff9a,0x9feaff,0xffd97f][i%3],22,7,5,1.4,4);
  },i*450);
  setTimeout(()=>{ $('victory').classList.remove('hidden'); if(document.pointerLockElement) document.exitPointerLock(); },1400);
}
$('btnVicClose').addEventListener('click',()=>{ $('victory').classList.add('hidden'); SND.blip(); });

/* ============================================================
   INPUT — desktop + mobile
   ============================================================ */
const isTouch=('ontouchstart' in window)||navigator.maxTouchPoints>0;
if(isTouch) document.body.classList.add('touch');
const keys={};
let justE=false, joy={x:0,y:0,active:false,id:-1}, lookTouch={id:-1,lx:0,ly:0};

document.addEventListener('keydown',e=>{
  if(e.target&&(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT')) return;
  if(e.code==='Space') e.preventDefault();
  if(e.repeat) return;
  keys[e.code]=true;
  if(!S.running) return;
  if(e.code==='KeyE') justE=true;
  if(e.code==='KeyB'){ if(anyPanelOpen()){closeAllPanels();} else if(S.mode==='surface'){ renderBuildGrid(); openPanel('buildMenu'); } else if(S.mode==='eva'){ renderStationGrid(); openPanel('stationMenu'); } else showToast('Land on a planet to build'); }
  if(e.code==='KeyT'){ if(anyPanelOpen()){closeAllPanels();} else { renderTierList(); openPanel('tierMenu'); } }
  if(e.code==='KeyR'){ if(buildSel) ghostRot=(ghostRot+1)%4; else if(bpStamp) bpStampRot=(bpStampRot+1)%4; else if(stationSel) stationRoll=(stationRoll+1)%4; }
  if(e.code==='KeyG'&&buildSel){ toggleFreePlace(); }
  if(e.code==='KeyX'){ if(paintMode) exitPaint(); else if(bpStamp) cancelStamp(); else if(buildSel) cancelBuild(); else if(stationSel) cancelStation(); else if(S.mode==='eva') removeAimedStation(); else if(S.mode==='surface') removeStructure(); }
  if(e.code==='Escape'){ if(bpSelecting){ bpSelecting=false; $('bpSel').style.display='none'; } else if(paintMode) exitPaint(); else if(bpStamp) cancelStamp(); else if(stationSel) cancelStation(); else if(!$('chatInput').classList.contains('hidden')) closeChat(); else closeAllPanels(); }
  if(S.mode==='surface'&&!driving){
    if(e.code==='Digit1') setSlot(0);
    else if(e.code==='Digit2') setSlot(1);
    else if(e.code==='Digit3') setSlot(2);
    else if(e.code==='Digit4') setSlot(3);
    else if(e.code==='Digit5') setSlot(4);
    else if(e.code==='Digit6') setSlot(5);
    else if(e.code==='Digit7') setSlot(6);
    else if(e.code==='Digit8') setSlot(7);
    else if(e.code==='KeyH') useMed();
    else if(e.code==='KeyQ'){ let n=S.slot; for(let k=0;k<SLOT_KEYS.length;k++){ n=(n+1)%SLOT_KEYS.length; if(ownsSlot(n)){ setSlot(n); break; } } }
  }
  if(e.code==='KeyM'&&S.mode==='surface') toggleMap();
  if(e.code==='Enter'&&NET.active&&!anyPanelOpen()) openChat();
});
document.addEventListener('keyup',e=>{ keys[e.code]=false; });
window.addEventListener('blur',()=>{ for(const k in keys) keys[k]=false; });

const canvas=$('c');
canvas.addEventListener('contextmenu',e=>e.preventDefault());
/* blueprint selection box (drag) — must run before pointer-lock handler */
let bpStart=null;
document.addEventListener('mousedown',e=>{
  if(bpSelecting&&e.button===0){ bpStart={x:e.clientX,y:e.clientY}; const d=$('bpSel');
    d.style.display='block'; d.style.left=e.clientX+'px'; d.style.top=e.clientY+'px'; d.style.width='0px'; d.style.height='0px';
    e.preventDefault(); e.stopPropagation(); }
},true);
document.addEventListener('mousemove',e=>{ if(bpSelecting&&bpStart){ const d=$('bpSel');
  d.style.left=Math.min(e.clientX,bpStart.x)+'px'; d.style.top=Math.min(e.clientY,bpStart.y)+'px';
  d.style.width=Math.abs(e.clientX-bpStart.x)+'px'; d.style.height=Math.abs(e.clientY-bpStart.y)+'px'; } });
document.addEventListener('mouseup',e=>{ if(bpSelecting&&bpStart){ finishBpSelect(bpStart.x,bpStart.y,e.clientX,e.clientY); bpStart=null; } });
document.addEventListener('mousedown',e=>{
  if(!S.running||isTouch||anyPanelOpen()||bpSelecting) return;
  if(e.target!==canvas) return;
  SND.ensure();
  if(!document.pointerLockElement){
    try{ const r=canvas.requestPointerLock&&canvas.requestPointerLock(); if(r&&r.catch) r.catch(()=>{}); }catch(err){}
    return;
  }
  if(e.button===0&&paintMode&&S.mode==='surface'){ paintAimed(); return; }
  if(e.button===0&&bpStamp&&S.mode==='surface'){ placeStamp(); return; }
  if(S.mode==='eva'){ if(e.button===0){ if(stationSel) placeStationPiece(); } else if(e.button===2){ if(stationSel) cancelStation(); else removeAimedStation(); } return; }
  if(e.button===0&&buildSel&&S.mode==='surface') placeStructure();
  else if(e.button===0&&!buildSel&&S.mode==='surface'&&S.slot>0&&!driving) primaryDown();
  else if(e.button===2){ if(paintMode) exitPaint(); else if(bpStamp) cancelStamp(); else if(buildSel) cancelBuild(); else if(S.mode==='surface') removeStructure(); }
});
document.addEventListener('mouseup',e=>{ if(e.button===0) fireHeld=false; });
document.addEventListener('mousemove',e=>{
  if(!document.pointerLockElement||!S.running||anyPanelOpen()||cs.active) return;
  const sens=0.0024;
  if(S.mode==='surface'){
    player.yaw-=e.movementX*sens;
    player.pitch=clamp(player.pitch-e.movementY*sens,-1.45,1.45);
  } else if(S.mode==='eva'){
    evaYaw-=e.movementX*sens;
    evaPitch=clamp(evaPitch-e.movementY*sens,-1.5,1.5);
  } else {
    S.syaw-=e.movementX*sens*0.7;
    S.spitch=clamp(S.spitch-e.movementY*sens*0.7,-1.25,1.25);
    spaceBank+=e.movementX*0.01;
  }
});
document.addEventListener('wheel',e=>{ if(buildSel) ghostRot=(ghostRot+(e.deltaY>0?1:3))%4; },{passive:true});

/* mobile joystick */
const joyBase=$('joyBase'), joyKnob=$('joyKnob');
function joyEvt(e){
  for(const t of e.changedTouches){
    if(e.type==='touchstart'&&joy.id===-1){ joy.id=t.identifier; joy.active=true; }
    if(t.identifier!==joy.id) continue;
    if(e.type==='touchend'||e.type==='touchcancel'){ joy.id=-1; joy.active=false; joy.x=joy.y=0; joyKnob.style.left='50%'; joyKnob.style.top='50%'; return; }
    const r=joyBase.getBoundingClientRect();
    let dx=(t.clientX-(r.left+r.width/2))/(r.width/2), dy=(t.clientY-(r.top+r.height/2))/(r.height/2);
    const m=Math.hypot(dx,dy); if(m>1){dx/=m;dy/=m;}
    joy.x=dx; joy.y=dy;
    joyKnob.style.left=(50+dx*38)+'%'; joyKnob.style.top=(50+dy*38)+'%';
  }
  e.preventDefault();
}
['touchstart','touchmove','touchend','touchcancel'].forEach(ev=>joyBase.addEventListener(ev,joyEvt,{passive:false}));

/* mobile look — drag right side */
document.addEventListener('touchstart',e=>{
  SND.ensure();
  if(!S.running) return;
  for(const t of e.changedTouches){
    if(t.target.closest&&(t.target.closest('.mBtn')||t.target.closest('#joyBase')||t.target.closest('.panel')||t.target.closest('#tierBadge')||t.target.closest('#gearBtn'))) continue;
    if(t.clientX>window.innerWidth*0.34&&lookTouch.id===-1){
      lookTouch.id=t.identifier; lookTouch.lx=t.clientX; lookTouch.ly=t.clientY;
    }
  }
},{passive:true});
document.addEventListener('touchmove',e=>{
  if(!S.running||anyPanelOpen()||cs.active) return;
  for(const t of e.changedTouches){
    if(t.identifier!==lookTouch.id) continue;
    const dx=t.clientX-lookTouch.lx, dy=t.clientY-lookTouch.ly;
    lookTouch.lx=t.clientX; lookTouch.ly=t.clientY;
    const sens=0.0052;
    if(S.mode==='surface'){
      player.yaw-=dx*sens; player.pitch=clamp(player.pitch-dy*sens,-1.45,1.45);
    } else {
      S.syaw-=dx*sens*0.6; S.spitch=clamp(S.spitch-dy*sens*0.6,-1.25,1.25);
    }
  }
},{passive:true});
document.addEventListener('touchend',e=>{
  for(const t of e.changedTouches) if(t.identifier===lookTouch.id) lookTouch.id=-1;
},{passive:true});

/* mobile buttons */
function bindHold(id,code){
  const el=$(id);
  el.addEventListener('touchstart',e=>{ e.preventDefault(); keys[code]=true; if(code==='KeyE')justE=true; },{passive:false});
  el.addEventListener('touchend',e=>{ e.preventDefault(); keys[code]=false; },{passive:false});
  el.addEventListener('touchcancel',()=>{ keys[code]=false; });
}
bindHold('mJump','Space');
bindHold('mThrust','KeyW'); bindHold('mBrake','KeyS');
/* mAct = fire when a weapon is equipped (mFire), else interact/mine */
let mFire=false;
(function(){
  const el=$('mAct');
  el.addEventListener('touchstart',e=>{ e.preventDefault(); if(mFire&&S.mode==='surface'&&!driving){ primaryDown(); } else { keys.KeyE=true; justE=true; } },{passive:false});
  el.addEventListener('touchend',e=>{ e.preventDefault(); keys.KeyE=false; fireHeld=false; },{passive:false});
  el.addEventListener('touchcancel',()=>{ keys.KeyE=false; fireHeld=false; });
})();
$('mMed').addEventListener('touchstart',e=>{ e.preventDefault(); useMed(); },{passive:false});
function toggleFreePlace(){ freePlace=!freePlace; $('mFree').textContent=freePlace?'FREE':'SNAP'; showToast(freePlace?'Free placement (snap off)':'Snap-to-piece on'); SND.blip(); }
$('mPlace').addEventListener('touchstart',e=>{ e.preventDefault(); if(S.mode==='eva'){ if(stationSel) placeStationPiece(); } else if(paintMode) paintAimed(); else if(bpStamp) placeStamp(); else if(buildSel) placeStructure(); },{passive:false});
$('mFree').addEventListener('touchstart',e=>{ e.preventDefault(); if(buildSel) toggleFreePlace(); },{passive:false});
$('mRemove').addEventListener('touchstart',e=>{ e.preventDefault(); if(S.mode==='eva'){ if(stationSel) cancelStation(); else removeAimedStation(); } else if(buildSel) cancelBuild(); else if(S.mode==='surface') removeStructure(); },{passive:false});
$('mBuild').addEventListener('touchstart',e=>{ e.preventDefault();
  if(anyPanelOpen()) closeAllPanels();
  else if(S.mode==='surface'){ renderBuildGrid(); openPanel('buildMenu'); }
  else if(S.mode==='eva'){ renderStationGrid(); openPanel('stationMenu'); }
  else showToast('Land on a planet to build'); },{passive:false});
/* EVA vertical thrust on mobile (▲ up / ▼ down) — buttons also set KeyW/KeyS via bindHold, ignored in EVA */
$('mThrust').addEventListener('touchstart',e=>{ if(S.mode==='eva') keys.Space=true; },{passive:false});
$('mThrust').addEventListener('touchend',()=>{ keys.Space=false; });
$('mBrake').addEventListener('touchstart',e=>{ if(S.mode==='eva') keys.ShiftLeft=true; },{passive:false});
$('mBrake').addEventListener('touchend',()=>{ keys.ShiftLeft=false; });
function refreshMobileUI(){
  const sp=S.mode==='space', eva=S.mode==='eva', surf=S.mode==='surface';
  $('mThrust').classList.toggle('hidden',!(sp||eva));
  $('mBrake').classList.toggle('hidden',!(sp||eva));
  $('mJump').classList.toggle('hidden',!surf);
  $('mRemove').classList.toggle('hidden',sp);
  $('mBuild').classList.toggle('hidden',sp);
  $('mMed').classList.toggle('hidden',!surf);
  $('mMap').classList.toggle('hidden',!surf);
  $('mChat').classList.toggle('hidden',!(surf&&NET.active));
  $('hotbar').classList.toggle('hidden',!surf);
  if(!eva) {} if(sp) $('mPlace').classList.add('hidden');
}

$('tierBadge').addEventListener('click',()=>{ SND.ensure(); SND.blip();
  if($('tierMenu').classList.contains('hidden')){ renderTierList(); openPanel('tierMenu'); } else closePanel('tierMenu'); });
$('gearBtn').addEventListener('click',()=>{ SND.ensure(); SND.blip(); openSettings(); });

/* settings */
function openSettings(){
  $('btnExport').classList.toggle('hidden',!S.running||NET.active);
  $('btnImportTog').classList.toggle('hidden',S.running&&NET.active);
  $('btnQuit').classList.toggle('hidden',!S.running);
  $('btnSound').textContent='Sound: '+(SND.on?'ON':'OFF');
  $('btnBob').textContent='Head Bob: '+(S.headbob!==false?'ON':'OFF');
  $('importWrap').classList.add('hidden');
  openPanel('settings');
}
$('btnExport').addEventListener('click',()=>{ saveGame(); exportSave(); });
$('btnImportTog').addEventListener('click',()=>{ $('importWrap').classList.toggle('hidden'); $('importBox').value=''; });
$('btnImportGo').addEventListener('click',()=>{
  const d=importSave($('importBox').value);
  if(d){ showToast('Save imported — reloading...'); setTimeout(()=>location.reload(),800); }
});
$('btnSound').addEventListener('click',()=>{ SND.on=!SND.on; $('btnSound').textContent='Sound: '+(SND.on?'ON':'OFF'); SND.blip(); });
$('btnBob').addEventListener('click',()=>{ S.headbob=!S.headbob; $('btnBob').textContent='Head Bob: '+(S.headbob?'ON':'OFF'); SND.blip(); saveGame(); });
$('btnQuit').addEventListener('click',()=>{ saveGame(); NET.quitting=true; location.reload(); });
$('mChat').addEventListener('touchstart',e=>{ e.preventDefault(); openChat(); },{passive:false});
$('mMap').addEventListener('touchstart',e=>{ e.preventDefault(); toggleMap(); },{passive:false});

/* ============================================================
   MODE TRANSITIONS
   ============================================================ */
let transitioning=false;
function fadeTo(text,midFn){
  transitioning=true;
  const f=$('fade');
  $('fadeText').textContent=text;
  f.style.opacity=1;
  setTimeout(()=>{
    midFn();
    setTimeout(()=>{ f.style.opacity=0; transitioning=false; },350);
  },800);
}
function enterSurface(planetKey,fromSave){
  buildSurface(planetKey);
  S.mode='surface';
  activeScene=surfScene;
  surfScene.add(particles);
  surfScene.add(ship);
  ship.position.copy(surf.shipPos);
  ship.rotation.set(0,2.4,0);
  ship.getObjectByName('engGlow').visible=false;
  ship.getObjectByName('legs').visible=true;
  updateViewmodel();
  clearMeteors();
  clearCritters(); soloSpawnInitial();
  clearThrowables(); clearShieldWalls();
  if(fromSave&&S.ppos&&Math.hypot(S.ppos[0],S.ppos[2])<WORLD_R){
    player.x=S.ppos[0]; player.z=S.ppos[2];
    player.y=Math.max(S.ppos[1],groundYAt(player.x,player.z,S.ppos[1]+2));
    player.yaw=S.pyaw;
  } else {
    player.x=1; player.z=-4;
    player.y=groundYAt(player.x,player.z,1e9);
    player.yaw=Math.atan2(-(surf.shipPos.x-player.x),-(surf.shipPos.z-player.z));
  }
  player.vy=0; player.pitch=0;
  refreshMobileUI();
  /* one-time hint: wildlife is the Chitin source (it isn't mined) */
  try{ if(!localStorage.getItem('sf_huntHint')){ localStorage.setItem('sf_huntHint','1');
    setTimeout(()=>{ if(S.running&&S.mode==='surface') showToast('Wildlife roams here — track the tan dots on your map (M) and defeat them with a weapon to harvest Chitin',5500); },3000); } }catch(e){}
}
function enterSpace(fromPlanetKey,fromSave){
  if(driving){ driving=null; }
  S.mode='space';
  activeScene=spaceScene;
  spaceScene.add(particles);
  spaceScene.add(ship);
  ship.getObjectByName('engGlow').visible=true;
  ship.getObjectByName('legs').visible=false;
  updateViewmodel();
  cancelBuild();
  clearMeteors();
  clearCritters();
  clearThrowables(); clearShieldWalls();
  $('waterVig').style.opacity=0;
  if(camera.fov!==74){ camera.fov=74; camera.updateProjectionMatrix(); }
  if(fromSave){
    ship.position.fromArray(S.spos);
  } else {
    const p=PLANETS[fromPlanetKey];
    const dir=new THREE.Vector3(-p.pos[0],-p.pos[1]+40,-p.pos[2]).normalize();
    ship.position.set(p.pos[0]+dir.x*(p.r+70),p.pos[1]+dir.y*(p.r+70)+20,p.pos[2]+dir.z*(p.r+70));
    S.syaw=Math.atan2(-dir.x,-dir.z); S.spitch=clamp(Math.asin(dir.y),-1.2,1.2);
    S.sspeed=6;
  }
  refreshMobileUI();
  if(S.pendingCutscene) setTimeout(()=>{ if(S.mode==='space'&&S.running) startShieldCutscene(S.pendingCutscene); },1200);
}
function doLand(planetKey){
  if(transitioning) return;
  saveGame();
  fadeTo('DESCENDING TO '+PLANETS[planetKey].name,()=>{ enterSurface(planetKey,false); saveGame(); });
}
function doLaunch(){
  if(transitioning) return;
  fadeTo('LAUNCHING',()=>{ enterSpace(S.planet,false); saveGame(); });
}
function doBlackout(){
  fadeTo('OXYGEN DEPLETED — EMERGENCY RECALL',()=>{
    player.x=surf.shipPos.x-3; player.z=surf.shipPos.z+3;
    player.y=groundYAt(player.x,player.z,1e9);
    player.vy=0; S.o2=o2Max();
  });
}

/* ============================================================
   SIGNAL-SHIELD CUTSCENE (Verdant tier 3, Pelagos tier 5)
   ============================================================ */
const cs={active:false,t:0,planet:'verdant'};
function startShieldCutscene(key){
  const grp=shieldGroups[key];
  if(cs.active||!grp||!grp.parent){ if(grp&&!grp.parent&&S.pendingCutscene===key) S.pendingCutscene=null; return; }
  cs.active=true; cs.t=0; cs.planet=key;
  document.body.classList.add('cutsceneOn');
  cs.fromPos=camera.position.clone();
  cs.fromQuat=camera.quaternion.clone();
  const vp=new THREE.Vector3().fromArray(PLANETS[key].pos);
  const dir=ship.position.clone().sub(vp).normalize();
  cs.viewPos=vp.clone().addScaledVector(dir,PLANETS[key].r*3.4).add(new THREE.Vector3(0,18,0));
  cs.target=vp;
  showToast('INCOMING TELEMETRY — '+PLANETS[key].name+' SIGNAL SHIELD COLLAPSING',3000);
  SND.tone&&SND.tone(180,1.2,'sine',0.08,90);
}
function updateCutscene(dt){
  cs.t+=dt;
  const t=cs.t, grp=shieldGroups[cs.planet];
  if(t<1.6){
    const k=smooth(0,1.6,t);
    camera.position.lerpVectors(cs.fromPos,cs.viewPos,k);
    camera.lookAt(cs.target);
  } else if(t<4.6){
    camera.position.copy(cs.viewPos);
    camera.lookAt(cs.target);
    const k=smooth(2.0,4.0,t);
    if(grp&&grp.parent){
      grp.scale.setScalar(Math.max(0.001,1-k));
      grp.children.forEach(c=>{ c.material.opacity=(c.material.userData&&c.material.userData.o0||0.3)*(1-k); });
      if(Math.random()<dt*8&&k>0.05&&k<0.95){
        const p=PLANETS[cs.planet];
        spawnBurst(p.pos[0]+(Math.random()-0.5)*60,p.pos[1]+(Math.random()-0.5)*60,p.pos[2]+(Math.random()-0.5)*60,SHIELDED[cs.planet].wire,4,12,6,1,0);
      }
      if(k>=1){ spaceScene.remove(grp); }
    }
  } else if(t<6.2){
    if(grp&&grp.parent) spaceScene.remove(grp);
    const k=smooth(4.6,6.2,t);
    camera.position.lerpVectors(cs.viewPos,cs.fromPos,k);
    camera.quaternion.slerp(cs.fromQuat,k*0.3+0.05);
  } else {
    cs.active=false;
    S.pendingCutscene=null;
    document.body.classList.remove('cutsceneOn');
    showToast(PLANETS[cs.planet].name+' IS OPEN — land there to harvest '+SHIELDED[cs.planet].res,4000);
    saveGame();
  }
}

/* ============================================================
   ORBITAL STATION + EVA (Phase 7)
   ============================================================ */
const _zAxis=new THREE.Vector3(0,0,1), _evf=new THREE.Vector3(), _evr=new THREE.Vector3(),
      _qa=new THREE.Quaternion(), _qb=new THREE.Quaternion(), _vst=new THREE.Vector3(), _aim=new THREE.Vector3();
/* STATION_REACH / STATION_SNAP / EVA_SPEED imported from shared/constants.js */
let stationSel=null, stationRoll=0, stationGhost=null, stationGhostOK=false, stationSnap=null;
let evaPos=new THREE.Vector3(), evaYaw=0, evaPitch=0;

function stationVisible(){ return S.tier>=5 || S.station.length>0; }
function buildStationPiece(t,ghost){
  const def=STATION[t], g=new THREE.Group();
  for(const part of def.parts){
    const m=new THREE.Mesh(GEO[part.g], ghost?MAT.ghostOk:MAT[part.m]);
    m.position.fromArray(part.o); if(part.r) m.rotation.set(part.r[0],part.r[1],part.r[2]); m.scale.fromArray(part.s);
    g.add(m);
  }
  return g;
}
/* orient a piece so its local +Z aligns to a socket's outward dir, with R roll */
function socketQuat(dir,roll,out){
  out.setFromUnitVectors(_zAxis,dir);
  _qb.setFromAxisAngle(dir,(roll||0)*Math.PI/2);
  out.premultiply(_qb);
  return out;
}
/* all open attach sockets (core faces + each piece's exposed sockets) */
function stationSockets(){
  const list=[];
  for(const d of CORE_DIRS) list.push({pos:new THREE.Vector3().copy(d).multiplyScalar(CORE_R).add(STATION_POS),dir:d.clone()});
  for(const pc of S.station){
    const q=_qa.set(pc.qx,pc.qy,pc.qz,pc.qw), base=_vst.set(pc.x,pc.y,pc.z);
    for(const o of STATION[pc.t].out){
      const wp=new THREE.Vector3(o.p[0],o.p[1],o.p[2]).applyQuaternion(q).add(base);
      const wd=new THREE.Vector3(o.d[0],o.d[1],o.d[2]).applyQuaternion(q).normalize();
      list.push({pos:wp,dir:wd});
    }
  }
  return list.filter(s=>!S.station.some(pc=>{
    const dx=pc.x-s.pos.x, dy=pc.y-s.pos.y, dz=pc.z-s.pos.z; return dx*dx+dy*dy+dz*dz<1.6;
  }));
}
function refreshStation(){
  while(stationGroup.children.length) stationGroup.remove(stationGroup.children[0]);
  for(const pc of S.station){
    const grp=buildStationPiece(pc.t,false);
    grp.position.set(pc.x,pc.y,pc.z); grp.quaternion.set(pc.qx,pc.qy,pc.qz,pc.qw);
    grp.userData.st=pc; stationGroup.add(grp);
  }
  updateStationVisibility();
}
function updateStationVisibility(){
  const vis=stationVisible();
  stationCore.visible=vis; stationGroup.visible=vis;
  stationGlow.visible=vis&&S.stationOnline;
  const b=stationCore.getObjectByName('coreBeacon'); if(b) b.material=S.stationOnline?MAT.emisG:MAT.emisC;
}
function stationComplete(){ return R.stationComplete(S.station); }
function checkStationComplete(){
  if(!S.stationOnline && stationComplete()){ S.stationOnline=true; stationOnlineCelebration(); saveGame(); }
  updateStationVisibility();
}
function stationOnlineCelebration(){
  SND.victory(); showToast('★ ASTRAVOX STATION ONLINE ★',6000); flashFx();
  for(let i=0;i<18;i++) setTimeout(()=>{
    if(!S.running) return;
    const a=Math.random()*6.28, b=Math.random()*6.28, r=14+Math.random()*18;
    spawnBurst(STATION_POS.x+Math.cos(a)*r, STATION_POS.y+Math.sin(b)*r, STATION_POS.z+Math.sin(a)*r,
      [0x7fff9a,0x9feaff,0xffd97f,0xb060ff][i%4],28,10,9,1.8,0);
  },i*200);
}
/* ---------- placement ---------- */
function selectStation(t){
  const def=STATION[t]; if(!def) return;
  if(!canAfford(def.cost)){ SND.denied(); showToast('Need '+costStr(def.cost)); return; }
  stationSel=t; stationRoll=0;
  if(stationGhost){ spaceScene.remove(stationGhost); stationGhost=null; }
  stationGhost=buildStationPiece(t,true); spaceScene.add(stationGhost);
  closePanel('stationMenu');
  showToast(def.name+' — aim near a glowing socket, click to place · R roll · X cancel');
  $('mPlace').classList.remove('hidden'); $('mFree').classList.add('hidden');
}
function cancelStation(){ stationSel=null; if(stationGhost){ spaceScene.remove(stationGhost); stationGhost=null; } stationSnap=null; $('mPlace').classList.add('hidden'); }
function updateStationGhost(){
  if(!stationSel||!stationGhost) return;
  evaForward(_evf); _aim.copy(evaPos).addScaledVector(_evf,STATION_REACH);
  let best=null,bd=STATION_SNAP*STATION_SNAP;
  for(const s of stationSockets()){ const d=s.pos.distanceToSquared(_aim); if(d<bd){ bd=d; best=s; } }
  if(best){
    stationGhost.visible=true; stationGhost.position.copy(best.pos);
    socketQuat(best.dir,stationRoll,_qa); stationGhost.quaternion.copy(_qa);
    stationSnap={pos:best.pos.clone(),dir:best.dir.clone()};
    stationGhostOK=canAfford(STATION[stationSel].cost)&&S.station.length<STATION_MAX;
    stationGhost.traverse(o=>{ if(o.isMesh) o.material=stationGhostOK?MAT.ghostOk:MAT.ghostBad; });
  } else { stationGhost.visible=false; stationSnap=null; stationGhostOK=false; }
}
function placeStationPiece(){
  if(!stationSel||!stationSnap){ SND.denied(); showToast('Aim near a socket'); return; }
  const def=STATION[stationSel];
  if(!canAfford(def.cost)){ SND.denied(); showToast('Need '+costStr(def.cost)); return; }
  if(S.station.length>=STATION_MAX){ SND.denied(); showToast('Station piece limit ('+STATION_MAX+')'); return; }
  socketQuat(stationSnap.dir,stationRoll,_qa);
  const pc={t:stationSel,x:+stationSnap.pos.x.toFixed(2),y:+stationSnap.pos.y.toFixed(2),z:+stationSnap.pos.z.toFixed(2),
    qx:+_qa.x.toFixed(4),qy:+_qa.y.toFixed(4),qz:+_qa.z.toFixed(4),qw:+_qa.w.toFixed(4),r:stationRoll};
  if(NET.active) NET.send({t:'stationPlace',st:pc});
  else applyStationPlaced(pc,true);
}
function applyStationPlaced(m,byMe){
  if(!STATION[m.t]) return;
  const pc={t:m.t,x:m.x,y:m.y,z:m.z,qx:m.qx,qy:m.qy,qz:m.qz,qw:m.qw,r:m.r|0}; if(m.id!==undefined) pc.id=m.id;
  S.station.push(pc); refreshStation();
  if(byMe){ if(!NET.active) payCost(STATION[m.t].cost); SND.place(); spawnBurst(m.x,m.y,m.z,0x7fd6ff,16,4,4,0.8,0);
    if(!canAfford(STATION[m.t].cost)) cancelStation(); saveGame(); }
  checkStationComplete();
}
function removeAimedStation(){
  evaForward(_evf); _aim.copy(evaPos).addScaledVector(_evf,STATION_REACH);
  let best=-1,bd=72; for(let i=0;i<S.station.length;i++){ const p=S.station[i]; const dx=p.x-_aim.x,dy=p.y-_aim.y,dz=p.z-_aim.z,d=dx*dx+dy*dy+dz*dz; if(d<bd){bd=d;best=i;} }
  if(best<0){ showToast('Aim at a station piece to remove'); return; }
  const pc=S.station[best];
  if(NET.active) NET.send({t:'stationRemove',id:pc.id});
  else applyStationRemoved(pc,true);
}
function applyStationRemovedById(id,byMe){ const i=S.station.findIndex(p=>p.id===id); if(i>=0) applyStationRemoved(S.station[i],byMe); }
function applyStationRemoved(pc,byMe){
  const i=S.station.indexOf(pc); if(i<0) return;
  S.station.splice(i,1); refreshStation();
  if(byMe){ if(!NET.active){ for(const k in STATION[pc.t].cost) S.res[k]=Math.min(carryCap(),(S.res[k]||0)+Math.floor(STATION[pc.t].cost[k]/2)); updateHUDRes(); } SND.remove(); saveGame(); }
  updateStationVisibility();
}
/* ---------- EVA mode ---------- */
function evaForward(out){ return out.set(-Math.sin(evaYaw)*Math.cos(evaPitch),Math.sin(evaPitch),-Math.cos(evaYaw)*Math.cos(evaPitch)); }
function evaRight(out){ return out.set(Math.cos(evaYaw),0,-Math.sin(evaYaw)); }
function enterEva(){
  if(S.tier<5){ showToast('Reach Tier 5 to dock'); SND.denied(); return; }
  S.mode='eva'; activeScene=spaceScene;
  _vst.copy(STATION_POS).sub(ship.position).normalize();
  evaPos.copy(ship.position).addScaledVector(_vst,6);
  evaYaw=S.syaw; evaPitch=0; stationSel=null;
  showToast('EVA — WASD + Space/Shift fly · B station build · E to return to ship · O₂ draining',5500);
  refreshMobileUI();
}
function exitEva(){
  cancelStation();
  S.mode='space'; activeScene=spaceScene;
  ship.getObjectByName('engGlow').visible=true;
  closeAllPanels(); refreshMobileUI(); SND.place(); saveGame();
}
function evaEmergency(){ S.o2=o2Max(); showToast('O₂ DEPLETED — emergency recall to ship'); exitEva(); }
function renderEvaCam(){ camera.position.copy(evaPos); camera.rotation.set(evaPitch,evaYaw,0); }
function updateEva(dt){
  if(anyPanelOpen()||transitioning){ justE=false; renderEvaCam(); return; }
  const fwd=evaForward(_evf), right=evaRight(_evr);
  let mvx=0,mvy=0,mvz=0;
  const add=(v,s)=>{ mvx+=v.x*s; mvy+=v.y*s; mvz+=v.z*s; };
  if(!isTouch){ if(keys.KeyW||keys.ArrowUp) add(fwd,1); if(keys.KeyS||keys.ArrowDown) add(fwd,-1); if(keys.KeyD||keys.ArrowRight) add(right,1); if(keys.KeyA||keys.ArrowLeft) add(right,-1); }
  if(joy.active){ add(fwd,-joy.y); add(right,joy.x); }
  if(keys.Space) mvy+=1; if(keys.ShiftLeft) mvy-=1;
  const ml=Math.hypot(mvx,mvy,mvz);
  if(ml>0.001){ const f=EVA_SPEED*dt/ml; evaPos.x+=mvx*f; evaPos.y+=mvy*f; evaPos.z+=mvz*f; }
  if(evaPos.distanceTo(STATION_POS)>140){ _vst.copy(evaPos).sub(STATION_POS).setLength(140).add(STATION_POS); evaPos.copy(_vst); }
  /* O2: refill near the parked ship, otherwise drain */
  const nearShip=evaPos.distanceTo(ship.position)<14;
  if(nearShip) S.o2=Math.min(o2Max(),S.o2+30*dt); else S.o2=Math.max(0,S.o2-2.6*dt);
  const o2f=S.o2/o2Max();
  $('o2bar').style.width=(o2f*100)+'%'; $('o2bar').classList.toggle('low',o2f<0.25&&!nearShip);
  if(o2f<0.25&&!nearShip){ o2BeepT-=dt; if(o2BeepT<=0){ SND.o2warn(); o2BeepT=1.6; } }
  if(S.o2<=0){ evaEmergency(); justE=false; return; }
  $('hpbar').style.width=(player.hp/HP_MAX*100)+'%';
  /* build / undock prompts */
  if(stationSel){
    updateStationGhost();
    setPrompt(stationGhostOK?'<span class="key">CLICK</span>PLACE '+STATION[stationSel].name+' · <span class="key">R</span>ROLL · <span class="key">X</span>CANCEL'
      :'<span style="color:#ff9a8a">Aim near a socket'+(canAfford(STATION[stationSel].cost)?'':' — NEED '+costStr(STATION[stationSel].cost))+'</span>');
    setMAct('—');
  } else {
    setPrompt('<span class="key">B</span>STATION BUILD · <span class="key">E</span>RETURN TO SHIP'+(nearShip?' (O₂ refilling)':''));
    setMAct('UNDOCK');
    if(justE){ exitEva(); justE=false; return; }
  }
  justE=false;
  S.spos=[ship.position.x,ship.position.y,ship.position.z];
  renderEvaCam();
}
function renderStationGrid(){
  const grid=$('stationGrid'); grid.innerHTML='';
  const have=new Set(S.station.map(p=>p.t));
  const hd=document.createElement('div'); hd.className='bSection';
  hd.textContent='All 6 types + '+STATION_MIN_PIECES+' pieces to power it · '+S.station.length+' placed, '+have.size+'/6 types'+(S.stationOnline?' · ONLINE ✓':'');
  grid.appendChild(hd);
  for(const k of STATION_KEYS){
    const def=STATION[k], d=document.createElement('div');
    d.className='bItem'+(canAfford(def.cost)?'':' locked');
    d.innerHTML='<div class="ic">'+def.ic+'</div><div class="nm">'+def.name+(have.has(k)?' ✓':'')+'</div><div class="cs">'+
      Object.keys(def.cost).map(r=>'<span style="color:'+RES_DOTS[r]+'">'+def.cost[r]+'</span>').join(' · ')+'</div>';
    d.addEventListener('click',()=>{ SND.blip(); selectStation(k); });
    grid.appendChild(d);
  }
}

/* ============================================================
   SPACE UPDATE
   ============================================================ */
let spaceBank=0;
const _fwd=new THREE.Vector3(), _camTgt=new THREE.Vector3(), _tmpV=new THREE.Vector3();
function shipForward(out){
  out.set(-Math.sin(S.syaw)*Math.cos(S.spitch),Math.sin(S.spitch),-Math.cos(S.syaw)*Math.cos(S.spitch));
  return out;
}
function updateSpace(dt){
  if(anyPanelOpen()||transitioning){ justE=false; renderSpaceCam(dt); return; }
  const maxSp=S.tier>=3?70:40, accel=S.tier>=3?30:18;
  let thr=0;
  if(keys.KeyW||keys.ArrowUp) thr=1; else if(keys.KeyS||keys.ArrowDown) thr=-0.6;
  if(joy.active){ thr=clamp(-joy.y,-0.6,1); S.syaw-=joy.x*dt*1.4; }
  S.sspeed+=thr*accel*dt;
  if(thr===0) S.sspeed*=Math.pow(0.45,dt);
  S.sspeed=clamp(S.sspeed,-maxSp*0.4,maxSp);
  shipForward(_fwd);
  ship.position.addScaledVector(_fwd,S.sspeed*dt);
  /* bounds + planet collision */
  if(ship.position.length()>1500){ ship.position.setLength(1500); S.sspeed*=0.5; showToast('Deep-space boundary — turning back'); }
  if(ship.position.length()<60){ ship.position.setLength(60); S.sspeed=0; }
  let landKey=null, landDist=1e9;
  for(const key in PLANETS){
    const p=PLANETS[key];
    _tmpV.fromArray(p.pos);
    const d=ship.position.distanceTo(_tmpV);
    if(d<p.r+9){ ship.position.sub(_tmpV).setLength(p.r+9).add(_tmpV); S.sspeed*=0.2; }
    if(d<p.r+75&&d<landDist){ landDist=d; landKey=key; }
  }
  /* station core: gentle collision + dock proximity */
  const coreVis=stationVisible();
  const coreDist=coreVis?ship.position.distanceTo(STATION_POS):1e9;
  if(coreVis&&coreDist<10){ ship.position.sub(STATION_POS).setLength(10).add(STATION_POS); S.sspeed*=0.3; }
  ship.rotation.order='YXZ';
  spaceBank*=Math.pow(0.04,dt);
  ship.rotation.set(S.spitch,S.syaw,clamp(-spaceBank,-0.5,0.5));
  const eg=ship.getObjectByName('engGlow');
  eg.scale.setScalar(3+Math.abs(S.sspeed)*0.09+Math.sin(performance.now()*0.02)*0.4);
  /* prompts */
  if(coreDist<24){
    if(S.tier>=5){
      setPrompt('<span class="key">E</span>DOCK — Orbital Station'+(S.stationOnline?' <span style="color:#8fefb0">(ONLINE)</span>':''));
      setMAct('DOCK');
      if(justE){ enterEva(); justE=false; return; }
    } else {
      setPrompt('<span style="color:#ff9a8a">STATION CORE — REQUIRES TIER 5 TO DOCK</span>'); setMAct('✕');
      if(justE){ SND.denied(); showToast('Reach Tier 5 to dock with the station core'); }
    }
  } else if(landKey){
    const p=PLANETS[landKey];
    if(SHIELDED[landKey]&&S.tier<SHIELDED[landKey].tier){
      setPrompt('<span style="color:#ff9a8a">⚠ SIGNAL INTERFERENCE — '+p.name+' REQUIRES TIER '+SHIELDED[landKey].tier+'</span>');
      setMAct('✕');
      if(justE){ SND.denied(); showToast('A hostile signal shield blocks descent. Reach Tier '+SHIELDED[landKey].tier+'.'); }
    } else {
      setPrompt('<span class="key">E</span>LAND ON '+p.name+' — '+p.desc);
      setMAct('LAND');
      if(justE) doLand(landKey);
    }
  } else { setPrompt(''); setMAct('—'); }
  justE=false;
  S.spos=[ship.position.x,ship.position.y,ship.position.z];
  /* slow O2 refill aboard ship */
  S.o2=Math.min(o2Max(),S.o2+12*dt);
  renderSpaceCam(dt);
  updateSpaceHUD();
}
function renderSpaceCam(dt){
  ship.updateMatrixWorld();
  _camTgt.set(0,3.4,12).applyMatrix4(ship.matrixWorld);
  const k=1-Math.pow(0.0001,dt);
  camera.position.lerp(_camTgt,k);
  shipForward(_fwd);
  _tmpV.copy(ship.position).addScaledVector(_fwd,18);
  camera.lookAt(_tmpV);
}
function updateSpaceHUD(){
  $('o2bar').style.width=(S.o2/o2Max()*100)+'%';
  $('o2bar').classList.toggle('low',false);
}
/* verdant shield material opacity baseline (for cutscene fade) */

/* ============================================================
   SURFACE UPDATE
   ============================================================ */
let o2BeepT=0, footT=0, puSprint=false, puJet=false;   // activity flags reported to the server
function updateSurface(dt){
  if(anyPanelOpen()||transitioning){ justE=false; renderSurfaceCam(); return; }
  const p=curP();
  /* --- combat timers --- */
  weaponCd=Math.max(0,weaponCd-dt); swingT=Math.max(0,swingT-dt);
  if(player.invuln>0){ player.invuln=Math.max(0,player.invuln-dt); if(player.invuln<=0) $('protRing').classList.add('hidden'); }
  if(driving){ updateRover(dt); return; }
  /* --- movement --- */
  let ix=0,iz=0;
  if(keys.KeyW||keys.ArrowUp) iz-=1;
  if(keys.KeyS||keys.ArrowDown) iz+=1;
  if(keys.KeyA||keys.ArrowLeft) ix-=1;
  if(keys.KeyD||keys.ArrowRight) ix+=1;
  if(joy.active){ ix+=joy.x; iz+=joy.y; }
  const im=Math.hypot(ix,iz);
  if(im>1){ ix/=im; iz/=im; }
  const sprinting=S.tier>=2&&keys.ShiftLeft&&im>0.1;
  /* --- water state (Pelagos): wading slows you, deep water sinks + drains O2 --- */
  const water=p.water; let wading=false, deepW=false, submerged=false;
  if(water){
    const wdepth=SEA_Y-terrainH(player.x,player.z,p);
    wading    = wdepth>0.3 && player.y<SEA_Y+0.2;
    deepW     = wdepth>1.6 && player.y<SEA_Y+0.2;
    submerged = player.y<SEA_Y-0.3;
  }
  const baseSpd=sprinting?9.6:6;
  const spd=deepW?baseSpd*0.42:(wading?baseSpd*0.6:baseSpd);
  const sy=Math.sin(player.yaw), cy=Math.cos(player.yaw);
  const mx=(ix*cy+iz*sy)*spd*dt, mz=(iz*cy-ix*sy)*spd*dt;
  player.x+=mx; player.z+=mz;
  /* bounds */
  const pr=Math.hypot(player.x,player.z);
  if(pr>WORLD_R){ player.x*=WORLD_R/pr; player.z*=WORLD_R/pr; if(Math.random()<dt*2) showToast('Suit warning: leaving survey zone'); }
  /* structure collision + doors */
  updateDoors(dt);
  collidePlayer();
  /* weapon fire */
  if(S.slot>0&&fireHeld&&!buildSel) fireWeapon();
  /* gravity / jump / jetpack */
  const gy=groundYAt(player.x,player.z,player.y);
  player.grounded=player.y<=gy+0.02;
  let jetting=false;
  if(keys.Space){
    if(!deepW&&player.grounded&&player.vy<=0.01){ player.vy=7.2; player.grounded=false; }
    else if(S.tier>=3&&S.fuel>0.5){
      player.vy+=26*dt; S.fuel=Math.max(0,S.fuel-32*dt); jetting=true;
      if(Math.random()<dt*30) spawnBurst(player.x-sy*0.2,player.y+0.3,player.z-cy*0.2,0xffc060,2,1.2,-0.5,0.35,-3);
    }
  }
  if(player.grounded&&!keys.Space) S.fuel=Math.min(100,S.fuel+24*dt);
  if(deepW&&!jetting){ player.vy-=4*dt; player.vy=clamp(player.vy,-1.6,2.0); }   // buoyant slow sink — no fast fall
  else { player.vy-=18*dt; player.vy=clamp(player.vy,-30,9); }
  player.y+=player.vy*dt;
  if(player.y<=gy){ player.y=gy; player.vy=0; player.grounded=true; }
  /* head bob */
  footT+=im*dt*(sprinting?11:7);
  /* --- O2 --- */
  puSprint=sprinting; puJet=jetting;
  const safe=inO2Range();
  if(submerged) S.o2=Math.max(0,S.o2-4.6*dt);            // deep water: ~4x drain, no air
  else if(safe) S.o2=Math.min(o2Max(),S.o2+28*dt);
  else S.o2=Math.max(0,S.o2-(sprinting?1.8:1.15)*dt*(jetting?1.4:1));
  const lowAir=!safe||submerged;
  const o2f=S.o2/o2Max();
  $('o2bar').style.width=(o2f*100)+'%';
  $('o2bar').classList.toggle('low',o2f<0.25&&lowAir);
  if(o2f<0.25&&lowAir){ o2BeepT-=dt; if(o2BeepT<=0){ SND.o2warn(); o2BeepT=1.6; } }
  $('waterVig').style.opacity = water?(submerged?clamp((SEA_Y-0.3-player.y)/3,0.35,0.85):(wading?0.12:0)):0;
  if(S.o2<=0){ doBlackout(); justE=false; return; }
  if(S.tier>=3) $('fuelbar').style.width=S.fuel+'%';
  /* --- health --- */
  const hpf=player.hp/HP_MAX;
  $('hpbar').style.width=(hpf*100)+'%';
  $('hpbar').classList.toggle('low',hpf<0.25);
  /* --- interactions --- */
  const dxs=player.x-surf.shipPos.x, dzs=player.z-surf.shipPos.z;
  const nearShip=dxs*dxs+dzs*dzs<60;
  const roverHere=(!buildSel&&!nearShip)?nearRover():null;
  const arm=(!buildSel&&!nearShip&&!roverHere)?nearArmory():null;
  const aimed=buildSel?null:aimedStructure();
  const damaged=(aimed&&aimed.hp<CAT[aimed.t].hp&&!roverHere&&!arm)?aimed:null;
  let prompted=false; mFire=false;
  if(bpStamp){
    updateStampGhost();
    setPrompt('<span class="key">CLICK</span>STAMP BLUEPRINT ('+bpStamp.pieces.length+') · <span class="key">R</span>ROTATE · <span class="key">X</span>CANCEL');
    setMAct('STAMP'); prompted=true; updateMining(0,false);
  } else if(paintMode){
    const a=aimedStructure();
    setPrompt(a?'<span class="key">CLICK</span>PAINT '+(CAT[a.t]?CAT[a.t].name:'piece')+' · <span class="key">X</span>EXIT':'Aim at a piece to paint · <span class="key">X</span>EXIT');
    setMAct('PAINT'); prompted=true; updateMining(0,false);
  } else if(buildSel){
    updateGhost();
    setPrompt(ghostOK?'<span class="key">CLICK</span>PLACE '+CAT[buildSel].name+' · <span class="key">R</span>ROTATE · <span class="key">X</span>CANCEL'
      :'<span style="color:#ff9a8a">CANNOT PLACE HERE'+(canAfford(CAT[buildSel].cost)?'':' — NEED '+costStr(CAT[buildSel].cost))+'</span>');
    setMAct('—'); prompted=true;
    updateMining(0,false);
  } else if(nearShip){
    setPrompt('<span class="key">E</span>LAUNCH'); setMAct('LAUNCH'); prompted=true;
    if(justE){ doLaunch(); justE=false; return; }
    updateMining(0,false);
  } else if(roverHere){
    setPrompt('<span class="key">E</span>DRIVE ROVER'); setMAct('DRIVE'); prompted=true;
    if(justE){ enterRover(roverHere); justE=false; return; }
    updateMining(0,false);
  } else if(arm){
    setPrompt('<span class="key">E</span>OPEN ARMORY'); setMAct('USE'); prompted=true;
    if(justE){ openCraftMenu(); justE=false; return; }
    updateMining(0,false);
  } else if(damaged){
    const busy=updateRepair(dt,!!keys.KeyE,damaged);
    setPrompt('<span class="key">E</span>HOLD TO REPAIR '+CAT[damaged.t].name+' (2 Ferrite) — HP '+Math.max(0,damaged.hp|0)+'/'+CAT[damaged.t].hp);
    setMAct('REPAIR'); prompted=true;
    $('prog').classList.toggle('hidden',!busy);
    $('progFill').style.width=(repairHold/0.8*100)+'%';
    updateMining(0,false);
  } else {
    updateRepair(0,false,null);
    if(S.slot>0){
      const cw=curWeapon();
      mFire=true; setMAct(cw.thrown?'THROW':(cw.melee?'SWING':'FIRE')); prompted=true;
      setPrompt(inSafeZone(player.x,player.z)?'<span style="color:#8fefb0">SAFE ZONE — weapons disabled near Beacon</span>':'');
    } else {
      updateMining(dt,!!keys.KeyE);
      if(mineTarget>=0){
        setPrompt('<span class="key">E</span>HOLD TO MINE '+RES_NAMES[p.res].toUpperCase());
        setMAct('MINE'); prompted=true;
        $('prog').classList.toggle('hidden',!(mineProgress>0));
        $('progFill').style.width=(mineProgress/1.4*100)+'%';
      }
    }
  }
  if(!prompted){
    setPrompt(safe?'':'<span style="color:#9fdcf5;opacity:0.75">O₂ DRAINING — stay near ship, relays or base</span>');
    setMAct('—');
    $('prog').classList.add('hidden');
  }
  if(!buildSel&&!(mineProgress>0)&&!repairHold) $('prog').classList.add('hidden');
  /* tool / weapon anim */
  const mining2=S.slot===0&&keys.KeyE&&(mineTarget>=0||damaged);
  tool.rotation.x=mining2?Math.sin(performance.now()*0.04)*0.12:lerp(tool.rotation.x,0,0.2);
  tool.position.y=-0.3+Math.sin(footT)*0.012;
  if(weaponVM.blade.visible) weaponVM.blade.rotation.x=-0.5-(swingT>0?Math.sin((1-swingT/0.26)*Math.PI)*1.3:0);
  const kick=weaponCd>0&&S.slot>=2?Math.min(0.12,weaponCd):0;
  if(weaponVM.pistol.visible) weaponVM.pistol.position.z=-0.45+kick;
  if(weaponVM.rifle.visible) weaponVM.rifle.position.z=-0.4+kick;
  if(weaponVM.lance.visible) weaponVM.lance.position.z=-0.38+Math.min(0.18,weaponCd*0.12);
  if(weaponVM.inferno.visible){ const sh=fireHeld?Math.sin(performance.now()*0.05)*0.01:0; weaponVM.inferno.position.set(0.28+sh,-0.26,-0.4); }
  /* Lance Beam scope — brief FOV zoom while equipped */
  const wantFov=(curWeapon().scope&&!driving)?curWeapon().scope:74;
  if(Math.abs(camera.fov-wantFov)>0.15){ camera.fov+=(wantFov-camera.fov)*Math.min(1,dt*9); camera.updateProjectionMatrix(); }
  /* grenade throw arc preview */
  updateNadeAim();
  justE=false;
  /* timers */
  updateNodes(dt);
  updateMeteors(dt);
  updateLoot(dt);
  updateTurrets(dt);
  updateRoverMeshes(dt);
  updateCritters(dt);
  updateHeavyWeapons(dt);
  updateWater();
  dayClock+=dt; applyDayNight();
  S.ppos=[player.x,player.y,player.z]; S.pyaw=player.yaw;
  renderSurfaceCam();
}
function renderSurfaceCam(){
  const bob=S.headbob!==false?Math.sin(footT*2)*0.045:0;
  camera.position.set(player.x,player.y+player.h+bob,player.z);
  camera.rotation.set(player.pitch,player.yaw,0);
}

/* ============================================================
   START SCREEN / NEW GAME / CONTINUE / BOOT
   ============================================================ */
function resetState(){
  S.tier=1; S.res={fe:0,cy:0,bio:0,ch:0,pe:0}; S.structures=[];
  S.o2=100; S.fuel=100; S.beacon=false; S.victoryShown=false;
  S.station=[]; S.stationOnline=false;
  S.mode='space'; S.planet='rust';
  S.ppos=[0,0,0]; S.pyaw=0;
  S.spos=[PLANETS.rust.pos[0]+50,PLANETS.rust.pos[1]+18,PLANETS.rust.pos[2]+55];
  S.syaw=Math.atan2(50,55); S.spitch=-0.12; S.sspeed=4;
  S.pendingCutscene=null;
  S.weapons=readWeapons(null);
  S.ammo=readAmmo(null); S.medkits=0; S.slot=0;
  player.hp=HP_MAX; player.invuln=0;
}
function showGameUI(){
  $('start').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('vignette').classList.remove('hidden');
  ['vc1','vc2','vc3','vc4'].forEach(id=>$(id).classList.remove('hidden'));
}
function startGame(fromSave){
  S.running=true;
  showGameUI();
  player.hp=HP_MAX; player.invuln=0; S.slot=0; driving=null;
  $('protRing').classList.add('hidden');
  updateHUDRes(); updateTierBadge(); updateCapNote(); renderHotbar(); updateViewmodel();
  refreshStation();
  $('fuelwrap').classList.toggle('hidden',S.tier<3);
  for(const key in SHIELDED){ if(S.tier>=SHIELDED[key].tier&&shieldGroups[key].parent&&S.pendingCutscene!==key) spaceScene.remove(shieldGroups[key]); }
  if(fromSave&&S.mode==='surface') enterSurface(S.planet,true);
  else enterSpace(S.planet,fromSave);
  if(!fromSave) showToast('Fly to the red planet RUST and press E to LAND',5000);
  saveGame();
}
/* ---------- co-op setup / start ---------- */
let mpMode='host';
function openMpSetup(mode){
  mpMode=mode;
  $('mpTitle').textContent=mode==='host'?'Create Online World':'Join World by Code';
  $('mpCode').classList.toggle('hidden',mode==='host');
  $('mpGo').textContent=mode==='host'?'Create New World':'Join World';
  let snap=null;
  try{ snap=JSON.parse(localStorage.getItem(MP_WORLD_KEY)); }catch(e){}
  $('mpHostPrev').classList.toggle('hidden',!(mode==='host'&&snap&&snap.v===1));
  /* one-time solo-save import (Phase 3) */
  let solo=false;
  try{ solo=!!localStorage.getItem(SAVE_KEY)&&!localStorage.getItem(SOLO_IMPORTED_KEY); }catch(e){}
  $('mpImportSolo').classList.toggle('hidden',!(mode==='host'&&solo));
  /* recent worlds: tap to fill the code box */
  const rec=mode==='join'?recentWorlds():[];
  $('mpRecent').innerHTML=rec.length
    ?'<div style="margin:10px 0 2px;color:#5fa8c8;font-size:11px;letter-spacing:0.2em">RECENT WORLDS</div>'
      +rec.map(w=>'<button class="menuBtn" data-code="'+escHtml(w.code)+'" style="font-size:13px;padding:9px 0;margin:4px auto">'+escHtml(w.code)+'</button>').join('')
    :'';
  try{ $('mpName').value=localStorage.getItem('astravox_name')||''; }catch(e){}
  mpStatus('');
  openPanel('mpSetup');
}
function mpBegin(world){
  const name=$('mpName').value.trim().slice(0,16);
  if(!name){ mpStatus('Enter a name first'); return; }
  try{ localStorage.setItem('astravox_name',name); }catch(e){}
  NET.name=name;
  SND.ensure();
  if(mpMode==='host'){
    NET.isHost=true;
    NET.connect(world?{t:'host',name,world,auth:guestAuth()}:{t:'host',name,auth:guestAuth()});
  } else {
    const code=$('mpCode').value.trim().toUpperCase();
    if(code.length<4){ mpStatus('Enter the world code'); return; }
    NET.isHost=false;
    NET.connect({t:'join',code,name,auth:guestAuth()});
  }
}
/* import the legacy solo save into a brand-new persistent world we own */
$('mpImportSolo').addEventListener('click',()=>{
  const d=loadSavedState();
  if(!d){ mpStatus('No solo save found'); return; }
  const name=$('mpName').value.trim().slice(0,16);
  if(!name){ mpStatus('Enter a name first'); return; }
  try{ localStorage.setItem('astravox_name',name); }catch(e){}
  NET.name=name; NET.isHost=true;
  SND.ensure();
  pendingImportProg={tier:d.tier,res:d.res,weapons:d.weapons,ammo:d.ammo,medkits:d.medkits,o2:d.o2,fuel:d.fuel};
  NET.connect({t:'host',name,auth:guestAuth(),
    world:{structures:d.structures,station:d.station,stationOnline:d.stationOnline}});
});
$('mpRecent').addEventListener('click',e=>{
  const b=e.target&&e.target.closest('[data-code]');
  if(b){ $('mpCode').value=b.dataset.code; SND.blip(); }
});
$('btnHost').addEventListener('click',()=>{ SND.ensure(); SND.blip(); openMpSetup('host'); });
$('btnJoin').addEventListener('click',()=>{ SND.ensure(); SND.blip(); openMpSetup('join'); });
$('mpGo').addEventListener('click',()=>mpBegin(null));
$('mpHostPrev').addEventListener('click',()=>{
  let snap=null;
  try{ snap=JSON.parse(localStorage.getItem(MP_WORLD_KEY)); }catch(e){}
  if(!snap||snap.v!==1){ mpStatus('No previous world found'); return; }
  mpBegin(snap);
});
$('mpCode').addEventListener('input',()=>{ $('mpCode').value=$('mpCode').value.toUpperCase().replace(/[^A-Z0-9]/g,''); });
$('roomBadge').addEventListener('click',()=>{
  if(NET.code) fallbackCopy(NET.code,()=>showToast('Room code '+NET.code+' copied — send it to your friends'));
});
$('btnReconnect').addEventListener('click',()=>{
  $('netLost').classList.add('hidden');
  NET.connect({t:'join',code:NET.code,name:NET.name,auth:guestAuth()});
});
$('btnNetQuit').addEventListener('click',()=>{ NET.quitting=true; location.reload(); });

function installWorld(world){
  S.structures=world.structures.map(s=>{
    const st={id:s.id,t:s.t,pl:s.pl,x:s.x,y:s.y,z:s.z,r:s.r,hp:s.hp};
    if(s.owner!==undefined) st.owner=s.owner;
    if(s.ry!==undefined) st.ry=s.ry;
    return st;
  });
  S.beacon=!!world.beacon;
  NET.deadNodes={};
  for(const pl in (world.deadNodes||{})) NET.deadNodes[pl]=new Set(world.deadNodes[pl]);
  NET.meteor={};
  for(const pl in (world.meteor||{})){
    NET.meteor[pl]={phase:world.meteor[pl].phase,endAt:performance.now()+world.meteor[pl].secs*1000};
  }
  clearLoot();
  clearCritters();
  S.station=(world.station||[]).map(p=>({t:p.t,x:+p.x,y:+p.y,z:+p.z,qx:+p.qx,qy:+p.qy,qz:+p.qz,qw:+p.qw,r:p.r|0,id:p.id}));
  S.stationOnline=!!world.stationOnline;
  refreshStation();
  for(const c of (world.loot||[])) spawnLootBox(c.id,c.pl,c.pos,c.loot);
  NET.seats=new Map(world.seats||[]);
  if(typeof world.tod==='number') dayClock=world.tod*CYCLE_S;
}
let pendingImportProg=null;   // solo-save progress riding along with an import-host
function startMultiplayer(w){
  NET.active=true;
  NET.pid=w.pid; NET.code=w.code; NET.worldId=w.worldId;
  if(w.guest){ try{ localStorage.setItem(GUEST_KEY,JSON.stringify(w.guest)); }catch(e){} }   // server minted us an identity
  recordWorld(w.code);
  resetState();
  installWorld(w.world);
  if(S.beacon) S.victoryShown=true;
  let fromSave=false;
  if(w.fresh){
    /* first-ever join to this world: the one-time legacy import seam — a solo
       save being imported, or the old per-world localStorage blob; the server
       adopts it once (sanitized) and the store owns it from then on */
    let blob=pendingImportProg;
    if(!blob){ try{ blob=JSON.parse(localStorage.getItem(mpPlayerKey())); }catch(e){} }
    if(blob){
      S.tier=clamp(blob.tier|0,1,5);
      S.res={fe:Math.max(0,blob.res&&blob.res.fe|0||0),cy:Math.max(0,blob.res&&blob.res.cy|0||0),bio:Math.max(0,blob.res&&blob.res.bio|0||0),ch:Math.max(0,blob.res&&blob.res.ch|0||0),pe:Math.max(0,blob.res&&blob.res.pe|0||0)};
      S.o2=clamp(+blob.o2||100,5,200); S.fuel=clamp(+blob.fuel||100,0,100);
      if(blob.victoryShown) S.victoryShown=true;
      S.weapons=readWeapons(blob.weapons);
      S.ammo=readAmmo(blob.ammo);
      S.medkits=Math.max(0,blob.medkits|0); S.headbob=blob.headbob!==false;
      NET.send({t:'progRestore',prog:mpProgBlob()});
    } else if(w.prog) applyProg(w.prog);   // brand-new player (or Commander host): adopt server state
    if(pendingImportProg){
      try{ localStorage.setItem(SOLO_IMPORTED_KEY,'1'); }catch(e){}
      pendingImportProg=null;
      showToast('Solo save imported — this world now lives on the server',6000);
    }
  } else {
    /* returning player: server-stored progress + last position are the truth */
    if(w.prog){
      applyProg(w.prog);
      if(typeof w.prog.o2==='number') S.o2=clamp(w.prog.o2,5,o2Max());
      if(typeof w.prog.fuel==='number') S.fuel=clamp(w.prog.fuel,0,100);
    }
    if(w.loc&&Array.isArray(w.loc.pos)&&w.loc.pos.length===3&&w.loc.pos.every(v=>isFinite(+v))){
      if(w.loc.mode==='surface'&&PLANETS[w.loc.pl]){
        S.mode='surface'; S.planet=w.loc.pl;
        S.ppos=w.loc.pos.map(Number); S.pyaw=+w.loc.yaw||0;
        fromSave=true;
      } else if(w.loc.mode==='space'&&Math.hypot(w.loc.pos[0],w.loc.pos[1],w.loc.pos[2])>10){
        S.mode='space'; S.spos=w.loc.pos.map(Number); S.syaw=+w.loc.yaw||0;
        fromSave=true;
      }
    }
  }
  clearRemotes();
  NET.players=new Map(w.players.map(p=>[p.pid,{name:p.name,slot:p.slot}]));
  for(const p of w.players) if(p.pid!==NET.pid) addRemote(p.pid,p.name,p.slot);
  closeAllPanels();
  startGame(fromSave);
  updateRoomBadge();
  showToast('WORLD '+NET.code+' — click the badge (top right) to copy the invite code',6000);
}
function resyncFromWelcome(w){
  NET.pid=w.pid; NET.code=w.code; NET.worldId=w.worldId;
  if(w.guest){ try{ localStorage.setItem(GUEST_KEY,JSON.stringify(w.guest)); }catch(e){} }
  installWorld(w.world);
  /* reconnect: the server restored us from its store; only a fresh row
     (store lost us somehow) still needs the legacy hand-back */
  if(w.fresh) NET.send({t:'progRestore',prog:mpProgBlob()});
  else if(w.prog) applyProg(w.prog);
  clearRemotes();
  NET.players=new Map(w.players.map(p=>[p.pid,{name:p.name,slot:p.slot}]));
  for(const p of w.players) if(p.pid!==NET.pid) addRemote(p.pid,p.name,p.slot);
  if(S.mode==='surface'&&surf.built){
    refreshStructures();
    const dead=NET.deadNodes[S.planet]||new Set();
    for(let i=0;i<surf.nodes.length;i++){
      const want=!dead.has(i);
      if(surf.nodes[i].alive!==want){
        surf.nodes[i].alive=want;
        if(want) surf.nodes[i].respawn=0;
        nodeMatrixUpdate(i);
      }
    }
  }
  $('netLost').classList.add('hidden');
  updateRoomBadge();
  showToast('Reconnected to room '+NET.code);
}

const existingSave=loadSavedState();
if(!existingSave) $('btnContinue').disabled=true;
$('btnContinue').addEventListener('click',()=>{
  if(!existingSave) return;
  SND.ensure(); SND.blip();
  applySave(existingSave);
  startGame(true);
});
$('btnNew').addEventListener('click',()=>{
  SND.ensure(); SND.blip();
  if(existingSave&&!confirm('Start a new game? Your existing save will be overwritten.')) return;
  resetState();
  startGame(false);
});
$('btnTitleImport').addEventListener('click',()=>{ SND.ensure(); SND.blip(); openSettings(); $('importWrap').classList.remove('hidden'); });

/* ---------- secret "Commander" host: maxed resources (granted server-side) ---------- */
let secretTaps=0, secretT=0;
function secretHost(){
  if(S.running) return;
  NET.isHost=true;
  let name=''; try{ name=localStorage.getItem('astravox_name')||''; }catch(e){}
  NET.name=name||'COMMANDER';
  SND.ensure(); SND.tierUp();
  showToast('⚡ COMMANDER MODE — hosting a new world with maxed resources');
  NET.connect({t:'host',name:NET.name,cmd:1,auth:guestAuth()});
}
function secretTap(){
  if(S.running) return;
  const now=performance.now();
  if(now-secretT>1400) secretTaps=0;
  secretT=now; secretTaps++;
  if(secretTaps>=5){ secretTaps=0; secretHost(); }
}
(function(){
  const h=document.querySelector('#start h1');
  if(h){ h.style.cursor='default';
    h.addEventListener('click',secretTap);
    h.addEventListener('touchstart',e=>{ e.preventDefault(); secretTap(); },{passive:false});
  }
})();

/* autosave */
setInterval(saveGame,30000);
window.addEventListener('beforeunload',saveGame);
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') saveGame(); });

/* ============================================================
   MAIN LOOP
   ============================================================ */
let last=performance.now(), titleT=0;
function loop(now){
  requestAnimationFrame(loop);
  let dt=(now-last)/1000; last=now;
  if(!(dt>0)||dt>0.05) dt=Math.min(Math.max(dt,0.001),0.05);
  if(S.running){
    if(cs.active){ updateCutscene(dt); }
    else if(S.mode==='space') updateSpace(dt);
    else if(S.mode==='eva') updateEva(dt);
    else updateSurface(dt);
    if(NET.active){
      const nw=performance.now();
      if(nw-NET.lastPU>100&&!transitioning){ NET.lastPU=nw; sendPU(); }
      updateRemotes(dt);
    }
  } else {
    /* title backdrop: slow orbit through space */
    titleT+=dt*0.04;
    camera.position.set(Math.cos(titleT)*520,90+Math.sin(titleT*0.7)*40,Math.sin(titleT)*520);
    camera.lookAt(0,0,0);
    activeScene=spaceScene;
  }
  for(const key in shieldGroups){ const g=shieldGroups[key]; if(g.parent){ g.rotation.y+=dt*0.3; g.rotation.x+=dt*0.11; } }
  if(stationCore.visible){ stationCore.rotation.y+=dt*0.08;
    const cb=stationCore.getObjectByName('coreBeacon'); if(cb) cb.scale.setScalar(2.4+Math.sin(now*0.004)*0.4);
    if(stationGlow.visible) stationGlow.scale.setScalar(150+Math.sin(now*0.002)*30); }
  /* animated holo screens (consoles, holo-signs, armory) */
  const ho=0.55+0.3*Math.sin(now*0.005);
  MAT.screen.opacity=ho; MAT.holo.opacity=0.5+0.25*Math.sin(now*0.004+1.3);
  updateParticles(dt);
  updateFx(dt);
  if(S.running){ renderCompass(dt); updateMinimap(dt); }
  if(NET.active) updateChatFade();
  renderer.render(activeScene,camera);
}
requestAnimationFrame(loop);

/* debug / automation hook */
window.__SF={S,CAT,PLANETS,meteorState,surf,player,cs,ship,keys,NET,remotes,critters,CRITTERS,
  WEAPONS,SLOT_KEYS,throwables,shieldWalls,SHIELDED,shieldGroups,
  STATION,STATION_KEYS,STATION_POS,stationCore,stationGroup,
  day:()=>todNow(), setDay:(v)=>{dayClock=v*CYCLE_S;}, applyDayNight:()=>applyDayNight()};

/* ---- test bridge ----
   game code now lives in module scope, so the Playwright harness can't see
   top-level declarations. Re-expose the functions/objects tests use, and give
   mutable module vars accessor properties so bare assignments in page scope
   (e.g. `buildSel='flatroof'`) still reach the module bindings. */
Object.assign(window,{
  /* data/objects */
  S,CAT,PLANETS,TIERS,WEAPONS,CRAFT,STATION,STATION_KEYS,COLLIDERS,CRITTERS,
  SLOT_KEYS,SNAP_PIECES,SNAP_ROOFS,SNAP_WALLS,SNAP_FLOORS,player,NET,remotes,critters,structGlows,
  weaponVM,shieldWalls,throwables,surf,meteorState,evaPos,structMeshes,placedByType,
  camera,renderer,surfScene,spaceScene,GEO,MAT,
  /* every game function the /tmp/pwtest suite calls as a bare global */
  addShieldWall,anyPanelOpen,applyDayNight,applyNodeDead,applyPaint,applyRemoved,applyPlaced,
  applyStationPlaced,buildSaveObj,cancelBuild,canAfford,carryCap,clearMeteors,collidePlayer,craft,
  curP,curWeapon,doLand,doLaunch,drawMinimap,enterEva,enterRover,exitEva,exitRover,explodeGrenade,
  findSnap,finishBpSelect,fireWeapon,groundYAt,importBlueprint,inSafeZone,loadBlueprints,nearRover,
  o2Max,occupiedAt,parseSave,payCost,placeStamp,placeStationPiece,placeStructure,rebuildAux,
  refreshMobileUI,refreshStructures,renderBuildGrid,renderCompass,renderCraftGrid,renderHotbar,
  renderStationGrid,renderTierList,respawnPlayer,saveBlueprints,saveGame,selectBuild,selectStation,
  setSlot,shotBlocked,showToast,startShieldCutscene,startStamp,terrainH,terrainHWater,throwGadget,
  toggleFreePlace,toggleMap,triggerVictory,unlockTier,updateCritters,updateDoors,updateHUDRes,
  updateHeavyWeapons,updateStationGhost,updateStationVisibility,updateTierBadge,updateViewmodel,
  updateWater,useMed});
for(const [name,get,set] of [
  ['buildSel',()=>buildSel,v=>{buildSel=v;}],
  ['weaponCd',()=>weaponCd,v=>{weaponCd=v;}],
  ['nadeCd',()=>nadeCd,v=>{nadeCd=v;}],
  ['shieldCd',()=>shieldCd,v=>{shieldCd=v;}],
  ['dayClock',()=>dayClock,v=>{dayClock=v;}],
  ['driving',()=>driving,v=>{driving=v;}],
  ['freePlace',()=>freePlace,v=>{freePlace=v;}],
  ['bpStamp',()=>bpStamp,v=>{bpStamp=v;}],
]){
  Object.defineProperty(window,name,{get,set,configurable:true});
  Object.defineProperty(window.__SF,name,{get,set,configurable:true});
}
