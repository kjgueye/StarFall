/* Boots a throwaway game server, runs the given test script against it, tears down.
   Usage: node test/with_server.mjs <testfile> [port] */
import { spawn } from 'node:child_process';

const test = process.argv[2];
const port = process.argv[3] || '3995';
if (!test) { console.error('usage: node test/with_server.mjs <testfile> [port]'); process.exit(2); }

const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: port }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));

const t = spawn(process.execPath, [test], { env: { ...process.env, PORT: port }, stdio: 'inherit' });
t.on('exit', code => { srv.kill(); process.exit(code ?? 1); });
srv.on('exit', () => {});
