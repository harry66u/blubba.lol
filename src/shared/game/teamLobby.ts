import { BALANCE } from '../balance';

/** Someone in a Team Knockout lobby. */
export interface LobbySeat {
  id: number;
  team: number;
  bot: boolean;
  /** A bot's twin (same skill and loadout): shuffles keep the two on opposite teams. */
  twin?: number;
}

export interface LobbyCheck {
  /** Teams are even (at most one apart) and both sides have enough players. */
  teamsOk: boolean;
  /** Teams are fine and every human is ready: count down and go. */
  ok: boolean;
  counts: [number, number];
  /** What it's waiting for, in a few words ('' when ok). */
  waiting: string;
}

/** Most players a side can take (half the room). */
export const MAX_PER_SIDE = Math.ceil(BALANCE.match.maxPlayers / 2);

/** Whether a Team Knockout lobby can start, and if not, what it's waiting for. */
export function checkTeamLobby(seats: LobbySeat[], ready: ReadonlySet<number>, minPerSide = BALANCE.modes.teamKnockout.minPerSide): LobbyCheck {
  const counts: [number, number] = [0, 0];
  for (const s of seats) if (s.team === 0 || s.team === 1) counts[s.team]++;
  const short = Math.max(0, minPerSide - counts[0]) + Math.max(0, minPerSide - counts[1]);
  const gap = Math.abs(counts[0] - counts[1]);
  const notReady = seats.filter((s) => !s.bot && !ready.has(s.id)).length;
  let waiting = '';
  if (short > 0) waiting = `Need ${minPerSide} per team: ${short} more player${short === 1 ? '' : 's'}`;
  else if (gap > 1) waiting = `Teams are uneven (${counts[0]} v ${counts[1]})`;
  else if (notReady > 0) waiting = `Waiting for ${notReady} to ready up`;
  const teamsOk = short === 0 && gap <= 1;
  return { teamsOk, ok: teamsOk && notReady === 0, counts, waiting };
}

/**
 * New even teams: everyone shuffled, then dealt alternately (humans first so both sides get a
 * fair share of real players, then bots to even the numbers). Twin bots go one to each side.
 */
export function shuffleTeams(seats: LobbySeat[], rng: () => number = Math.random): Map<number, 0 | 1> {
  const mix = <T>(xs: T[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const out = new Map<number, 0 | 1>();
  const first: 0 | 1 = rng() < 0.5 ? 0 : 1;
  const counts = [0, 0];
  const deal = (id: number) => {
    const team: 0 | 1 = counts[0] === counts[1] ? first : counts[0] < counts[1] ? 0 : 1;
    out.set(id, team);
    counts[team]++;
  };
  for (const s of mix(seats.filter((x) => !x.bot))) deal(s.id);
  const bots = seats.filter((x) => x.bot);
  const ids = new Set(bots.map((b) => b.id));
  const paired = new Set<number>();
  const singles: LobbySeat[] = [];
  for (const b of mix(bots)) {
    if (paired.has(b.id)) continue;
    if (b.twin !== undefined && ids.has(b.twin) && !paired.has(b.twin)) {
      // One twin each side keeps the bots even, whatever the humans are.
      const t: 0 | 1 = rng() < 0.5 ? 0 : 1;
      out.set(b.id, t);
      out.set(b.twin, t === 0 ? 1 : 0);
      counts[0]++;
      counts[1]++;
      paired.add(b.id);
      paired.add(b.twin);
    } else singles.push(b);
  }
  for (const s of singles) deal(s.id);
  return out;
}
