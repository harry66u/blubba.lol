import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ITEM_BY_ID, type ProfileView, levelForXp, sanitizeCosmetics } from '../shared/economy';
import { checkName } from '../shared/names';
import { type Account, type Store, accountKey, guestKey, validGuestId } from './store';

const MAX_BODY = 4096;
/** Face scans are small square photos (the client sends about 160 px, well under this). */
const MAX_FACE_BYTES = 160 * 1024;
const FACE_MIMES: Record<string, (b: Buffer) => boolean> = {
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

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

/** Characters whose real person can lend them their face scan (see Store.claimCharacter). */
const CHARACTER_KEYS = ['bor', 'abag', 'sol', 'kesty'];

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

  /** True when the request carries the admin token (set BUBBA_ADMIN_TOKEN, 12+ characters). */
  private isAdmin(req: IncomingMessage): boolean {
    const want = process.env.BUBBA_ADMIN_TOKEN ?? '';
    const got = String(req.headers['x-admin-token'] ?? '');
    if (want.length < 12 || got.length !== want.length) return false;
    return timingSafeEqual(Buffer.from(got), Buffer.from(want));
  }

  /** Face images are served as images, not JSON. Returns false if the path isn't one. */
  private serveFace(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    const m = path.match(/^\/api\/(admin\/)?face\/(\d{1,12})$/);
    if (!m || req.method !== 'GET') return false;
    const admin = !!m[1];
    const face = admin && !this.isAdmin(req) ? null : this.store.face(Number(m[2]), admin);
    if (!face) {
      res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('No face');
      return true;
    }
    res.writeHead(200, {
      'content-type': face.mime,
      'content-length': face.data.length,
      // Links carry ?v=<version>, so a new scan is a new URL.
      'cache-control': admin ? 'no-store' : 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    });
    res.end(face.data);
    return true;
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (this.serveFace(req, res, path)) return;
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

  private async body(req: IncomingMessage, max = MAX_BODY): Promise<Record<string, unknown>> {
    if (req.method !== 'POST') throw new ApiError(405, 'method', 'Use POST.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > max) throw new ApiError(413, 'too_big', 'Request too large.');
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
        if (c.key) this.store.markActive(c.key);
        return {
          active: this.store.activeToday(),
          account: c.account ? { name: c.account.name, id: c.account.id } : null,
          profile: this.view(c),
          face: c.account ? this.store.faceStatus(c.account.id) : null,
          character: c.account ? this.store.characterClaim(c.account.id) : null,
        };
      }
      case '/api/face': {
        // Upload your own face scan (accounts only; it goes on your own tube man).
        const b = await this.body(req, MAX_FACE_BYTES * 1.4 + 1024);
        if (!this.writeLimiter.take(ip)) throw new ApiError(429, 'slow_down', 'Slow down a little.');
        const c = this.caller(req);
        if (!c.account || !c.key) throw new ApiError(401, 'account_required', 'Make a free account to use a face scan.');
        if (b.mine !== true) throw new ApiError(400, 'not_mine', 'Only use a photo of your own face.');
        const m = String(b.image ?? '').match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!m) throw new ApiError(400, 'bad_image', "That picture didn't work. Try another one.");
        const bytes = Buffer.from(m[2], 'base64');
        if (bytes.length > MAX_FACE_BYTES || bytes.length < 200 || !FACE_MIMES[m[1]](bytes)) throw new ApiError(400, 'bad_image', "That picture didn't work. Try another one.");
        if (!this.store.setFace(c.account.id, m[1], bytes.toString('base64'))) throw new ApiError(403, 'face_banned', "Face scans are turned off for your account.");
        this.onProfileChange?.(c.key);
        return { face: this.store.faceStatus(c.account.id) };
      }
      case '/api/face/remove': {
        await this.body(req);
        const c = this.caller(req);
        if (!c.account || !c.key) throw new ApiError(401, 'account_required', 'Log in first.');
        const st = this.store.faceStatus(c.account.id);
        // A banned account keeps its (empty) ban row.
        if (!st.banned) this.store.removeFace(c.account.id);
        this.onProfileChange?.(c.key);
        return { face: this.store.faceStatus(c.account.id) };
      }
      case '/api/face/character': {
        // "I'm the real BOR": lend your own face scan to your character (an admin approves it).
        const b = await this.body(req);
        if (!this.writeLimiter.take(ip)) throw new ApiError(429, 'slow_down', 'Slow down a little.');
        const c = this.caller(req);
        if (!c.account) throw new ApiError(401, 'account_required', 'Log in first.');
        const ch = String(b.character ?? '');
        if (ch && !CHARACTER_KEYS.includes(ch)) throw new ApiError(400, 'bad_character', 'Pick BOR, ABAG, SOL or KESTY.');
        const st = this.store.faceStatus(c.account.id);
        if (ch && (!st.version || st.banned)) throw new ApiError(400, 'no_face', 'Save a face scan first.');
        this.store.claimCharacter(c.account.id, ch || null);
        return { character: this.store.characterClaim(c.account.id) };
      }
      case '/api/characters':
        // Approved character faces, for the ult transformations.
        return { faces: this.store.characterFaces() };
      case '/api/admin/faces': {
        if (!this.isAdmin(req)) throw new ApiError(404, 'not_found', 'Not found.');
        return { faces: this.store.listFaces(), reports: this.store.reports(100), claims: this.store.listCharacterClaims() };
      }
      case '/api/admin/character': {
        const b = await this.body(req);
        if (!this.isAdmin(req)) throw new ApiError(404, 'not_found', 'Not found.');
        const id = Number(b.id);
        if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'bad_id', 'Bad id.');
        if (b.action === 'approve') this.store.approveCharacter(id);
        else if (b.action === 'remove') this.store.claimCharacter(id, null);
        else throw new ApiError(400, 'bad_action', 'Use approve or remove.');
        console.log(`[admin] character claim ${b.action} for account ${id}`);
        return { claims: this.store.listCharacterClaims() };
      }
      case '/api/admin/face': {
        const b = await this.body(req);
        if (!this.isAdmin(req)) throw new ApiError(404, 'not_found', 'Not found.');
        const id = Number(b.id);
        if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'bad_id', 'Bad id.');
        if (b.action === 'remove') this.store.removeFace(id);
        else if (b.action === 'ban') this.store.removeFace(id, true);
        else if (b.action === 'restore') this.store.restoreFace(id);
        else throw new ApiError(400, 'bad_action', 'Use remove, ban or restore.');
        console.log(`[admin] face ${b.action} for account ${id}`);
        this.onProfileChange?.(accountKey(id));
        return { faces: this.store.listFaces() };
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
        const level = levelForXp(p.xp).level;
        // Level rewards are earned by playing, never bought.
        if (item.levelReq) throw new ApiError(409, 'level_reward', `That one isn't for sale. Reach level ${item.levelReq} to unlock it.`);
        if (item.price === 0 || p.owned.includes(item.id)) throw new ApiError(409, 'owned', 'You already have that.');
        if (p.coins < item.price) throw new ApiError(402, 'coins', `You need ${item.price - p.coins} more coins.`);
        p.coins -= item.price;
        p.owned.push(item.id);
        // Wear it straight away; that's almost always what people want.
        p.cosmetics = sanitizeCosmetics({ ...p.cosmetics, [item.slot]: item.id }, p.owned, level);
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
        p.cosmetics = sanitizeCosmetics(b.cosmetics, p.owned, levelForXp(p.xp).level);
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
