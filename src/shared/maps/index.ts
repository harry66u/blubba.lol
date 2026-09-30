import { BALL_ARENA } from './ballArena';
import { BOUNCE_HOUSE } from './bounceHouse';
import { CANDY } from './candy';
import { DEALERSHIP } from './dealership';
import { FACEOFF } from './faceoff';
import { GARAGE } from './garage';
import { MOON_BASE } from './moonBase';
import { PIER } from './pier';
import { PUMP_ARENA } from './pumpArena';
import { SKATEPARK } from './skatepark';
import type { MapDef } from './types';

export const MAPS: Record<string, MapDef> = {
  [DEALERSHIP.id]: DEALERSHIP,
  [GARAGE.id]: GARAGE,
  [BOUNCE_HOUSE.id]: BOUNCE_HOUSE,
  [PIER.id]: PIER,
  [CANDY.id]: CANDY,
  [SKATEPARK.id]: SKATEPARK,
  [MOON_BASE.id]: MOON_BASE,
  [BALL_ARENA.id]: BALL_ARENA,
  [PUMP_ARENA.id]: PUMP_ARENA,
  [FACEOFF.id]: FACEOFF,
};

/**
 * Maps for the knockout-style modes (Knockout, Team Knockout, Sudden Death, 1v1), in the order
 * public rooms rotate through them (and menus list them).
 */
export const KNOCKOUT_MAPS = [DEALERSHIP.id, CANDY.id, GARAGE.id, SKATEPARK.id, BOUNCE_HOUSE.id, MOON_BASE.id, PIER.id];

export function getMap(id: string): MapDef {
  return MAPS[id] ?? DEALERSHIP;
}

/** The map a mode must use (Ball and Pump have their own arenas), or null if any knockout map works. */
export function mapForMode(mode: string): string | null {
  if (mode === 'ball') return BALL_ARENA.id;
  if (mode === 'pump') return PUMP_ARENA.id;
  return null;
}

/**
 * The map made for a mode: the one public rooms always play it on and a private room switches to
 * when the host picks the mode (Ball, Pump and Team Knockout), or null for the knockout maps.
 */
export function homeMapFor(mode: string): string | null {
  return mode === 'teamKnockout' ? FACEOFF.id : mapForMode(mode);
}

/** Maps a private room's host can pick for a mode (Team Knockout also works on the knockout maps). */
export function mapsForMode(mode: string): string[] {
  const forced = mapForMode(mode);
  if (forced) return [forced];
  return mode === 'teamKnockout' ? [FACEOFF.id, ...KNOCKOUT_MAPS] : KNOCKOUT_MAPS;
}
