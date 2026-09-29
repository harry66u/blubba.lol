/** How a color's surface looks: glossy vinyl (the default), metal foil, a pearly shimmer, or a glow. */
export type ColorShine = 'metal' | 'pearl' | 'glow';

/**
 * Bright candy colors for players; maps use calmer tones so players always pop. Indexes are the
 * color (and accent) item keys, so new colors only ever go on the end.
 */
export const PLAYER_COLORS: { name: string; hex: number; shine?: ColorShine }[] = [
  { name: 'Cherry', hex: 0xff3b5c },
  { name: 'Tangerine', hex: 0xff8a1f },
  { name: 'Banana', hex: 0xffd60a },
  { name: 'Lime', hex: 0x8ee000 },
  { name: 'Mint', hex: 0x1fe0a0 },
  { name: 'Sky', hex: 0x2ec5ff },
  { name: 'Blueberry', hex: 0x3d6bff },
  { name: 'Grape', hex: 0x9b4dff },
  { name: 'Bubblegum', hex: 0xff5fd2 },
  { name: 'Coral', hex: 0xff6f61 },
  { name: 'Snow', hex: 0xf4f7ff },
  { name: 'Licorice', hex: 0x3a3a48 },
  { name: 'Lavender', hex: 0xc9a8ff },
  { name: 'Cocoa', hex: 0x8b5a3c },
  { name: 'Gold Foil', hex: 0xffc933, shine: 'metal' },
  { name: 'Silver', hex: 0xd8e0ee, shine: 'metal' },
  { name: 'Rose Gold', hex: 0xf5a48c, shine: 'metal' },
  { name: 'Pearl', hex: 0xfff0f8, shine: 'pearl' },
  { name: 'Glowstick', hex: 0x6dff3a, shine: 'glow' },
];

/** Team colors. The colorblind-safe set swaps red/blue for orange/blue with distinct patterns. */
export const TEAM_COLORS = {
  standard: [0xff3b5c, 0x2ec5ff],
  colorblind: [0xff9f1c, 0x3d6bff],
};
