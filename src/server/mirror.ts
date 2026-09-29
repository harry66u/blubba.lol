import type { DatabaseSync } from 'node:sqlite';

/** The little bit of a Postgres client the mirror needs (node-postgres' Pool fits). */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end?(): Promise<void>;
}

type Op =
  | { k: 'account'; id: number }
  | { k: 'session'; hash: string }
  | { k: 'delSession'; hash: string }
  | { k: 'delSessionsOf'; accountId: number }
  | { k: 'profile'; key: string }
  | { k: 'delProfile'; key: string }
  | { k: 'report'; id: number }
  | { k: 'prune'; sessionsBefore: number; guestsBefore: number }
  /** Copies one row (by primary key) of a table in TABLES as it is now, or deletes matching rows. */
  | { k: 'upsert'; table: string; key: Record<string, string | number> }
  | { k: 'delete'; table: string; key: Record<string, string | number> }
  /** Deletes rows whose `col` sorts before `value` (old daily counts). */
  | { k: 'deleteBefore'; table: string; col: string; value: string };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS blubba_accounts (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    name_lower TEXT NOT NULL UNIQUE,
    pass TEXT NOT NULL,
    recovery TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    flagged INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS blubba_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blubba_profiles (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blubba_reports (
    id BIGINT PRIMARY KEY,
    at BIGINT NOT NULL,
    reporter TEXT NOT NULL,
    target TEXT NOT NULL,
    target_name TEXT NOT NULL,
    room TEXT NOT NULL,
    reason TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blubba_faces (
    account_id BIGINT PRIMARY KEY,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    reports INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS blubba_face_reports (
    account_id BIGINT NOT NULL,
    reporter TEXT NOT NULL,
    at BIGINT NOT NULL,
    PRIMARY KEY (account_id, reporter)
  );
  CREATE TABLE IF NOT EXISTS blubba_decals (
    account_id BIGINT PRIMARY KEY,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    reports INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS blubba_decal_reports (
    account_id BIGINT NOT NULL,
    reporter TEXT NOT NULL,
    at BIGINT NOT NULL,
    PRIMARY KEY (account_id, reporter)
  );
  CREATE TABLE IF NOT EXISTS blubba_friends (
    a BIGINT NOT NULL,
    b BIGINT NOT NULL,
    status TEXT NOT NULL,
    requested_by BIGINT NOT NULL,
    at BIGINT NOT NULL,
    PRIMARY KEY (a, b)
  );
  CREATE TABLE IF NOT EXISTS blubba_daily_active (
    day TEXT NOT NULL,
    key TEXT NOT NULL,
    PRIMARY KEY (day, key)
  );
  CREATE TABLE IF NOT EXISTS blubba_character_faces (
    account_id BIGINT PRIMARY KEY,
    char_key TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0,
    at BIGINT NOT NULL
  );
`;

const TABLES: readonly { local: string; remote: string; cols: readonly string[]; pk: readonly string[] }[] = [
  { local: 'accounts', remote: 'blubba_accounts', cols: ['id', 'name', 'name_lower', 'pass', 'recovery', 'created_at', 'flagged'], pk: ['id'] },
  { local: 'sessions', remote: 'blubba_sessions', cols: ['token_hash', 'account_id', 'expires_at'], pk: ['token_hash'] },
  { local: 'profiles', remote: 'blubba_profiles', cols: ['key', 'data', 'updated_at'], pk: ['key'] },
  { local: 'reports', remote: 'blubba_reports', cols: ['id', 'at', 'reporter', 'target', 'target_name', 'room', 'reason'], pk: ['id'] },
  { local: 'faces', remote: 'blubba_faces', cols: ['account_id', 'mime', 'data', 'updated_at', 'hidden', 'reports', 'banned'], pk: ['account_id'] },
  { local: 'face_reports', remote: 'blubba_face_reports', cols: ['account_id', 'reporter', 'at'], pk: ['account_id', 'reporter'] },
  { local: 'decals', remote: 'blubba_decals', cols: ['account_id', 'mime', 'data', 'updated_at', 'hidden', 'reports', 'banned'], pk: ['account_id'] },
  { local: 'decal_reports', remote: 'blubba_decal_reports', cols: ['account_id', 'reporter', 'at'], pk: ['account_id', 'reporter'] },
  { local: 'friends', remote: 'blubba_friends', cols: ['a', 'b', 'status', 'requested_by', 'at'], pk: ['a', 'b'] },
  { local: 'daily_active', remote: 'blubba_daily_active', cols: ['day', 'key'], pk: ['day', 'key'] },
  { local: 'character_faces', remote: 'blubba_character_faces', cols: ['account_id', 'char_key', 'approved', 'at'], pk: ['account_id'] },
];

/**
 * Keeps a Postgres copy of everything the SQLite store saves, for hosts whose disk is wiped on
 * every restart (Render's free plan, for one). SQLite stays the working copy, so the game code
 * stays synchronous and fast: at startup the mirror loads Postgres into SQLite, and afterwards
 * every change is queued and written to Postgres in the background (in order, in batches, retried
 * until it lands). Postgres is the source of truth; one server instance writes to it.
 */
export class Mirror {
  private queue: Op[] = [];
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private retryAt = 0;
  /** Changes written to Postgres so far, and the last error (for the health check). */
  written = 0;
  lastError = '';

  constructor(
    private readonly pg: SqlClient,
    private readonly db: DatabaseSync,
  ) {}

  /**
   * Creates the tables if needed, then makes SQLite match Postgres. If Postgres is empty but the
   * local database isn't (moving an existing server over), the local data is uploaded instead.
   */
  async load(): Promise<{ accounts: number; profiles: number; uploaded: boolean }> {
    await this.pg.query(SCHEMA);
    const count = async (t: string) => Number((await this.pg.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n);
    const remote = (await count('blubba_accounts')) + (await count('blubba_profiles'));
    const localRows = (t: string) => Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
    if (remote === 0 && localRows('accounts') + localRows('profiles') > 0) {
      await this.upload();
      return { accounts: localRows('accounts'), profiles: localRows('profiles'), uploaded: true };
    }
    const data = new Map<string, Record<string, unknown>[]>();
    for (const t of TABLES) data.set(t.local, (await this.pg.query(`SELECT ${t.cols.join(', ')} FROM ${t.remote}`)).rows);
    this.db.exec('BEGIN');
    try {
      for (const t of TABLES) {
        this.db.exec(`DELETE FROM ${t.local}`);
        const ins = this.db.prepare(`INSERT INTO ${t.local} (${t.cols.join(', ')}) VALUES (${t.cols.map(() => '?').join(', ')})`);
        for (const row of data.get(t.local)!) ins.run(...t.cols.map((c) => toSqlite(row[c])));
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { accounts: data.get('accounts')!.length, profiles: data.get('profiles')!.length, uploaded: false };
  }

  private async upload(): Promise<void> {
    await this.pg.query('BEGIN');
    try {
      for (const t of TABLES) {
        const rows = this.db.prepare(`SELECT ${t.cols.join(', ')} FROM ${t.local}`).all() as Record<string, unknown>[];
        for (const row of rows) {
          await this.pg.query(
            `INSERT INTO ${t.remote} (${t.cols.join(', ')}) VALUES (${t.cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`,
            t.cols.map((c) => toPg(row[c])),
          );
        }
      }
      await this.pg.query('COMMIT');
    } catch (e) {
      await this.pg.query('ROLLBACK').catch(() => {});
      throw e;
    }
  }

  /** Starts writing queued changes every `ms`. */
  start(ms = 1000): void {
    this.timer ??= setInterval(() => void this.flush(), ms);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get pending(): number {
    return this.queue.length;
  }

  // --- Changes (called by the store right after it writes SQLite) ------------------------------

  account(id: number): void {
    this.push({ k: 'account', id });
  }

  session(hash: string): void {
    this.push({ k: 'session', hash });
  }

  deleteSession(hash: string): void {
    this.push({ k: 'delSession', hash });
  }

  deleteSessionsOf(accountId: number): void {
    this.push({ k: 'delSessionsOf', accountId });
  }

  /** A profile changed; the latest saved version is read when the write happens. */
  profile(key: string): void {
    const i = this.queue.findIndex((o) => o.k === 'profile' && o.key === key);
    if (i >= 0) this.queue.splice(i, 1);
    this.push({ k: 'profile', key });
  }

  deleteProfile(key: string): void {
    this.push({ k: 'delProfile', key });
  }

  report(id: number): void {
    this.push({ k: 'report', id });
  }

  prune(sessionsBefore: number, guestsBefore: number): void {
    this.push({ k: 'prune', sessionsBefore, guestsBefore });
  }

  /** A row changed in one of the simpler tables (faces, face reports). */
  row(table: string, key: Record<string, string | number>): void {
    const i = this.queue.findIndex((o) => o.k === 'upsert' && o.table === table && sameKey(o.key, key));
    if (i >= 0) this.queue.splice(i, 1);
    this.push({ k: 'upsert', table, key });
  }

  /** Rows were deleted (every row matching `key`, which may be part of the primary key). */
  deleteRows(table: string, key: Record<string, string | number>): void {
    this.push({ k: 'delete', table, key });
  }

  /** Rows whose `col` is before `value` were deleted (one of the TABLES' columns). */
  deleteBefore(table: string, col: string, value: string): void {
    this.push({ k: 'deleteBefore', table, col, value });
  }

  private push(op: Op): void {
    this.queue.push(op);
  }

  // --- Writing ---------------------------------------------------------------------------------

  /** Writes everything queued so far (one transaction). Safe to call any time; calls don't overlap. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.queue.length === 0 || Date.now() < this.retryAt) return Promise.resolve();
    this.flushing = this.writeBatch().finally(() => (this.flushing = null));
    return this.flushing;
  }

  /** Keeps flushing until the queue is empty or `ms` runs out (for shutdown). */
  async drain(ms = 8000): Promise<boolean> {
    const until = Date.now() + ms;
    this.retryAt = 0;
    while (this.queue.length > 0 && Date.now() < until) {
      await this.flush();
      if (this.queue.length > 0) await new Promise((r) => setTimeout(r, Math.min(500, Math.max(0, until - Date.now()))));
      this.retryAt = 0;
    }
    return this.queue.length === 0;
  }

  private async writeBatch(): Promise<void> {
    const batch = this.queue.slice(0, 200);
    try {
      await this.pg.query('BEGIN');
      for (const op of batch) await this.apply(op);
      await this.pg.query('COMMIT');
      this.queue.splice(0, batch.length);
      this.written += batch.length;
      if (this.failures > 0) console.log(`[blubba] database writes recovered after ${this.failures} failed attempt(s)`);
      this.failures = 0;
      this.lastError = '';
    } catch (e) {
      await this.pg.query('ROLLBACK').catch(() => {});
      this.failures++;
      this.lastError = e instanceof Error ? e.message : String(e);
      this.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(5, this.failures));
      if (this.failures === 1 || this.failures % 10 === 0) console.error(`[blubba] database write failed (${this.queue.length} change(s) waiting, will retry): ${this.lastError}`);
    }
  }

  private async apply(op: Op): Promise<void> {
    const q = (sql: string, params: unknown[]) => this.pg.query(sql, params.map(toPg));
    switch (op.k) {
      case 'account': {
        const r = this.db.prepare('SELECT id, name, name_lower, pass, recovery, created_at, flagged FROM accounts WHERE id = ?').get(op.id) as Record<string, unknown> | undefined;
        if (!r) return;
        await q(
          `INSERT INTO blubba_accounts (id, name, name_lower, pass, recovery, created_at, flagged) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, name_lower = excluded.name_lower, pass = excluded.pass, recovery = excluded.recovery, flagged = excluded.flagged`,
          [r.id, r.name, r.name_lower, r.pass, r.recovery, r.created_at, r.flagged],
        );
        return;
      }
      case 'session': {
        const r = this.db.prepare('SELECT token_hash, account_id, expires_at FROM sessions WHERE token_hash = ?').get(op.hash) as Record<string, unknown> | undefined;
        if (!r) return;
        await q('INSERT INTO blubba_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (token_hash) DO UPDATE SET expires_at = excluded.expires_at', [
          r.token_hash,
          r.account_id,
          r.expires_at,
        ]);
        return;
      }
      case 'delSession':
        await q('DELETE FROM blubba_sessions WHERE token_hash = $1', [op.hash]);
        return;
      case 'delSessionsOf':
        await q('DELETE FROM blubba_sessions WHERE account_id = $1', [op.accountId]);
        return;
      case 'profile': {
        const r = this.db.prepare('SELECT key, data, updated_at FROM profiles WHERE key = ?').get(op.key) as Record<string, unknown> | undefined;
        if (!r) return;
        await q('INSERT INTO blubba_profiles (key, data, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', [
          r.key,
          r.data,
          r.updated_at,
        ]);
        return;
      }
      case 'delProfile':
        await q('DELETE FROM blubba_profiles WHERE key = $1', [op.key]);
        return;
      case 'report': {
        const r = this.db.prepare('SELECT id, at, reporter, target, target_name, room, reason FROM reports WHERE id = ?').get(op.id) as Record<string, unknown> | undefined;
        if (!r) return;
        await q('INSERT INTO blubba_reports (id, at, reporter, target, target_name, room, reason) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING', [
          r.id,
          r.at,
          r.reporter,
          r.target,
          r.target_name,
          r.room,
          r.reason,
        ]);
        return;
      }
      case 'prune':
        await q('DELETE FROM blubba_sessions WHERE expires_at < $1', [op.sessionsBefore]);
        await q("DELETE FROM blubba_profiles WHERE key LIKE 'g:%' AND updated_at < $1", [op.guestsBefore]);
        return;
      case 'upsert': {
        const t = TABLES.find((x) => x.local === op.table)!;
        const keys = Object.keys(op.key);
        const r = this.db.prepare(`SELECT ${t.cols.join(', ')} FROM ${t.local} WHERE ${keys.map((c) => `${c} = ?`).join(' AND ')}`).get(...keys.map((c) => op.key[c])) as
          | Record<string, unknown>
          | undefined;
        if (!r) return;
        const rest = t.cols.filter((c) => !t.pk.includes(c));
        await q(
          `INSERT INTO ${t.remote} (${t.cols.join(', ')}) VALUES (${t.cols.map((_, i) => `$${i + 1}`).join(', ')})
           ON CONFLICT (${t.pk.join(', ')}) DO ${rest.length ? `UPDATE SET ${rest.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'NOTHING'}`,
          t.cols.map((c) => r[c]),
        );
        return;
      }
      case 'delete': {
        const t = TABLES.find((x) => x.local === op.table)!;
        const keys = Object.keys(op.key);
        await q(`DELETE FROM ${t.remote} WHERE ${keys.map((c, i) => `${c} = $${i + 1}`).join(' AND ')}`, keys.map((c) => op.key[c]));
        return;
      }
      case 'deleteBefore': {
        const t = TABLES.find((x) => x.local === op.table)!;
        if (!t.cols.includes(op.col)) return;
        await q(`DELETE FROM ${t.remote} WHERE ${op.col} < $1`, [op.value]);
        return;
      }
    }
  }
}

function sameKey(a: Record<string, string | number>, b: Record<string, string | number>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** Postgres BIGINTs arrive as strings; SQLite wants numbers. */
function toSqlite(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'bigint') return Number(v);
  return String(v);
}

function toPg(v: unknown): unknown {
  return typeof v === 'bigint' ? Number(v) : v;
}
