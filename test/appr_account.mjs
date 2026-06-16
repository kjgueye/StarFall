/* Identity P3 — account-scoped cosmetic appearance persists cross-device.
   Against a throwaway file-store server: signup -> POST /api/appearance saves
   4-slot blob -> GET /api/me returns it -> a SECOND session (other "device")
   sees the same looks -> guests (no session) are refused -> bad slots clamp.
   Usage: node test/appr_account.mjs [port] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.argv[2] || '3993';
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astravox-appr-'));
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dataDir } });
let done = false;
function cleanup(code){ if(done) return; done=true; try{srv.kill();}catch(e){} try{fs.rmSync(dataDir,{recursive:true,force:true});}catch(e){} process.exit(code); }

async function req(method, path_, body, cookie){
  const headers={}; if(body!==undefined) headers['content-type']='application/json'; if(cookie) headers['cookie']=cookie;
  const r=await fetch(BASE+path_,{method,headers,body:body!==undefined?JSON.stringify(body):undefined});
  let json=null; try{ json=await r.json(); }catch(e){}
  return { status:r.status, json, cookie:(r.headers.get('set-cookie')||'').split(';')[0] };
}
async function waitUp(){ for(let i=0;i<60;i++){ try{ const r=await fetch(BASE+'/healthz'); if(r.ok) return; }catch(e){} await new Promise(r=>setTimeout(r,100)); } throw new Error('server down'); }

const checks=[]; const ok=(n,c)=>{checks.push([n,!!c]);console.log((c?'PASS':'FAIL')+' — '+n);};
const A={col:{body:0x112233,limbs:0x445566,visor:0x778899,accent:0xaabbcc},helmetStyle:2,antenna:1,pack:2,trim:1};
const B={col:{body:0x010203,limbs:0x040506,visor:0x070809,accent:0x0a0b0c},helmetStyle:1,antenna:0,pack:0,trim:0};
const blob={v:2, slots:[A,B,null,null], active:1};

async function run(){
  await waitUp();
  const email='dev'+Date.now()+'@example.com';
  // guest (no cookie) cannot save
  const guest=await req('POST','/api/appearance',{appearance:blob});
  ok('guest POST /api/appearance refused (401)', guest.status===401);

  const su=await req('POST','/api/signup',{email,password:'Sup3rSecretPw!'});
  ok('signup ok', su.status===200 && su.cookie);
  const cookie=su.cookie;

  const save=await req('POST','/api/appearance',{appearance:blob},cookie);
  ok('save returns sanitized blob', save.status===200 && save.json.ok && save.json.appearance.active===1
     && save.json.appearance.slots[0].col.body===0x112233 && save.json.appearance.slots[0].helmetStyle===2
     && save.json.appearance.slots[2]===null);

  const me=await req('GET','/api/me',undefined,cookie);
  ok('me returns saved appearance', me.json.user && me.json.user.appearance
     && me.json.user.appearance.slots[1].col.accent===0x0a0b0c && me.json.user.appearance.active===1);

  // second "device": log in fresh, get the same looks
  const login=await req('POST','/api/login',{email,password:'Sup3rSecretPw!'});
  const me2=await req('GET','/api/me',undefined,login.cookie);
  ok('cross-device login sees same looks', me2.json.user.appearance.slots[0].col.body===0x112233
     && me2.json.user.appearance.slots[1].col.body===0x010203);

  // bad/oversized blob clamps (out-of-range active + option ids + extra slots)
  const bad=await req('POST','/api/appearance',{appearance:{slots:[{col:{body:0x1ffffff},helmetStyle:99},null,null,null,{col:{body:1}}],active:9}},cookie);
  ok('bad blob clamped (active->0, color->0, opt->0)', bad.status===200 && bad.json.appearance.active===0
     && bad.json.appearance.slots.length===4 && bad.json.appearance.slots[0].col.body===0
     && bad.json.appearance.slots[0].helmetStyle===0);

  const pass=checks.every(c=>c[1]);
  console.log('\nRESULT:', pass?'PASS':'FAIL');
  cleanup(pass?0:1);
}
run().catch(e=>{ console.error(e); cleanup(1); });
setTimeout(()=>{ console.error('timeout'); cleanup(1); }, 30000);
