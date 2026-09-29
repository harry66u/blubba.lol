import { type Cosmetics, DEFAULT_COSMETICS, type ProfileView, emptyStats, unlockedAt } from '../../shared/economy';

const TOKEN_KEY = 'bubba.token.v1';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface LeaderboardRow {
  name: string;
  rating: number;
  games: number;
  level: number;
}

export interface FaceStatus {
  version: number | null;
  hidden: boolean;
  banned: boolean;
}

/**
 * The player's account (optional) and saved progress. Guests are identified by their browser's
 * guest id; accounts by a session token. The server is the source of truth for everything here.
 */
export class AccountClient {
  token: string | null = storage()?.getItem(TOKEN_KEY) ?? null;
  account: { name: string; id?: number } | null = null;
  /** Your face scan: its version (null = none), and whether reports or a moderator hid it. */
  face: FaceStatus | null = null;
  profile: ProfileView = AccountClient.blankProfile();
  /** False until the first /api/me answer (the menu shows placeholders until then). */
  loaded = false;
  /** When `profile` arrived (Date.now()), so countdowns like `daily.resetsIn` stay right later. */
  profileAt = Date.now();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly guestId: string) {}

  static blankProfile(): ProfileView {
    return { name: null, isAccount: false, level: 1, xp: 0, xpInto: 0, xpNext: 100, coins: 0, owned: [], cosmetics: { ...DEFAULT_COSMETICS }, stats: emptyStats(), rating: null, rankedGames: 0, daily: { challenges: [], streak: 0, playedToday: false, resetsIn: 0 } };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** What's locked in the loadout screen at the current level. */
  get locked(): { mods: string[]; utils: string[] } {
    const u = unlockedAt(this.profile.level);
    return {
      mods: ['wideNozzle', 'bigTank', 'chargeValve', 'quickValve', 'longBarrel'].filter((m) => !u.mods.includes(m as never)),
      utils: ['bouncePad', 'airGrenade', 'inflatableWall', 'vacuumGrenade'].filter((x) => !u.utils.includes(x as never)),
    };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', 'x-guest-id': this.guestId };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, body === undefined ? { headers: this.headers() } : { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    } catch {
      throw new Error("Can't reach the server. Check your connection.");
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!res.ok) {
      const err = new Error(data.message ?? 'Something went wrong.') as Error & { code?: string };
      err.code = data.error;
      throw err;
    }
    return data;
  }

  private setToken(token: string | null): void {
    this.token = token;
    try {
      if (token) storage()?.setItem(TOKEN_KEY, token);
      else storage()?.removeItem(TOKEN_KEY);
    } catch {
      // Not persisted; the player just logs in again next time.
    }
  }

  private apply(r: { account?: { name: string } | null; profile?: ProfileView | null }): void {
    if (r.account !== undefined) this.account = r.account;
    if (r.profile) {
      this.profile = r.profile;
      this.profileAt = Date.now();
    }
    this.loaded = true;
    this.emit();
  }

  async refresh(): Promise<void> {
    const r = await this.call<{ account: { name: string; id: number } | null; profile: ProfileView | null; face: FaceStatus | null }>('/api/me');
    this.face = r.face ?? null;
    // A stale token (expired or reset elsewhere): quietly fall back to guest.
    if (this.token && !r.account) this.setToken(null);
    this.apply({ account: r.account, profile: r.profile ?? AccountClient.blankProfile() });
  }

  async register(name: string, password: string): Promise<string> {
    const r = await this.call<{ token: string; recoveryCode: string; account: { name: string }; profile: ProfileView }>('/api/account/register', { name, password, guestId: this.guestId });
    this.setToken(r.token);
    this.apply(r);
    void this.refresh().catch(() => undefined);
    return r.recoveryCode;
  }

  async login(name: string, password: string): Promise<void> {
    const r = await this.call<{ token: string; account: { name: string }; profile: ProfileView }>('/api/account/login', { name, password });
    this.setToken(r.token);
    this.apply(r);
    // Picks up the account id and face scan.
    void this.refresh().catch(() => undefined);
  }

  async reset(name: string, recoveryCode: string, password: string): Promise<string> {
    const r = await this.call<{ token: string; recoveryCode: string; account: { name: string }; profile: ProfileView }>('/api/account/reset', { name, recoveryCode, password });
    this.setToken(r.token);
    this.apply(r);
    return r.recoveryCode;
  }

  async logout(): Promise<void> {
    await this.call('/api/account/logout', {}).catch(() => undefined);
    this.setToken(null);
    this.account = null;
    this.face = null;
    await this.refresh().catch(() => this.apply({ account: null, profile: AccountClient.blankProfile() }));
  }

  /** Saves a face scan (a small square image as a data URL) on your own account. */
  async uploadFace(image: string): Promise<void> {
    const r = await this.call<{ face: FaceStatus }>('/api/face', { image, mine: true });
    this.face = r.face;
    this.emit();
  }

  async removeFace(): Promise<void> {
    const r = await this.call<{ face: FaceStatus }>('/api/face/remove', {});
    this.face = r.face;
    this.emit();
  }

  async buy(itemId: string): Promise<void> {
    const r = await this.call<{ profile: ProfileView }>('/api/store/buy', { itemId });
    this.apply(r);
  }

  async equip(cosmetics: Partial<Cosmetics>): Promise<void> {
    // Show it right away; the server's answer is the final word.
    this.profile = { ...this.profile, cosmetics: { ...this.profile.cosmetics, ...cosmetics } };
    this.emit();
    const r = await this.call<{ profile: ProfileView }>('/api/cosmetics', { cosmetics: this.profile.cosmetics });
    this.apply(r);
  }

  /** After a match the server sends the updated profile along with the rewards. */
  setProfile(p: ProfileView): void {
    this.apply({ profile: p });
  }

  async leaderboard(): Promise<LeaderboardRow[]> {
    return (await this.call<{ players: LeaderboardRow[] }>('/api/leaderboard')).players;
  }
}
