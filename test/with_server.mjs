/* Boots a throwaway game server, runs the given test script against it, tears down.
   Each run gets a fresh temp DATA_DIR so the Phase-3 file store never leaks
   state between runs (and never touches ./data).
   Usage: node test/with_server.mjs <testfile> [port] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const test = process.argv[2];
const port = process.argv[3] || '3995';
if (!test) { console.error('usage: node test/with_server.mjs <testfile> [port]'); process.exit(2); }

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astravox-test-'));
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: port, DATA_DIR: dataDir }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));

const t = spawn(process.execPath, [test], { env: { ...process.env, PORT: port }, stdio: 'inherit' });
t.on('exit', code => {
  srv.kill();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(code ?? 1);
});
srv.on('exit', () => {});
