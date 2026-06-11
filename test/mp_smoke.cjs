const { WebSocket } = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = 'ws://127.0.0.1:'+(process.env.PORT||3997);
function client(name){ const ws=new WebSocket(URL); const c={ws,name,pid:null,code:null,placed:[],removed:[],welcome:null,err:[],prog:null};
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw);}catch(e){return;}
    if(m.t==='welcome'){c.pid=m.pid;c.code=m.code;c.welcome=m;}
    if(m.t==='placed') c.placed.push(m.st);
    if(m.t==='removed') c.removed.push(m.id);
    if(m.t==='prog') c.prog=m;
    if(m.t==='err') c.err.push(m.msg); });
  c.send=o=>ws.send(JSON.stringify(o)); c.ready=new Promise(r=>ws.on('open',r)); return c; }
/* stand on Rust near origin so placements are in range (server-authoritative since P2.2) */
const surfPU={t:'pu',pos:[0,1,0],yaw:0,pitch:0,mode:'surface',pl:'rust'};
(async()=>{
  const A=client('A'); await A.ready; A.send({t:'host',name:'A'}); await sleep(400);
  A.send({t:'progRestore',prog:{tier:2,res:{fe:500,cy:100,bio:0,ch:0,pe:0}}});
  A.send(surfPU);
  const B=client('B'); await B.ready; B.send({t:'join',code:A.code,name:'B'}); await sleep(400);
  B.send(surfPU);

  // A places two flatroof slabs + a control floor (paid from server-tracked resources)
  A.send({t:'place',st:{t:'flatroof',pl:'rust',x:0,y:3,z:0,r:0,hp:100}});
  A.send({t:'place',st:{t:'flatroof',pl:'rust',x:4,y:3,z:0,r:0,hp:100}});
  A.send({t:'place',st:{t:'floor',pl:'rust',x:0,y:0.4,z:8,r:0,hp:100}});  // control
  await sleep(600);

  const flatOnB = B.placed.filter(s=>s.t==='flatroof');
  console.log('B received placed:', B.placed.map(s=>s.t+'@'+s.x+','+s.z));
  console.log('B flatroof count:', flatOnB.length, '(expect 2)');
  console.log('positions correct:', flatOnB.length===2 && flatOnB.some(s=>s.x===0)&&flatOnB.some(s=>s.x===4));
  console.log('A errors:', A.err, '| B errors:', B.err);
  const paid = A.prog && A.prog.res.fe===500-6-6-4 && A.prog.res.cy===100-2-2;
  console.log('A paid for pieces (prog):', paid, A.prog&&A.prog.res);

  // B has no resources — the same placement must be rejected
  B.send({t:'place',st:{t:'flatroof',pl:'rust',x:8,y:3,z:0,r:0,hp:100}});
  await sleep(400);
  const rejected = B.err.some(e=>/tier|resources/i.test(e)) && B.placed.filter(s=>s.t==='flatroof').length===2;
  console.log('broke B rejected:', rejected);

  // late joiner sees flatroof in welcome world snapshot
  const C=client('C'); await C.ready; C.send({t:'join',code:A.code,name:'C'}); await sleep(500);
  const w=C.welcome.world;
  const flatInWorld = w.structures.filter(s=>s.t==='flatroof').length;
  console.log('late joiner welcome flatroof count:', flatInWorld, '(expect 2)');

  const pass = flatOnB.length===2 && A.err.length===0 && flatInWorld===2 && paid && rejected;
  console.log('\nRESULT:', pass?'PASS':'FAIL');
  process.exit(pass?0:1);
})();
