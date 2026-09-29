import type { IncomingMessage, ServerResponse } from 'node:http';
import { ITEM_BY_ID, type ProfileView, levelForXp, sanitizeCosmetics } from '../shared/economy';
import { checkName } from '../shared/names';
import { type Account, type Store, accountKey, guestKey, validGuestId } from './store';

const MAX_BODY = 4096;

/** Tiny per-IP token bucket for the login/register endpoints. */
class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private readonly capacity: number,
    private readonly perSec: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.perSec);
    b.at = now;
    this.buckets.set(key, b);
    if (this.buckets.size > 10000) this.buckets.clear();
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function checkPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8) throw new ApiError(400, 'weak_password', 'Passwords need at least 8 characters.');
  if (pw.length > 128) throw new ApiError(400, 'weak_password', 'That password is too long.');
  return pw;
}

/** Who is asking: an account (Bearer token) or a guest (X-Guest-Id header). */
export interface Caller {
  account: Account | null;
  guestId: string | null;
  key: string | null;
}

/** Account, profile, store and leaderboard endpoints under /api/. All JSON. */
export class Api {
  private readonly authLimiter = new RateLimiter(10, 10 / 60);
  private readonly writeLimiter = new RateLimiter(30, 1);
  private readonly logLimiter = new RateLimiter(10, 10 / 60);
  /** Lets the lobby hear about purchases/equips so in-match players update right away. */
  onProfileChange: ((key: string) => void) | null = null;

  constructor(private readonly store: Store) {}

  caller(req: IncomingMessage): Caller {
    const auth = String(req.headers.authorization ?? '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const account = token ? this.store.sessionAccount(token) : null;
    const gid = req.headers['x-guest-id'];
    const guestId = validGuestId(gid) ? gid : null;
    return { account, guestId, key: account ? accountKey(account.id) : guestId ? guestKey(guestId) : null };
  }

  view(c: Caller): ProfileView | null {
    if (!c.key) return null;
    return this.store.view(c.key, c.account?.name ?? null, !!c.account);
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const send = (status: number, body: unknown) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    };
    try {
      const out = await this.route(req, path);
      send(200, out);
    } catch (err) {
      if (err instanceof ApiError) send(err.status, { error: err.code, message: err.message });
      else {
        console.error('[api]', err);
        send(500, { error: 'server', message: 'Something went wrong. Try again.' });
      }
    }
  }

  private ip(req: IncomingMessage): string {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    return fwd || req.socket.remoteAddress || '?';
  }

  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (req.method !== 'POST') throw new ApiError(405, 'method', 'Use POST.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new ApiError(413, 'too_big', 'Request too large.');
      chunks.push(c as Buffer);
    }
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!v || typeof v !== 'object') throw new Error();
      return v as Record<string, unknown>;
    } catch {
      throw new ApiError(400, 'bad_json', 'Bad request.');
    }
  }

  private async route(req: IncomingMessage, path: string): Promise<unknown> {
    const ip = this.ip(req);
    switch (path) {
      case '/api/me': {
        const c = this.caller(req);
        return { account: c.account ? { name: c.account.name } : null, profile: this.view(c) };
      }
      case '/api/account/register': {
        const b = await this.body(req);
        if (!this.authLimiter.take(ip)) throw new ApiError(429, 'slow_down', 'Too many tries. Wait a minute.');
        const check = checkName(String(b.name ?? ''));
        if (!check.ok) throw new ApiError(400, 'bad_name', check.reason ?? 'Pick another name.');
        const password = checkPassword(b.password);
        const made = await this.store.createAccount(check.name, password);
        if (!made) throw new ApiError(409, 'name_taken', 'That name is taken. Try another one.');
        if (validGuestId(b.guestId)) this.store.adoptGuestProfile(b.guestId, made.account.id);
        const token = this.store.createSession(made.account.id);
        const key = accountKey(made.account.id);
        this.store.saveProfile(key);
        return { token, recoveryCode: made.recoveryCode, account: { name: made.account.name }, profile: this.store.view(key, made.account.name, true) };
      }
      case '/api/account/login': {
        const b = await this.body(req);
        if (!this.authLimiter.take(ip)) throw new ApiError(429, 'slow_down', 'Too many tries. Wait a minute.');
        const acc = await this.store.login(String(b.name ?? '').trim(), String(b.password ?? ''));
        if (!acc) throw new ApiError(401, 'bad_login', "That name and password don't match.");
        const token = this.store.createSession(acc.id);
        return { token, account: { name: acc.name }, profile: this.store.view(accountKey(acc.id), acc.name, true) };
      }
      case '/api/account/reset': {
        const b = await this.body(req);
        if (!this.authLimiter.take(ip)) throw new ApiError(429, 'slow_down', 'Too many tries. Wait a minute.');
        const password = checkPassword(b.password);
        const done = await this.store.resetPassword(String(b.name ?? '').trim(), String(b.recoveryCode ?? ''), password);
        if (!done) throw new ApiError(401, 'bad_recovery', "That name and recovery code don't match.");
        const token = this.store.createSession(done.account.id);
        return { token, recoveryCode: done.recoveryCode, account: { name: done.account.name }, profile: this.store.view(accountKey(done.account.id), done.account.name, true) };
      }
      case '/api/account/logout': {
        await this.body(req);
        const auth = String(req.headers.authorization ?? '');
        if (auth.startsWith('Bearer ')) this.store.deleteSession(auth.slice(7).trim());
        return { ok: true };
      }
      case '/api/store/buy': {
        const b = await this.body(req);
        if (!this.writeLimiter.take(ip)) throw new ApiError(429, 'slow_down', 'Slow down a little.');
        const c = this.caller(req);
        if (!c.account || !c.key) throw new ApiError(401, 'account_required', 'Make a free account to buy things. Your progress comes with you.');
        const item = ITEM_BY_ID.get(String(b.itemId ?? ''));
        if (!item) throw new ApiError(404, 'no_item', "That item doesn't exist.");
        const p = this.store.profile(c.key);
        if (item.price === 0 || p.owned.includes(item.id)) throw new ApiError(409, 'owned', 'You already have that.');
        if (p.coins < item.price) throw new ApiError(402, 'coins', `You need ${item.price - p.coins} more coins.`);
        p.coins -= item.price;
        p.owned.push(item.id);
        // Wear it straight away; that's almost always what people want.
        p.cosmetics = sanitizeCosmetics({ ...p.cosmetics, [item.slot]: item.id }, p.owned);
        this.store.saveProfile(c.key);
        this.onProfileChange?.(c.key);
        return { profile: this.view(c) };
      }
      case '/api/cosmetics': {
        const b = await this.body(req);
        if (!this.writeLimiter.take(ip)) throw new ApiError(429, 'slow_down', 'Slow down a little.');
        const c = this.caller(req);
        if (!c.key) throw new ApiError(400, 'no_player', 'Refresh the page and try again.');
        const p = this.store.profile(c.key);
        p.cosmetics = sanitizeCosmetics(b.cosmetics, p.owned);
        this.store.saveProfile(c.key);
        this.onProfileChange?.(c.key);
        return { profile: this.view(c) };
      }
      case '/api/leaderboard':
        return { players: this.store.leaderboard(20) };
      case '/api/clientlog': {
        // Errors from players' browsers, so they show up in the server log.
        const b = await this.body(req);
        if (!this.logLimiter.take(ip)) return { ok: false };
        const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n);
        console.warn(`[client] ${clean(b.message, 300)} | ${clean(b.page, 60)} | ${clean(b.ua, 160)}${b.stack ? `\n  ${clean(b.stack, 1200).replace(/ {2,}at /g, '\n  at ')}` : ''}`);
        return { ok: true };
      }
      case '/api/debug/grant': {
        // Test helper (only with BUBBA_DEBUG=1): add coins/XP to yourself.
        if (process.env.BUBBA_DEBUG !== '1') throw new ApiError(404, 'not_found', 'Not found.');
        const b = await this.body(req);
        const c = this.caller(req);
        if (!c.key) throw new ApiError(400, 'no_player', 'No player.');
        const p = this.store.profile(c.key);
        p.coins += Math.max(0, Math.min(100000, Number(b.coins) || 0));
        p.xp += Math.max(0, Math.min(100000, Number(b.xp) || 0));
        this.store.saveProfile(c.key);
        return { profile: this.view(c) };
      }
      default: {
        const m = path.match(/^\/api\/profile\/([A-Za-z0-9 _-]{3,16})$/);
        if (m) {
          const acc = this.store.accountByName(decodeURIComponent(m[1]));
          if (!acc) throw new ApiError(404, 'no_player', 'No account with that name.');
          const p = this.store.profile(accountKey(acc.id));
          return { name: acc.name, level: levelForXp(p.xp).level, rating: p.rankedGames ? p.rating : null, rankedGames: p.rankedGames, stats: p.stats };
        }
        throw new ApiError(404, 'not_found', 'Not found.');
      }
    }
  }
}
