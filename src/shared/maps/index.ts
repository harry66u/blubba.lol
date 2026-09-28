import { BALL_ARENA } from './ballArena';
import { BOUNCE_HOUSE } from './bounceHouse';
import { DEALERSHIP } from './dealership';
import { GARAGE } from './garage';
import { PIER } from './pier';
import { PUMP_ARENA } from './pumpArena';
import type { MapDef } from './types';

export const MAPS: Record<string, MapDef> = {
  [DEALERSHIP.id]: DEALERSHIP,
  [GARAGE.id]: GARAGE,
  [BOUNCE_HOUSE.id]: BOUNCE_HOUSE,
  [PIER.id]: PIER,
  [BALL_ARENA.id]: BALL_ARENA,
  [PUMP_ARENA.id]: PUMP_ARENA,
};

/** Maps for the knockout-style modes (Knockout, Team Knockout, 1v1). */
export const KNOCKOUT_MAPS = [DEALERSHIP.id, GARAGE.id, BOUNCE_HOUSE.id, PIER.id];

export function getMap(id: string): MapDef {
  return MAPS[id] ?? DEALERSHIP;
}

/** The map a mode must use (Ball and Pump have their own arenas), or null if any knockout map works. */
export function mapForMode(mode: string): string | null {
  if (mode === 'ball') return BALL_ARENA.id;
  if (mode === 'pump') return PUMP_ARENA.id;
  return null;
}
