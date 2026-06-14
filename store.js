/* ============================================================
   ASTRAVOX persistence layer (Phase 3)

   One async interface, two backends:
   - PgStore   — Postgres via DATABASE_URL (Railway plugin). Production.
   - FileStore — single JSON file in DATA_DIR (default ./data). Local dev
                 and tests: real restart-persistence without a database.

   Tables / shapes:
     players          id, token_hash, name, created_at, last_seen
                      (a player identity: a GUEST keyed by token_hash, OR —
                       Phase 2 — an account-backed row whose id IS a user id
                       and whose token_hash is an unusable sentinel)
     worlds           id, code (invite, unique), owner_id, created_at,
                      last_active
     world_state      world_id -> state jsonb (structures, station, beacon,
                      clock — the authoritative world snapshot)
     player_progress  (player_id, world_id) -> prog jsonb (res, tier,
                      weapons, ammo, medkits, o2, fuel, loc)
     users            id, email (unique, normalized), password_hash
                      (bcrypt), email_verified (future seam), created_at
                      — Phase-1 real accounts; Phase 2 links worlds/progress
     sessions         token_hash (sha256 of cookie token), user_id, expiry
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Phase 2: a logged-in user is backed by a row in `players` (so worlds/progress
   FKs resolve), keyed by the user id. Its token_hash is a sentinel that can
   NEVER equal a sha256 hex digest, so an account-backed player can never be
   claimed through the guest auth{id,tok} path — accounts authenticate only via
   their session cookie. */
const ACCOUNT_PLAYER_TOKEN = 'account';

/* ---------- Postgres backend ---------- */
class PgStore {
  constructor(url) { this.url = url; this.pool = null; }
  get kind() { return 'postgres'; }
  async init() {
    const { default: pg } = await import('pg');
    /* Railway internal networking + local Postgres speak plain TCP; only
       external/public URLs need (permissive) TLS */
    this.pool = new pg.Pool({ connectionString: this.url, max: 5,
      ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(this.url) ? false : { rejectUnauthorized: false } });
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
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT false,   -- future seam (email verification): unused
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,                      -- sha256 of the cookie token; raw token never stored
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);
  }
  /* ---- accounts (Phase 1 auth) ---- */
  async createUser({ id, email, passwordHash }) {
    await this.pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3)', [id, email, passwordHash]);
  }
  async getUserByEmail(email) {
    const r = await this.pool.query('SELECT id, email, password_hash FROM users WHERE email=$1', [email]);
    return r.rows[0] ? { id: r.rows[0].id, email: r.rows[0].email, passwordHash: r.rows[0].password_hash } : null;
  }
  async getUserById(id) {
    const r = await this.pool.query('SELECT id, email FROM users WHERE id=$1', [id]);
    return r.rows[0] || null;
  }
  async createSession({ tokenHash, userId, expiresAt }) {
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [tokenHash, userId, new Date(expiresAt)]);
  }
  async getSession(tokenHash) {
    const r = await this.pool.query('SELECT user_id, expires_at FROM sessions WHERE token_hash=$1', [tokenHash]);
    if (!r.rows[0]) return null;
    const exp = new Date(r.rows[0].expires_at).getTime();
    if (exp < Date.now()) { await this.deleteSession(tokenHash); return null; }
    return { userId: r.rows[0].user_id, expiresAt: exp };
  }
  async deleteSession(tokenHash) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]);
  }
  async sweepSessions() {
    await this.pool.query('DELETE FROM sessions WHERE expires_at < now()');
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
  /* Phase 2: ensure an account-backed players row exists for a logged-in user.
     Idempotent — runs on every host/join while logged in. */
  async ensureUserPlayer(id, name) {
    await this.pool.query(
      'INSERT INTO players (id, token_hash, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING',
      [id, ACCOUNT_PLAYER_TOKEN, name || 'PLAYER']);
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
  /* Phase 2: a user's owned worlds, newest-active first — lets a logged-in
     player find their worlds from any device. */
  async listWorldsByOwner(ownerId) {
    const r = await this.pool.query(
      'SELECT code, created_at, last_active FROM worlds WHERE owner_id=$1 ORDER BY last_active DESC', [ownerId]);
    return r.rows.map(x => ({ code: x.code, createdAt: x.created_at, lastActive: x.last_active }));
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
    this.d = { players: {}, worlds: {}, codes: {}, progress: {}, users: {}, usersByEmail: {}, sessions: {} };
    this._t = null;
  }
  get kind() { return 'file:' + this.dir; }
  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    try { this.d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) {}
    for (const k of ['players', 'worlds', 'codes', 'progress', 'users', 'usersByEmail', 'sessions']) this.d[k] = this.d[k] || {};
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
  async ensureUserPlayer(id, name) {
    if (this.d.players[id]) return;
    this.d.players[id] = { tokenHash: ACCOUNT_PLAYER_TOKEN, name: name || 'PLAYER', account: true, createdAt: Date.now(), lastSeen: Date.now() };
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
  async listWorldsByOwner(ownerId) {
    const out = [];
    for (const id in this.d.worlds) {
      const w = this.d.worlds[id];
      if (w.ownerId === ownerId) out.push({ code: w.code, createdAt: w.createdAt, lastActive: w.lastActive });
    }
    out.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
    return out;
  }
  async getProgress(playerId, worldId) {
    return this.d.progress[playerId + '|' + worldId] || null;
  }
  async saveProgress(playerId, worldId, prog) {
    this.d.progress[playerId + '|' + worldId] = prog;
    this._save();
  }
  /* ---- accounts (Phase 1 auth) ---- */
  async createUser({ id, email, passwordHash }) {
    if (this.d.usersByEmail[email]) { const e = new Error('duplicate email'); e.code = '23505'; throw e; }
    this.d.users[id] = { email, passwordHash, emailVerified: false, createdAt: Date.now() };
    this.d.usersByEmail[email] = id;
    this._save();
  }
  async getUserByEmail(email) {
    const id = this.d.usersByEmail[email]; if (!id) return null;
    const u = this.d.users[id]; if (!u) return null;
    return { id, email: u.email, passwordHash: u.passwordHash };
  }
  async getUserById(id) {
    const u = this.d.users[id];
    return u ? { id, email: u.email } : null;
  }
  async createSession({ tokenHash, userId, expiresAt }) {
    this.d.sessions[tokenHash] = { userId, expiresAt };
    this._save();
  }
  async getSession(tokenHash) {
    const s = this.d.sessions[tokenHash]; if (!s) return null;
    if (s.expiresAt < Date.now()) { delete this.d.sessions[tokenHash]; this._save(); return null; }
    return { userId: s.userId, expiresAt: s.expiresAt };
  }
  async deleteSession(tokenHash) {
    if (this.d.sessions[tokenHash]) { delete this.d.sessions[tokenHash]; this._save(); }
  }
  async sweepSessions() {
    const now = Date.now(); let ch = false;
    for (const k in this.d.sessions) if (this.d.sessions[k].expiresAt < now) { delete this.d.sessions[k]; ch = true; }
    if (ch) this._save();
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
