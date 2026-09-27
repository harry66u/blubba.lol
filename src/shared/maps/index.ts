import { DEALERSHIP } from './dealership';
import type { MapDef } from './types';

export const MAPS: Record<string, MapDef> = {
  [DEALERSHIP.id]: DEALERSHIP,
};

export function getMap(id: string): MapDef {
  return MAPS[id] ?? DEALERSHIP;
}
