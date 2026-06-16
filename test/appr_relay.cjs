/* Identity P1 — server relays cosmetic appearance through welcome/pjoin/appr.
   Verifies the appearance blob travels host->joiner (welcome roster), the
   joiner->host (pjoin), live changes (appr), revert-to-stock (appr w/o body),
   and that the server sanitizes (clamps an out-of-range color). */
const { WebSocket } = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'ws://127.0.0.1:'+(process.env.PORT||3995);
function client(name){ const ws=new WebSocket(URL); const c={ws,name,pid:null,code:null,welcome:null,pjoin:[],appr:[],err:[]};
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw);}catch(e){return;}
    if(m.t==='welcome'){c.pid=m.pid;c.code=m.code;c.welcome=m;}
    if(m.t==='pjoin') c.pjoin.push(m);
    if(m.t==='appr') c.appr.push(m);
    if(m.t==='err') c.err.push(m.msg); });
  c.send=o=>ws.send(JSON.stringify(o)); c.ready=new Promise(r=>ws.on('open',r)); return c; }

const apprA={v:1,col:{body:0xff0000,limbs:0x00ff00,visor:0x0000ff,accent:0xffff00},helmetStyle:0,antenna:0,pack:1,trim:0};
const apprB={v:1,col:{body:0x112233,limbs:0x445566,visor:0x778899,accent:0xaabbcc},helmetStyle:0,antenna:1,pack:2,trim:0};

(async()=>{
  const checks=[];
  const ok=(name,cond)=>{ checks.push([name,!!cond]); console.log((cond?'PASS':'FAIL')+' — '+name); };

  // A hosts WITH a custom look
  const A=client('A'); await A.ready; A.send({t:'host',name:'A',appr:apprA}); await sleep(400);

  // B joins WITH a custom look; B's welcome roster should carry A's look
  const B=client('B'); await B.ready; B.send({t:'join',code:A.code,name:'B',appr:apprB}); await sleep(400);
  const aInB=B.welcome.players.find(p=>p.pid===A.pid);
  ok('welcome roster carries host appr to joiner', aInB && aInB.appr && aInB.appr.col.body===0xff0000);

  // A should have seen B's join carry B's look
  const bJoin=A.pjoin.find(p=>p.pid===B.pid);
  ok('pjoin carries joiner appr to host', bJoin && bJoin.appr && bJoin.appr.col.accent===0xaabbcc);
  ok('pjoin appr preserves option ids', bJoin && bJoin.appr.antenna===1 && bJoin.appr.pack===2);

  // live change: B recolors; A should receive an appr relay for B
  A.appr.length=0;
  const apprB2={v:1,col:{body:0x010203,limbs:0x040506,visor:0x070809,accent:0x0a0b0c},helmetStyle:1,antenna:0,pack:0,trim:1};
  B.send({t:'appr',appr:apprB2}); await sleep(300);
  const live=A.appr.find(x=>x.pid===B.pid);
  ok('live appr change relayed to peer', live && live.appr && live.appr.col.body===0x010203 && live.appr.helmetStyle===1);

  // server sanitizes: out-of-range color clamps, never echoes garbage
  A.appr.length=0;
  B.send({t:'appr',appr:{v:1,col:{body:0x1ffffff,limbs:'oops',visor:-5,accent:0x123456},helmetStyle:999,antenna:0,pack:1,trim:0}}); await sleep(300);
  const san=A.appr.find(x=>x.pid===B.pid);
  ok('server clamps bad color/opt ids', san && san.appr && san.appr.col.body===0 && san.appr.col.limbs===0 && san.appr.col.visor===0 && san.appr.col.accent===0x123456 && san.appr.helmetStyle===0);

  // revert to stock: appr with no payload => peer receives undefined appr
  A.appr.length=0;
  B.send({t:'appr'}); await sleep(300);
  const rev=A.appr.find(x=>x.pid===B.pid);
  ok('revert clears appr (back to stock slot color)', rev && rev.appr===undefined);

  ok('no server-side errors', A.err.length===0 && B.err.length===0);

  const pass=checks.every(c=>c[1]);
  console.log('\nRESULT:', pass?'PASS':'FAIL');
  process.exit(pass?0:1);
})();
