import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import {
  type Cosmetics,
  DEFAULT_COSMETICS,
  type LifetimeStats,
  type ProfileView,
  RANKED,
  emptyStats,
  levelForXp,
  sanitizeCosmetics,
} from '../shared/economy';
import { type DailyState, dailyView, emptyDaily, sanitizeDaily } from '../shared/daily';
import { Mirror, type SqlClient } from './mirror';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** Everything saved for a player. Guests are keyed by their browser's guest id, accounts by id. */
export interface ProfileData {
  xp: number;
  coins: number;
  owned: string[];
  cosmetics: Cosmetics;
  stats: LifetimeStats;
  rating: number;
  rankedGames: number;
  /** UTC day (YYYY-MM-DD) of the last win, for the first-win-of-the-day bonus. */
  lastWinDay: string;
  /** Today's challenges and the daily play streak. */
  daily: DailyState;
}

export interface Account {
  id: number;
  name: string;
}

export function newProfile(): ProfileData {
  return { xp: 0, coins: 0, owned: [], cosmetics: { ...DEFAULT_COSMETICS }, stats: emptyStats(), rating: RANKED.start, rankedGames: 0, lastWinDay: '', daily: emptyDaily() };
}

export const guestKey = (guestId: string) => `g:${guestId}`;
export const accountKey = (id: number) => `a:${id}`;

/** Guest ids come from the browser (a random UUID); only accept sane ones. */
export function validGuestId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

const SESSION_DAYS = 90;
/** Different players reporting a face hides it until an admin looks. */
export const FACE_HIDE_REPORTS = 3;
const GUEST_TTL_DAYS = 120;
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function hashSecret(secret: string, salt?: Buffer): Promise<string> {
  const s = salt ?? randomBytes(16);
  const key = await scrypt(secret, s, 32);
  return `${s.toString('hex')}:${key.toString('hex')}`;
}

async function checkSecret(secret: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(secret, Buffer.from(saltHex, 'hex'), 32);
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && timingSafeEqual(want, key);
}

function recoveryCode(): string {
  const bytes = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    if (i === 3 || i === 7) s += '-';
  }
  return s;
}

function normalizeRecovery(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` : c;
}

/**
 * SQLite persistence (Node's built-in driver, no native modules). Profiles are cached in memory
 * and written back when they change; the game only touches them at match end and from the API.
 */
export class Store {
  readonly db: DatabaseSync;
  private readonly cache = new Map<string, ProfileData>();
  /** Durable Postgres copy (set with `attachMirror`), for hosts that wipe the disk. */
  mirror: Mirror | null = null;

  constructor(path = process.env.BUBBA_DB ?? 'data/bubba.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_lower TEXT NOT NULL UNIQUE,
        pass TEXT NOT NULL,
        recovery TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        flagged INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        reporter TEXT NOT NULL,
        target TEXT NOT NULL,
        target_name TEXT NOT NULL,
        room TEXT NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reports_target ON reports(target);
      CREATE TABLE IF NOT EXISTS faces (
        account_id INTEGER PRIMARY KEY,
        mime TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        reports INTEGER NOT NULL DEFAULT 0,
        banned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS face_reports (
        account_id INTEGER NOT NULL,
        reporter TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (account_id, reporter)
      );
    `);
    this.prune();
  }

  /** Drops expired sessions and guest profiles nobody has used in months. */
  prune(now = Date.now()): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    this.db.prepare("DELETE FROM profiles WHERE key LIKE 'g:%' AND updated_at < ?").run(now - GUEST_TTL_DAYS * 86400_000);
    this.mirror?.prune(now, now - GUEST_TTL_DAYS * 86400_000);
  }

  /**
   * Loads everything from Postgres (the source of truth from now on) and starts copying every
   * change back to it. Call before serving anyone.
   */
  async attachMirror(pg: SqlClient): Promise<{ accounts: number; profiles: number; uploaded: boolean }> {
    const mirror = new Mirror(pg, this.db);
    const loaded = await mirror.load();
    this.cache.clear();
    this.mirror = mirror;
    mirror.start();
    this.prune();
    return loaded;
  }

  /** Where saves go, for the health check. */
  storageInfo(): { storage: 'postgres' | 'sqlite'; pendingWrites?: number; writeError?: string } {
    if (!this.mirror) return { storage: 'sqlite' };
    return { storage: 'postgres', pendingWrites: this.mirror.pending, ...(this.mirror.lastError ? { writeError: this.mirror.lastError } : {}) };
  }

  // --- Accounts ------------------------------------------------------------------------------

  accountByName(name: string): Account | null {
    const row = this.db.prepare('SELECT id, name FROM accounts WHERE name_lower = ?').get(name.toLowerCase()) as { id: number; name: string } | undefined;
    return row ? { id: Number(row.id), name: row.name } : null;
  }

  accountById(id: number): Account | null {
    const row = this.db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(id) as { id: number; name: string } | undefined;
    return row ? { id: Number(row.id), name: row.name } : null;
  }

  /** Creates an account. Returns null if the name is taken. The recovery code is shown once. */
  async createAccount(name: string, password: string): Promise<{ account: Account; recoveryCode: string } | null> {
    if (this.accountByName(name)) return null;
    const code = recoveryCode();
    const [pass, recovery] = await Promise.all([hashSecret(password), hashSecret(code)]);
    // Re-check after the (async) hashing in case someone else took the name meanwhile.
    if (this.accountByName(name)) return null;
    const res = this.db.prepare('INSERT INTO accounts (name, name_lower, pass, recovery, created_at) VALUES (?, ?, ?, ?, ?)').run(name, name.toLowerCase(), pass, recovery, Date.now());
    const id = Number(res.lastInsertRowid);
    this.mirror?.account(id);
    return { account: { id, name }, recoveryCode: code };
  }

  async login(name: string, password: string): Promise<Account | null> {
    const row = this.db.prepare('SELECT id, name, pass FROM accounts WHERE name_lower = ?').get(name.toLowerCase()) as
      | { id: number; name: string; pass: string }
      | undefined;
    if (!row) {
      // Same work either way so response time doesn't reveal which names exist.
      await hashSecret(password);
      return null;
    }
    return (await checkSecret(password, row.pass)) ? { id: Number(row.id), name: row.name } : null;
  }

  /** Sets a new password using the recovery code; issues a fresh recovery code. */
  async resetPassword(name: string, code: string, password: string): Promise<{ account: Account; recoveryCode: string } | null> {
    const row = this.db.prepare('SELECT id, name, recovery FROM accounts WHERE name_lower = ?').get(name.toLowerCase()) as
      | { id: number; name: string; recovery: string }
      | undefined;
    if (!row) {
      await hashSecret(code);
      return null;
    }
    if (!(await checkSecret(normalizeRecovery(code), row.recovery))) return null;
    const next = recoveryCode();
    const [pass, recovery] = await Promise.all([hashSecret(password), hashSecret(next)]);
    this.db.prepare('UPDATE accounts SET pass = ?, recovery = ? WHERE id = ?').run(pass, recovery, row.id);
    this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(row.id);
    this.mirror?.account(Number(row.id));
    this.mirror?.deleteSessionsOf(Number(row.id));
    return { account: { id: Number(row.id), name: row.name }, recoveryCode: next };
  }

  createSession(accountId: number): string {
    const token = randomBytes(32).toString('hex');
    const hash = sha256(token);
    this.db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)').run(hash, accountId, Date.now() + SESSION_DAYS * 86400_000);
    this.mirror?.session(hash);
    return token;
  }

  sessionAccount(token: unknown): Account | null {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
    const row = this.db.prepare('SELECT account_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as { account_id: number; expires_at: number } | undefined;
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return this.accountById(Number(row.account_id));
  }

  deleteSession(token: string): void {
    const hash = sha256(token);
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    this.mirror?.deleteSession(hash);
  }

  flagAccount(id: number): void {
    this.db.prepare('UPDATE accounts SET flagged = 1 WHERE id = ?').run(id);
    this.mirror?.account(id);
  }

  // --- Profiles ------------------------------------------------------------------------------

  /** Loads (or starts) a profile. Changes are kept in memory until `saveProfile`. */
  profile(key: string): ProfileData {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const row = this.db.prepare('SELECT data FROM profiles WHERE key = ?').get(key) as { data: string } | undefined;
    let data = newProfile();
    if (row) {
      try {
        const parsed = JSON.parse(row.data) as Partial<ProfileData>;
        data = { ...data, ...parsed, stats: { ...emptyStats(), ...(parsed.stats ?? {}) } };
        // Level rewards count as owned from your level; slots added since the save get defaults.
        data.cosmetics = sanitizeCosmetics(data.cosmetics, data.owned, levelForXp(data.xp).level);
        // Profiles saved before daily challenges existed have no `daily` (sanitize fills it in).
        data.daily = sanitizeDaily(parsed.daily);
      } catch {
        // Corrupt row: start over rather than crash.
      }
    }
    this.cache.set(key, data);
    if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
    return data;
  }

  hasProfile(key: string): boolean {
    return this.cache.has(key) || !!this.db.prepare('SELECT 1 FROM profiles WHERE key = ?').get(key);
  }

  saveProfile(key: string): void {
    const data = this.cache.get(key);
    if (!data) return;
    this.db
      .prepare('INSERT INTO profiles (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(key, JSON.stringify(data), Date.now());
    this.mirror?.profile(key);
  }

  /** "Creating an account keeps a guest's existing progress." */
  adoptGuestProfile(guestId: string, accountId: number): void {
    const from = guestKey(guestId);
    const to = accountKey(accountId);
    if (this.hasProfile(to) || !this.hasProfile(from)) return;
    const data = this.profile(from);
    this.cache.set(to, data);
    this.cache.delete(from);
    this.saveProfile(to);
    this.db.prepare('DELETE FROM profiles WHERE key = ?').run(from);
    this.mirror?.deleteProfile(from);
  }

  /** The profile as its owner sees it. Takes the key because the day's challenges are picked from it. */
  view(key: string, name: string | null, isAccount: boolean, now = Date.now()): ProfileView {
    const data = this.profile(key);
    const lv = levelForXp(data.xp);
    return {
      name,
      isAccount,
      level: lv.level,
      xp: data.xp,
      xpInto: lv.into,
      xpNext: lv.next,
      coins: data.coins,
      owned: [...data.owned],
      cosmetics: { ...data.cosmetics },
      stats: data.stats,
      rating: isAccount ? data.rating : null,
      rankedGames: data.rankedGames,
      daily: dailyView(data.daily, key, now),
    };
  }

  private board: { at: number; limit: number; rows: { name: string; rating: number; games: number; level: number }[] } | null = null;

  /**
   * Top ranked players (accounts with at least one ranked game). Reading every account is slow
   * once there are many, and it runs on the same thread as the matches, so the result is reused
   * for half a minute.
   */
  leaderboard(limit = 20, now = Date.now()): { name: string; rating: number; games: number; level: number }[] {
    if (this.board && this.board.limit === limit && now - this.board.at < 30_000) return this.board.rows;
    const rows = this.computeLeaderboard(limit);
    this.board = { at: now, limit, rows };
    return rows;
  }

  private computeLeaderboard(limit: number): { name: string; rating: number; games: number; level: number }[] {
    const rows = this.db.prepare("SELECT key, data FROM profiles WHERE key LIKE 'a:%'").all() as { key: string; data: string }[];
    const out: { name: string; rating: number; games: number; level: number }[] = [];
    for (const r of rows) {
      const data = this.cache.get(r.key) ?? (JSON.parse(r.data) as ProfileData);
      if (!data.rankedGames) continue;
      const acc = this.accountById(Number(r.key.slice(2)));
      if (acc) out.push({ name: acc.name, rating: data.rating, games: data.rankedGames, level: levelForXp(data.xp).level });
    }
    return out.sort((a, b) => b.rating - a.rating).slice(0, limit);
  }

  // --- Face scans ------------------------------------------------------------------------------
  // Accounts can put a photo of their own face on their tube man. Players can report a face (it
  // hides itself after FACE_HIDE_REPORTS different reporters), and admins can remove any face or
  // stop an account from uploading again.

  /** Saves (or replaces) an account's face. False if the account is banned from face scans. */
  setFace(accountId: number, mime: string, base64: string, now = Date.now()): boolean {
    const row = this.db.prepare('SELECT banned FROM faces WHERE account_id = ?').get(accountId) as { banned: number } | undefined;
    if (row && Number(row.banned)) return false;
    this.db
      .prepare(
        'INSERT INTO faces (account_id, mime, data, updated_at, hidden, reports, banned) VALUES (?, ?, ?, ?, 0, 0, 0) ON CONFLICT(account_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at, hidden = 0, reports = 0',
      )
      .run(accountId, mime, base64, now);
    this.db.prepare('DELETE FROM face_reports WHERE account_id = ?').run(accountId);
    this.mirror?.row('faces', { account_id: accountId });
    this.mirror?.deleteRows('face_reports', { account_id: accountId });
    return true;
  }

  /** Removes a face. `ban` also stops the account from uploading another one. */
  removeFace(accountId: number, ban = false): void {
    this.db.prepare('DELETE FROM face_reports WHERE account_id = ?').run(accountId);
    this.mirror?.deleteRows('face_reports', { account_id: accountId });
    if (ban) {
      this.db
        .prepare("INSERT INTO faces (account_id, mime, data, updated_at, hidden, reports, banned) VALUES (?, '', '', ?, 1, 0, 1) ON CONFLICT(account_id) DO UPDATE SET mime = '', data = '', hidden = 1, banned = 1")
        .run(accountId, Date.now());
      this.mirror?.row('faces', { account_id: accountId });
    } else {
      this.db.prepare('DELETE FROM faces WHERE account_id = ?').run(accountId);
      this.mirror?.deleteRows('faces', { account_id: accountId });
    }
  }

  /** Undoes a report-hide (and a ban). */
  restoreFace(accountId: number): void {
    this.db.prepare('UPDATE faces SET hidden = 0, reports = 0, banned = 0 WHERE account_id = ?').run(accountId);
    this.db.prepare("DELETE FROM faces WHERE account_id = ? AND data = ''").run(accountId);
    this.db.prepare('DELETE FROM face_reports WHERE account_id = ?').run(accountId);
    if (this.db.prepare('SELECT 1 FROM faces WHERE account_id = ?').get(accountId)) this.mirror?.row('faces', { account_id: accountId });
    else this.mirror?.deleteRows('faces', { account_id: accountId });
    this.mirror?.deleteRows('face_reports', { account_id: accountId });
  }

  /** The face image, or null if there is none or it is hidden. `evenHidden` is for admins. */
  face(accountId: number, evenHidden = false): { mime: string; data: Buffer; version: number } | null {
    const r = this.db.prepare('SELECT mime, data, updated_at, hidden FROM faces WHERE account_id = ?').get(accountId) as
      | { mime: string; data: string; updated_at: number; hidden: number }
      | undefined;
    if (!r || !r.data || (Number(r.hidden) && !evenHidden)) return null;
    return { mime: r.mime, data: Buffer.from(r.data, 'base64'), version: Number(r.updated_at) };
  }

  /** What the owner sees: their face's version (for the image URL) and whether it's hidden or banned. */
  faceStatus(accountId: number): { version: number | null; hidden: boolean; banned: boolean } {
    const r = this.db.prepare('SELECT updated_at, hidden, banned, data FROM faces WHERE account_id = ?').get(accountId) as
      | { updated_at: number; hidden: number; banned: number; data: string }
      | undefined;
    if (!r) return { version: null, hidden: false, banned: false };
    return { version: r.data ? Number(r.updated_at) : null, hidden: !!Number(r.hidden), banned: !!Number(r.banned) };
  }

  /** Version stamp of an account's visible face (for rosters), or undefined. */
  faceVersion(accountId: number | null): number | undefined {
    if (accountId === null) return undefined;
    const r = this.db.prepare("SELECT updated_at FROM faces WHERE account_id = ? AND hidden = 0 AND data != ''").get(accountId) as { updated_at: number } | undefined;
    return r ? Number(r.updated_at) : undefined;
  }

  /** One report per reporter. Returns true when this report hid the face. */
  reportFace(accountId: number, reporter: string, now = Date.now()): boolean {
    const face = this.db.prepare('SELECT hidden, data FROM faces WHERE account_id = ?').get(accountId) as { hidden: number; data: string } | undefined;
    if (!face || !face.data || Number(face.hidden)) return false;
    const res = this.db.prepare('INSERT OR IGNORE INTO face_reports (account_id, reporter, at) VALUES (?, ?, ?)').run(accountId, reporter, now);
    if (!Number(res.changes)) return false;
    this.mirror?.row('face_reports', { account_id: accountId, reporter });
    const n = Number((this.db.prepare('SELECT COUNT(*) AS n FROM face_reports WHERE account_id = ?').get(accountId) as { n: number }).n);
    const hide = n >= FACE_HIDE_REPORTS;
    this.db.prepare('UPDATE faces SET reports = ?, hidden = ? WHERE account_id = ?').run(n, hide ? 1 : 0, accountId);
    this.mirror?.row('faces', { account_id: accountId });
    return hide;
  }

  /** Every face with its owner and status, newest first (admin page). */
  listFaces(): { id: number; name: string; updatedAt: number; hidden: boolean; banned: boolean; reports: number }[] {
    const rows = this.db
      .prepare('SELECT f.account_id AS id, a.name AS name, f.updated_at AS at, f.hidden AS hidden, f.banned AS banned, f.reports AS reports FROM faces f LEFT JOIN accounts a ON a.id = f.account_id ORDER BY f.updated_at DESC')
      .all() as { id: number; name: string | null; at: number; hidden: number; banned: number; reports: number }[];
    return rows.map((r) => ({ id: Number(r.id), name: r.name ?? '?', updatedAt: Number(r.at), hidden: !!Number(r.hidden), banned: !!Number(r.banned), reports: Number(r.reports) }));
  }

  // --- Reports ---------------------------------------------------------------------------------

  addReport(reporter: string, target: string, targetName: string, room: string, reason: string): void {
    const res = this.db.prepare('INSERT INTO reports (at, reporter, target, target_name, room, reason) VALUES (?, ?, ?, ?, ?, ?)').run(Date.now(), reporter, target, targetName, room, reason);
    this.mirror?.report(Number(res.lastInsertRowid));
  }

  reports(limit = 100): { at: number; reporter: string; target: string; target_name: string; room: string; reason: string }[] {
    return this.db.prepare('SELECT at, reporter, target, target_name, room, reason FROM reports ORDER BY id DESC LIMIT ?').all(limit) as never;
  }

  /** Finishes writing to Postgres (if attached), then closes. */
  async shutdown(ms = 8000): Promise<void> {
    if (this.mirror) {
      this.mirror.stop();
      const ok = await this.mirror.drain(ms);
      if (!ok) console.error(`[blubba] shutting down with ${this.mirror.pending} unsaved database change(s)`);
    }
    this.close();
  }

  close(): void {
    this.db.close();
  }
}
