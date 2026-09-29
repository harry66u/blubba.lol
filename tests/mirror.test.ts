import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { SqlClient } from '../src/server/mirror';
import { Store, accountKey, guestKey } from '../src/server/store';

/** Records every statement; can be told to fail the next N commits. */
class FakePg implements SqlClient {
  log: string[] = [];
  failCommits = 0;
  async query(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    const s = sql.trim().split(/\s+/).slice(0, 3).join(' ');
    if (s.startsWith('COMMIT') && this.failCommits > 0) {
      this.failCommits--;
      throw new Error('connection reset');
    }
    this.log.push(params.length ? `${s} ${String(params[0])}` : s);
    return { rows: sql.includes('COUNT(*)') ? [{ n: 0 }] : [] };
  }
}

describe('database mirror', () => {
  it('queues every change and writes it in order, retrying after a failure', async () => {
    const store = new Store(':memory:');
    const fake = new FakePg();
    await store.attachMirror(fake);
    store.mirror!.stop();
    // (Attaching prunes old sessions and guests there too.)
    await store.mirror!.drain(1000);
    const made = await store.createAccount('Mirror', 'hunter22');
    const token = store.createSession(made!.account.id);
    store.profile(guestKey('guest-1234')).coins = 5;
    store.saveProfile(guestKey('guest-1234'));
    store.profile(guestKey('guest-1234')).coins = 7;
    store.saveProfile(guestKey('guest-1234'));
    store.adoptGuestProfile('guest-1234', made!.account.id);
    store.deleteSession(token);
    // Two saves of one profile collapse into one write of the latest.
    expect(store.mirror!.pending).toBe(6);
    fake.failCommits = 1;
    fake.log = [];
    await store.mirror!.flush();
    expect(store.mirror!.pending).toBe(6);
    expect(store.storageInfo().writeError).toContain('connection reset');
    fake.log = [];
    expect(await store.mirror!.drain(5000)).toBe(true);
    const writes = fake.log.filter((l) => /^(INSERT|DELETE)/.test(l));
    // Writes read the latest saved state: the session was deleted before it was ever written, so
    // only its delete goes out.
    expect(writes).toEqual([
      `INSERT INTO blubba_accounts ${made!.account.id}`,
      `INSERT INTO blubba_profiles ${accountKey(made!.account.id)}`,
      `DELETE FROM blubba_profiles ${guestKey('guest-1234')}`,
      expect.stringMatching(/^DELETE FROM blubba_sessions [0-9a-f]{64}$/),
    ]);
    expect(store.storageInfo()).toEqual({ storage: 'postgres', pendingWrites: 0 });
    store.close();
  });
});

// Round trip through a real Postgres when one is available (TEST_DATABASE_URL).
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('database mirror (real Postgres)', () => {
  const pool = url ? new pg.Pool({ connectionString: url }) : null;
  afterAll(() => pool?.end());

  it('accounts, sessions and progress survive a restart with a wiped disk', async () => {
    for (const t of ['blubba_accounts', 'blubba_sessions', 'blubba_profiles', 'blubba_reports', 'blubba_faces', 'blubba_face_reports']) await pool!.query(`DROP TABLE IF EXISTS ${t}`);
    const a = new Store(':memory:');
    await a.attachMirror(pool!);
    const made = await a.createAccount('Survivor', 'correct horse');
    const token = a.createSession(made!.account.id);
    const key = accountKey(made!.account.id);
    a.profile(key).coins = 321;
    a.saveProfile(key);
    a.addReport('g:someone', key, 'Survivor', 'ABCD', 'name');
    a.setFace(made!.account.id, 'image/png', Buffer.from('a face').toString('base64'));
    a.reportFace(made!.account.id, 'g:someone');
    await a.shutdown();

    // A fresh server with an empty local database loads everything back.
    const b = new Store(':memory:');
    const loaded = await b.attachMirror(pool!);
    expect(loaded).toMatchObject({ accounts: 1, profiles: 1, uploaded: false });
    expect(await b.login('survivor', 'correct horse')).toEqual(made!.account);
    expect(b.sessionAccount(token)).toEqual(made!.account);
    expect(b.profile(key).coins).toBe(321);
    expect(b.reports()).toHaveLength(1);
    expect(b.face(made!.account.id)?.data.toString()).toBe('a face');
    expect(b.listFaces()[0]).toMatchObject({ id: made!.account.id, reports: 1, hidden: false });
    // New accounts keep counting up from the loaded ids.
    const next = await b.createAccount('Second', 'another pass');
    expect(next!.account.id).toBeGreaterThan(made!.account.id);
    await b.shutdown();
  });

  it('moves an existing local database into an empty Postgres', async () => {
    for (const t of ['blubba_accounts', 'blubba_sessions', 'blubba_profiles', 'blubba_reports', 'blubba_faces', 'blubba_face_reports']) await pool!.query(`DROP TABLE IF EXISTS ${t}`);
    const local = new Store(':memory:');
    const made = await local.createAccount('OldTimer', 'old password');
    local.profile(accountKey(made!.account.id)).xp = 999;
    local.saveProfile(accountKey(made!.account.id));
    const r = await local.attachMirror(pool!);
    expect(r.uploaded).toBe(true);
    await local.shutdown();
    const fresh = new Store(':memory:');
    await fresh.attachMirror(pool!);
    expect(await fresh.login('OldTimer', 'old password')).toEqual(made!.account);
    expect(fresh.profile(accountKey(made!.account.id)).xp).toBe(999);
    await fresh.shutdown();
  });
});
