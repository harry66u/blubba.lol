const KO_VERBS = ['popped', 'cracked', 'popped', 'cracked', 'deflated', 'bonked', 'launched'];

/**
 * How the kill feed describes a knockout ("X cracked Y"). Picked from the knockout itself, so the
 * same knockout reads the same on every screen.
 */
export function koVerb(e: { tick: number; victim: number; vx: number; vy: number; vz: number; tags: string[] }): string {
  if (e.tags.includes('pin')) return 'pinned';
  if (e.tags.includes('chain')) return 'chain-popped';
  if (Math.hypot(e.vx, e.vy, e.vz) > 34) return 'yeeted';
  const h = Math.imul((e.tick ^ (e.victim << 12)) >>> 0, 2654435761) >>> 0;
  return KO_VERBS[(h >>> 7) % KO_VERBS.length];
}

/** Your hit from at least this far (meters) that leads to a knockout is a "CRACKED SHOT". */
export const CRACKED_SHOT_DIST = 26;
