/** Bright candy colors for players; maps use calmer tones so players always pop. */
export const PLAYER_COLORS: { name: string; hex: number }[] = [
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
];

/** Team colors. The colorblind-safe set swaps red/blue for orange/blue with distinct patterns. */
export const TEAM_COLORS = {
  standard: [0xff3b5c, 0x2ec5ff],
  colorblind: [0xff9f1c, 0x3d6bff],
};
