/* ============================================================
   ASTRAVOX persistence layer (Phase 3)

   One async interface, two backends:
   - PgStore   — Postgres via DATABASE_URL (Railway plugin). Production.
   - FileStore — single JSON file in DATA_DIR (default ./data). Local dev
                 and tests: real restart-persistence without a database.

   Tables / shapes:
     players          id, token_hash, name, created_at, last_seen
                      (guest accounts; "upgrade to real auth" is a future
                       seam — add columns, keep the id)
     worlds           id, code (invite, unique), owner_id, created_at,
                      last_active
     world_state      world_id -> state jsonb (structures, station, beacon,
                      clock — the authoritative world snapshot)
     player_progress  (player_id, world_id) -> prog jsonb (res, tier,
                      weapons, ammo, medkits, o2, fuel, loc)
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------- Postgres backend ---------- */
class PgStore {
  constructor(url) { this.url = url; this.pool = null; }
  get kind() { return 'postgres'; }
  async init() {
    const { default: pg } = await import('pg');
    this.pool = new pg.Pool({ connectionString: this.url, max: 5,
      ssl: /localhost|127\.0\.0\.1/.test(this.url) ? false : { rejectUnauthorized: false } });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'PLAYER',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS worlds (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        owner_id TEXT REFERENCES players(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_active TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS world_state (
        world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
        state JSONB NOT NULL,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS player_progress (
        player_id TEXT NOT NULL REFERENCES players(id),
        world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
        prog JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (player_id, world_id)
      );
    `);
  }
  async authPlayer(id, tokenHash) {
    const r = await this.pool.query('SELECT id, name FROM players WHERE id=$1 AND token_hash=$2', [id, tokenHash]);
    return r.rows[0] || null;
  }
  async createPlayer({ id, tokenHash, name }) {
    await this.pool.query('INSERT INTO players (id, token_hash, name) VALUES ($1,$2,$3)', [id, tokenHash, name || 'PLAYER']);
  }
  async touchPlayer(id, name) {
    await this.pool.query('UPDATE players SET last_seen=now(), name=COALESCE($2,name) WHERE id=$1', [id, name || null]);
  }
  async getWorldByCode(code) {
    const r = await this.pool.query(
      'SELECT w.id, w.code, w.owner_id, s.state FROM worlds w LEFT JOIN world_state s ON s.world_id=w.id WHERE w.code=$1', [code]);
    return r.rows[0] ? { id: r.rows[0].id, code: r.rows[0].code, ownerId: r.rows[0].owner_id, state: r.rows[0].state } : null;
  }
  async getWorldById(id) {
    const r = await this.pool.query(
      'SELECT w.id, w.code, w.owner_id, s.state FROM worlds w LEFT JOIN world_state s ON s.world_id=w.id WHERE w.id=$1', [id]);
    return r.rows[0] ? { id: r.rows[0].id, code: r.rows[0].code, ownerId: r.rows[0].owner_id, state: r.rows[0].state } : null;
  }
  async createWorld({ id, code, ownerId, state }) {
    await this.pool.query('INSERT INTO worlds (id, code, owner_id) VALUES ($1,$2,$3)', [id, code, ownerId]);
    await this.pool.query('INSERT INTO world_state (world_id, state) VALUES ($1,$2)', [id, state]);
  }
  async saveWorldState(id, state) {
    await this.pool.query(`INSERT INTO world_state (world_id, state, saved_at) VALUES ($1,$2,now())
      ON CONFLICT (world_id) DO UPDATE SET state=$2, saved_at=now()`, [id, state]);
    await this.pool.query('UPDATE worlds SET last_active=now() WHERE id=$1', [id]);
  }
  async countWorldsByOwner(ownerId) {
    const r = await this.pool.query('SELECT count(*)::int AS n FROM worlds WHERE owner_id=$1', [ownerId]);
    return r.rows[0].n;
  }
  async getProgress(playerId, worldId) {
    const r = await this.pool.query('SELECT prog FROM player_progress WHERE player_id=$1 AND world_id=$2', [playerId, worldId]);
    return r.rows[0] ? r.rows[0].prog : null;
  }
  async saveProgress(playerId, worldId, prog) {
    await this.pool.query(`INSERT INTO player_progress (player_id, world_id, prog, updated_at) VALUES ($1,$2,$3,now())
      ON CONFLICT (player_id, world_id) DO UPDATE SET prog=$3, updated_at=now()`, [playerId, worldId, prog]);
  }
  async flush() {}
  async close() { try { await this.pool.end(); } catch (e) {} }
}

/* ---------- file backend (local dev / tests) ---------- */
class FileStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.d = { players: {}, worlds: {}, codes: {}, progress: {} };
    this._t = null;
  }
  get kind() { return 'file:' + this.dir; }
  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    try { this.d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) {}
    for (const k of ['players', 'worlds', 'codes', 'progress']) this.d[k] = this.d[k] || {};
  }
  _save() {           // debounced atomic write
    if (this._t) return;
    this._t = setTimeout(() => { this._t = null; this._write(); }, 250);
  }
  _write() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.d));
      fs.renameSync(tmp, this.file);
    } catch (e) {}
  }
  async authPlayer(id, tokenHash) {
    const p = this.d.players[id];
    return p && p.tokenHash === tokenHash ? { id, name: p.name } : null;
  }
  async createPlayer({ id, tokenHash, name }) {
    this.d.players[id] = { tokenHash, name: name || 'PLAYER', createdAt: Date.now(), lastSeen: Date.now() };
    this._save();
  }
  async touchPlayer(id, name) {
    const p = this.d.players[id]; if (!p) return;
    p.lastSeen = Date.now(); if (name) p.name = name;
    this._save();
  }
  async getWorldByCode(code) {
    const id = this.d.codes[code];
    return id ? this.getWorldById(id) : null;
  }
  async getWorldById(id) {
    const w = this.d.worlds[id];
    return w ? { id, code: w.code, ownerId: w.ownerId, state: w.state } : null;
  }
  async createWorld({ id, code, ownerId, state }) {
    this.d.worlds[id] = { code, ownerId, state, createdAt: Date.now(), lastActive: Date.now() };
    this.d.codes[code] = id;
    this._save();
  }
  async saveWorldState(id, state) {
    const w = this.d.worlds[id]; if (!w) return;
    w.state = state; w.lastActive = Date.now();
    this._save();
  }
  async countWorldsByOwner(ownerId) {
    let n = 0;
    for (const id in this.d.worlds) if (this.d.worlds[id].ownerId === ownerId) n++;
    return n;
  }
  async getProgress(playerId, worldId) {
    return this.d.progress[playerId + '|' + worldId] || null;
  }
  async saveProgress(playerId, worldId, prog) {
    this.d.progress[playerId + '|' + worldId] = prog;
    this._save();
  }
  async flush() { if (this._t) { clearTimeout(this._t); this._t = null; } this._write(); }
  async close() { await this.flush(); }
}

export async function openStore() {
  let s;
  if (process.env.DATABASE_URL) s = new PgStore(process.env.DATABASE_URL);
  else s = new FileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
  await s.init();
  return s;
}
