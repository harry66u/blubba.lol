/**
 * Blubba's icons: chunky ink outlines, candy colors and a glossy highlight, drawn in SVG (the
 * same style as the tube man mascot) so they look the same on every device instead of whatever
 * emoji font the system has. Every icon is a 48 × 48 drawing; `icon(name)` gives an element,
 * `iconHtml(name)` markup for HTML strings (the kill feed).
 */

const INK = '#1d1b3a';
const PINK = '#ff3b8a';
const YEL = '#ffd60a';
const GOLD = '#ffc21a';
const BLUE = '#2ec5ff';
const SKY = '#9fe8ff';
const GREEN = '#5ee05e';
const LIME = '#8ee000';
const PURPLE = '#8a4dff';
const LILAC = '#c9b2ff';
const ORANGE = '#ff8a1f';
const RED = '#ff3b5c';
const WHITE = '#ffffff';
const CREAM = '#fff1d6';
const GREY = '#cfd6e6';
const STEEL = '#8a93a8';
const DARK = '#3d3a66';
const TEAL = '#35e0c8';
const CORK = '#e0a860';
const SKIN = '#ffc9a0';

const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
// `extra` goes first: when an attribute is repeated, the parser keeps the first one, so an
// override such as a thinner stroke-width wins over the default in S.
const c = (cx: number, cy: number, r: number, fill: string, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra} ${S}/>`;
const e = (cx: number, cy: number, rx: number, ry: number, fill: string, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra} ${S}/>`;
const r = (x: number, y: number, w: number, h: number, rx: number, fill: string, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra} ${S}/>`;
const p = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}" ${extra} ${S}/>`;
/** A plain ink line. */
const ln = (d: string, w = 3, col = INK) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
/** A colored line with an ink outline (tubes, blades, arrows). */
const tube = (d: string, col: string, w = 4) => ln(d, w + 5) + ln(d, w, col);
/** The glossy highlight every icon gets. */
const shine = (cx: number, cy: number, rx: number, ry: number, rot = -30) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity=".65" transform="rotate(${rot} ${cx} ${cy})"/>`;
/** A small white dot (eyes, glints). */
const dot = (cx: number, cy: number, rr: number, col = INK) => `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${col}"/>`;

/** A star or burst: `n` points between the outer and inner radius. */
function star(cx: number, cy: number, ro: number, ri: number, n: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const rr = i % 2 ? ri : ro;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** A gear outline. */
function gear(cx: number, cy: number, ro: number, ri: number, teeth: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [da, rr] of [
      [-0.28, ri],
      [-0.16, ro],
      [0.16, ro],
      [0.28, ri],
    ] as const) {
      const t = a + da * step * 2;
      pts.push(`${(cx + Math.cos(t) * rr).toFixed(1)} ${(cy + Math.sin(t) * rr).toFixed(1)}`);
    }
  }
  return `M${pts.join(' L')} Z`;
}

/** Two big cartoon eyes. */
const eyes = (x1: number, x2: number, y: number, rr = 3.6) => c(x1, y, rr, WHITE, 'stroke-width="2.2"') + c(x2, y, rr, WHITE, 'stroke-width="2.2"') + dot(x1 + 0.8, y + 0.6, rr * 0.45) + dot(x2 + 0.8, y + 0.6, rr * 0.45);

const balloon = (fill: string) => p('M24 5 C34 5 40 13 40 22 C40 32 32 39 24 39 C16 39 8 32 8 22 C8 13 14 5 24 5 Z', fill) + p('M21 39 L24 44 L27 39 Z', fill) + shine(16, 15, 5, 3);
const rocket = p('M24 3 C31 9 33 19 32 29 H16 C15 19 17 9 24 3 Z', WHITE) + p('M24 3 C28 6.5 30.5 10 31.5 13 H16.5 C17.5 10 20 6.5 24 3 Z', RED) + c(24, 19, 4, SKY, 'stroke-width="2.5"') + p('M16 22 L9 33 L16 32 Z', RED) + p('M32 22 L39 33 L32 32 Z', RED) + p('M19 29 C19 35 24 45 24 45 C24 45 29 35 29 29 Z', ORANGE) + p('M22 30 C22 34 24 39 24 39 C24 39 26 34 26 30 Z', YEL, 'stroke-width="2"');
const trophy = p('M14 7 H34 V17 C34 25 29 29 24 29 C19 29 14 25 14 17 Z', YEL) + ln('M14 10 C6 10 6 21 15 21') + ln('M34 10 C42 10 42 21 33 21') + r(21, 28, 6, 6, 1, YEL) + r(13, 34, 22, 8, 3, DARK) + shine(19, 13, 3, 5, -10);
const boom = p(star(24, 24, 21, 11, 10), YEL) + p(star(24, 24, 11, 6, 8, -70), ORANGE, 'stroke-width="2.5"');
const fire = p('M24 3 C30 11 38 16 38 28 C38 37 31 44 24 44 C17 44 10 37 10 28 C10 21 13 16 17 12 C18 17 20 19 22 19 C21 13 21 8 24 3 Z', ORANGE) + p('M24 22 C28 27 31 30 31 35 C31 39 28 42 24 42 C20 42 17 39 17 35 C17 31 20 28 24 22 Z', YEL, 'stroke-width="2.5"');
const beachBall = c(24, 24, 19, WHITE) + p('M24 5 C13 13 13 35 24 43 C20 34 20 14 24 5 Z', RED, 'stroke-width="2.5"') + p('M24 5 C35 13 35 35 24 43 C28 34 28 14 24 5 Z', BLUE, 'stroke-width="2.5"') + c(24, 24, 19, 'none') + c(24, 10, 3, YEL, 'stroke-width="2"') + shine(14, 15, 4, 2.5);
const robot = ln('M24 14 V7') + c(24, 6, 3, RED, 'stroke-width="2.5"') + r(6, 19, 5, 11, 2, STEEL) + r(37, 19, 5, 11, 2, STEEL) + r(10, 13, 28, 25, 7, GREY) + c(18, 24, 4, RED, 'stroke-width="2.5"') + c(30, 24, 4, RED, 'stroke-width="2.5"') + r(17, 31, 14, 3.5, 1.7, DARK, 'stroke-width="2"') + shine(15, 17, 3.5, 2);
const speaker = p('M7 18 H15 L25 9 V39 L15 30 H7 Z', GREY);
const bubble = (cx: number, cy: number, rr: number) => c(cx, cy, rr, '#d8f6ff') + `<path d="M${cx - rr * 0.55} ${cy + rr * 0.1} A${rr * 0.6} ${rr * 0.6} 0 0 1 ${cx - rr * 0.05} ${cy - rr * 0.55}" fill="none" stroke="#fff" stroke-width="${Math.max(1.5, rr * 0.22)}" stroke-linecap="round" opacity=".9"/>` + `<path d="M${cx + rr * 0.5} ${cy + rr * 0.35} A${rr * 0.6} ${rr * 0.6} 0 0 1 ${cx + rr * 0.1} ${cy + rr * 0.6}" fill="none" stroke="#ff8fd8" stroke-width="${Math.max(1.2, rr * 0.16)}" stroke-linecap="round" opacity=".8"/>`;
const swirl = (col: string) => tube('M24 25 C28 25 28 19 24 19 C18 19 17 28 24 29 C33 30 35 16 24 13 C12 10 8 30 20 35', col, 4.5);
const medal = (fill: string) => p('M15 4 L22 20 L27 17 L21 4 Z', RED, 'stroke-width="2.5"') + p('M33 4 L26 20 L21 17 L27 4 Z', BLUE, 'stroke-width="2.5"') + c(24, 30, 12, fill) + p(star(24, 30, 6.5, 3, 5), '#fff', 'stroke-width="2" opacity=".85"');
const heads = (a: string, b: string) => p('M4 43 C4 33 9 29 16 29 C23 29 28 33 28 43 Z', a) + c(16, 18, 9, a) + p('M20 43 C20 34 25 30 32 30 C39 30 44 34 44 43 Z', b) + c(32, 19, 9, b) + dot(13, 17, 1.8) + dot(19, 17, 1.8) + dot(29, 18, 1.8) + dot(35, 18, 1.8);
const tubeGuy = (col: string) => r(15, 8, 18, 34, 9, col) + eyes(20.5, 27.5, 17, 3.4) + p('M20 25 Q24 30 28 25', 'none', 'stroke-width="2.5"') + shine(19, 32, 1.6, 5, 0);
const bars = r(12, 9, 8, 30, 3, WHITE) + r(28, 9, 8, 30, 3, WHITE);

/** Every icon, by name. */
const ICONS = {
  // --- Modes and the public queue ---------------------------------------------------------
  globe: c(24, 24, 19, BLUE) + p('M12 13 C17 10 22 12 21 17 C20 22 15 21 13 25 C10 22 9 16 12 13 Z', GREEN, 'stroke-width="2.5"') + p('M27 27 C32 25 37 27 36 32 C35 37 30 40 27 37 C24 34 25 29 27 27 Z', GREEN, 'stroke-width="2.5"') + p('M30 8 C34 9 38 13 39 17 C35 18 31 15 30 8 Z', GREEN, 'stroke-width="2.5"') + c(24, 24, 19, 'none') + shine(15, 14, 4, 2.5),
  fire,
  boom,
  team: r(5, 12, 17, 31, 8.5, RED) + eyes(10, 17, 20, 3) + r(26, 8, 17, 35, 8.5, BLUE) + eyes(31, 38, 16, 3) + p('M10 28 Q13.5 32 17 28', 'none', 'stroke-width="2.3"') + p('M31 24 Q34.5 28 38 24', 'none', 'stroke-width="2.3"'),
  ball: beachBall,
  pump: r(10, 6, 28, 6, 3, YEL) + tube('M24 12 V17', GREY, 3) + r(16, 16, 16, 24, 4, RED) + r(12, 38, 24, 6, 3, DARK) + ln('M32 34 C40 34 42 28 44 22', 3) + shine(20, 24, 1.8, 5, 0),
  duel: tube('M9 9 L33 33', '#eef1f8', 4.5) + tube('M39 9 L15 33', '#eef1f8', 4.5) + tube('M28 36 L36 28', YEL, 3.5) + tube('M20 36 L12 28', YEL, 3.5) + tube('M35 35 L41 41', DARK, 4) + tube('M13 35 L7 41', DARK, 4),
  trophy,
  // --- Maps --------------------------------------------------------------------------------
  dice: p('M24 5 L41 14 L24 23 L7 14 Z', WHITE) + p('M7 14 L24 23 V43 L7 34 Z', '#ece8fb') + p('M41 14 L24 23 V43 L41 34 Z', '#d6cfee') + dot(24, 14, 2.6) + dot(13, 24, 2.3) + dot(18, 33, 2.3) + dot(30, 24, 2.3) + dot(34, 29, 2.3) + dot(38, 34, 2.3),
  car: p('M4 31 V25 C4 22 6 21 9 20 L14 19 L19 11 H31 L37 19 L41 20 C43 21 44 23 44 25 V31 Z', RED) + p('M20 14 H30 L33.5 19 H16.5 Z', SKY, 'stroke-width="2.5"') + c(14, 32, 5.5, DARK) + c(34, 32, 5.5, DARK) + dot(14, 32, 2, GREY) + dot(34, 32, 2, GREY) + shine(10, 23, 3, 1.5, 0),
  lollipop: r(22, 25, 4, 20, 2, WHITE) + c(24, 18, 15, PINK) + `<path d="M24 18 m-2.5 0 a2.5 2.5 0 1 1 5 0 a6 6 0 1 1 -11 0 a9.5 9.5 0 1 1 19.5 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` + c(24, 18, 15, 'none') + shine(16, 11, 3, 2),
  parking: r(6, 6, 36, 36, 10, BLUE) + p('M18 13 H27 C33 13 35 17 35 21 C35 25 33 29 27 29 H23 V36 H18 Z M23 18 V24 H27 C29 24 30 23 30 21 C30 19 29 18 27 18 Z', WHITE, 'fill-rule="evenodd" stroke-width="2.5"') + shine(13, 12, 3, 1.8),
  skateboard: p('M5 21 C5 17 9 16 13 17 H35 C39 16 43 17 43 21 C43 25 39 26 35 25 H13 C9 26 5 25 5 21 Z', PINK) + ln('M14 25 V29') + ln('M34 25 V29') + c(14, 32, 4.5, YEL) + c(34, 32, 4.5, YEL) + dot(18, 21, 1.4, '#fff') + dot(24, 21, 1.4, '#fff') + dot(30, 21, 1.4, '#fff'),
  castle: r(8, 24, 32, 19, 4, PINK) + r(4, 15, 10, 28, 4, PURPLE) + r(34, 15, 10, 28, 4, PURPLE) + c(9, 13, 5, YEL) + c(39, 13, 5, YEL) + p('M15 24 C15 13 33 13 33 24 Z', BLUE) + p('M19 43 V35 C19 30 29 30 29 35 V43 Z', DARK, 'stroke-width="2.5"') + ln('M24 13 V5') + p('M24 5 L31 7.5 L24 10 Z', RED, 'stroke-width="2"'),
  rocket,
  ferris: ln('M24 21 L13 44 M24 21 L35 44', 3.5) + ln('M9 44 H39', 3.5) + `<circle cx="24" cy="21" r="15" fill="none" stroke="${INK}" stroke-width="7"/><circle cx="24" cy="21" r="15" fill="none" stroke="${PINK}" stroke-width="3"/>` + ln('M24 6 V36 M9 21 H39 M13.4 10.4 L34.6 31.6 M34.6 10.4 L13.4 31.6', 2) + c(24, 21, 3.5, YEL, 'stroke-width="2.5"') + c(24, 6, 3.6, BLUE, 'stroke-width="2.3"') + c(39, 21, 3.6, YEL, 'stroke-width="2.3"') + c(9, 21, 3.6, GREEN, 'stroke-width="2.3"'),
  flags: ln('M12 5 V44', 3.5) + ln('M36 5 V44', 3.5) + p('M13 6 H31 L26 12 L31 18 H13 Z', RED) + p('M35 22 H17 L22 28 L17 34 H35 Z', BLUE),
  // --- Weapons -----------------------------------------------------------------------------
  airCannon: r(4, 20, 26, 12, 5, BLUE) + p('M27 18 L41 11 V41 L27 34 Z', YEL) + e(15, 14, 8.5, 5.5, SKY) + p('M11 31 L9 42 H16 L18 31 Z', DARK, 'stroke-width="2.5"') + shine(12, 12, 3, 1.5, 0) + c(44, 26, 2.8, WHITE, 'stroke-width="2"'),
  leafBlower: p('M8 40 C8 20 20 8 40 8 C40 28 28 40 8 40 Z', GREEN) + ln('M11 37 L33 15', 2.5) + ln('M18 30 L18 22 M25 23 L25 16 M18 30 L26 30 M25 23 L32 23', 2) + shine(22, 17, 4, 2),
  airBlaster: r(4, 19, 12, 10, 4, ORANGE) + p('M15 18 C24 16 33 11 41 5 C45 15 45 33 41 43 C33 37 24 32 15 30 Z', YEL) + c(7, 24, 5.5, RED) + e(41, 24, 3, 19, '#ffe98a', 'stroke-width="2.5"') + shine(24, 19, 4, 1.8, -15),
  target: c(24, 24, 20, RED) + c(24, 24, 13.5, WHITE) + c(24, 24, 7.5, RED) + dot(24, 24, 2.6, '#fff') + shine(14, 12, 3.5, 2),
  bubbles: bubble(17, 29, 12) + bubble(33, 17, 9) + bubble(35, 36, 5.5),
  waterBalloon: balloon(BLUE),
  cork: p('M13 13 L35 13 L32 41 L16 41 Z', CORK) + e(24, 13, 11, 4.5, '#f2cc94') + ln('M9 6 L12 9 M24 2 V5 M39 6 L36 9', 3) + ln('M20 22 L20 35 M28 22 L28 35', 1.6, '#b07a3a'),
  swirl: swirl(TEAL) + c(38, 36, 3, WHITE, 'stroke-width="2"') + c(10, 12, 2.5, WHITE, 'stroke-width="2"'),
  trident: tube('M24 45 V12', GOLD, 3.5) + tube('M11 7 C11 16 15 21 24 21 C33 21 37 16 37 7', GOLD, 3.5) + p('M24 2 L28.5 10 H19.5 Z', GOLD, 'stroke-width="2.5"') + p('M11 3 L14.5 9 H7.5 Z', GOLD, 'stroke-width="2.5"') + p('M37 3 L40.5 9 H33.5 Z', GOLD, 'stroke-width="2.5"'),
  // --- Gadgets -----------------------------------------------------------------------------
  bouncePad: ln('M15 32 L19 35 L15 38 L19 41 M33 32 L29 35 L33 38 L29 41', 2.5) + p('M6 19 V25 C6 30 42 30 42 25 V19', '#6b35d9') + e(24, 19, 18, 7, PURPLE) + e(24, 18, 9, 3, LILAC, 'stroke-width="2"') + r(8, 40, 32, 5, 2.5, DARK, 'stroke-width="2.5"'),
  grenade: c(24, 29, 14, GREEN) + r(18, 9, 12, 7, 2.5, GREY) + ln('M30 12 C36 12 38 17 35 22', 3) + c(15, 10, 3.5, 'none', 'stroke-width="2.5"') + ln('M17 23 H31 M16 30 H32 M17 37 H31', 1.8, '#2f9e3a') + shine(18, 23, 3.5, 2),
  wall: r(4, 9, 40, 30, 7, ORANGE) + ln('M5 19 H43 M5 29 H43 M17 9.5 V19 M31 9.5 V19 M11 19 V29 M24 19 V29 M37 19 V29 M17 29 V38.5 M31 29 V38.5', 2.3) + shine(10, 13, 3, 1.5, 0),
  vortex: c(24, 24, 20, '#e6dcff') + swirl(PURPLE) + ln('M5 16 C3 21 3 27 5 32 M43 16 C45 21 45 27 43 32', 2),
  mine: r(5, 33, 38, 8, 4, GREY) + p('M9 34 C9 23 15 16 24 16 C33 16 39 23 39 34 Z', RED) + ln('M24 16 V13') + c(24, 10, 3.5, YEL, 'stroke-width="2.5"') + ln('M16 6 L18 9 M32 6 L30 9', 2.3) + shine(17, 23, 3.5, 2),
  heliumBalloon: balloon(PINK) + ln('M24 44 C20 46 27 47 24 48', 2),
  tornado: r(5, 5, 38, 8, 4, GREY) + r(10, 14, 30, 7, 3.5, GREY) + r(15, 22, 22, 7, 3.5, GREY) + r(18, 30, 14, 6, 3, GREY) + r(21, 37, 7, 6, 3, GREY) + ln('M11 9 H22 M17 17.5 H26', 1.8, '#fff'),
  // --- Ults --------------------------------------------------------------------------------
  bigBlow: c(24, 24, 19, SKY) + `<path d="M13 26 C13 17 22 13 28 17 C33 20 31 28 25 28 C21 28 20 23 24 22" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>` + c(24, 24, 19, 'none') + shine(14, 14, 4, 2.5),
  syringe: `<g transform="rotate(-45 24 24)">${r(6, 18, 24, 12, 3, WHITE)}${r(9, 21, 15, 6, 2, GREEN, 'stroke-width="2"')}${r(30, 21, 4, 6, 1, GREY, 'stroke-width="2.5"')}${ln('M34 24 H45', 2.5)}${ln('M6 24 H1', 3)}${r(-1, 17, 4, 14, 2, GREY, 'stroke-width="2.5"')}</g>`,
  nose: p('M21 6 C23 18 12 23 13 31 C14 38 22 39 25 36 C29 40 37 37 36 30 C35 24 27 21 25 6 Z', SKIN) + e(19, 33, 2.4, 1.8, DARK, 'stroke-width="1.5"') + e(30, 33, 2.4, 1.8, DARK, 'stroke-width="1.5"') + shine(22, 18, 1.8, 5, 10),
  gasCloud: p('M11 37 C4 37 4 27 11 26 C11 18 21 15 25 20 C28 14 38 16 37 24 C44 25 44 37 37 37 Z', LIME) + ln('M14 13 C12 10 15 8 13 5 M24 11 C22 8 25 6 23 3', 2.3, INK) + shine(18, 25, 3.5, 2),
  robot,
  rainbow: (() => {
    const cols = [RED, ORANGE, YEL, GREEN, BLUE, PURPLE];
    let out = `<path d="M4 38 A20 20 0 0 1 44 38" fill="none" stroke="${INK}" stroke-width="22"/>`;
    cols.forEach((col, i) => {
      const rr = 18.5 - i * 3.1;
      out += `<path d="M${24 - rr} 38 A${rr} ${rr} 0 0 1 ${24 + rr} 38" fill="none" stroke="${col}" stroke-width="3.3"/>`;
    });
    return out + c(8, 39, 5, WHITE, 'stroke-width="2.5"') + c(40, 39, 5, WHITE, 'stroke-width="2.5"');
  })(),
  // --- Loot ------------------------------------------------------------------------------
  bandage: `<g transform="rotate(-35 24 24)">${r(4, 16, 40, 16, 8, '#ffcfa3')}${r(17, 16, 14, 16, 2, CREAM, 'stroke-width="2.5"')}${dot(21, 21, 1.2, '#d9a36c')}${dot(27, 21, 1.2, '#d9a36c')}${dot(21, 27, 1.2, '#d9a36c')}${dot(27, 27, 1.2, '#d9a36c')}</g>`,
  bolt: p('M28 3 L10 27 H22 L19 45 L38 19 H26 Z', YEL) + shine(22, 14, 1.8, 4, 30),
  battery: r(5, 13, 34, 22, 5, GREEN) + r(39, 19, 5, 10, 2, GREY, 'stroke-width="2.5"') + p('M23 16 L16 26 H22 L20 32 L28 22 H22 Z', WHITE, 'stroke-width="2"'),
  feather: p('M39 5 C23 7 10 21 10 39 C24 37 39 24 39 5 Z', '#e2d4ff') + ln('M7 43 L32 13', 2.8) + ln('M20 26 L14 24 M25 21 L20 18 M24 31 L20 34 M29 25 L28 30', 1.8),
  spring: tube('M12 41 L36 35 L12 29 L36 23 L12 17 L36 11', GREY, 3.5) + r(8, 40, 32, 5, 2.5, RED, 'stroke-width="2.5"') + r(8, 5, 32, 5, 2.5, RED, 'stroke-width="2.5"'),
  // --- Weapon parts ------------------------------------------------------------------------
  barrel: r(3, 18, 42, 12, 6, GREY) + r(9, 16, 5, 16, 2, DARK, 'stroke-width="2.5"') + r(33, 16, 5, 16, 2, DARK, 'stroke-width="2.5"') + shine(22, 21, 8, 1.4, 0),
  tank: r(12, 6, 24, 36, 11, SKY) + ln('M13 17 H35 M13 31 H35', 2.3) + r(19, 2, 10, 6, 2, GREY, 'stroke-width="2.5"') + shine(18, 22, 2, 6, 0),
  wrench: `<g transform="rotate(45 24 24)">${r(19, 14, 10, 32, 4, GREY)}${p('M13 10 C13 3 20 0 24 0 C28 0 35 3 35 10 C35 15 31 18 24 18 C17 18 13 15 13 10 Z', GREY)}${r(20, -2, 8, 9, 1.5, WHITE, 'stroke-width="2.5"')}</g>`,
  nozzle: p('M5 18 H20 L43 9 V39 L20 30 H5 Z', YEL) + e(43, 24, 2.5, 15, '#ffe98a', 'stroke-width="2.5"') + shine(15, 21, 5, 1.4, 0),
  grip: `<g transform="rotate(-18 24 24)">${r(16, 4, 16, 40, 6, DARK)}${ln('M18 14 H30 M18 21 H30 M18 28 H30', 2, '#6b67a3')}</g>` + ln('M9 20 C4 22 5 30 11 30', 3),
  // --- Menu and screens --------------------------------------------------------------------
  locker: p('M16 6 L8 10 L3 20 L11 24 L13 20 V42 H35 V20 L37 24 L45 20 L40 10 L32 6 C30 11 18 11 16 6 Z', PINK) + ln('M24 21 V30', 2) + shine(19, 26, 1.6, 5, 0),
  friends: heads(PINK, BLUE),
  help: p('M8 10 C8 7 10 5 13 5 H35 C38 5 40 7 40 10 V29 C40 32 38 34 35 34 H23 L13 43 V34 C10 34 8 32 8 29 Z', YEL) + ln('M19 15 C19 10.5 29 10.5 29 16 C29 20 24 20 24 24', 3.6) + dot(24, 29, 2.3),
  settings: p(gear(24, 24, 20, 15, 8), GREY) + c(24, 24, 6.5, WHITE) + shine(15, 14, 3, 1.8),
  coin: c(24, 24, 19, GOLD) + `<circle cx="24" cy="24" r="12.5" fill="none" stroke="#e39a00" stroke-width="2.8"/>` + p('M20 15 H26 C30 15 31.5 17 31.5 19.3 C31.5 21.2 30.4 22.5 28.6 23 C31 23.5 32.3 25 32.3 27.4 C32.3 30.6 30 33 25.8 33 H20 Z', '#fff4c2', 'stroke-width="2.3"') + shine(15, 14, 3.5, 2),
  clock: c(24, 27, 17, WHITE) + r(20, 4, 8, 5, 2, RED, 'stroke-width="2.5"') + ln('M24 27 V16 M24 27 L31 31', 3) + dot(24, 27, 2),
  check: tube('M9 25 L19 35 L39 12', GREEN, 5),
  lock: tube('M16 21 V15 C16 5 32 5 32 15 V21', GREY, 3) + r(9, 20, 30, 23, 6, YEL) + dot(24, 30, 3.2) + ln('M24 31 V36', 3.2) + shine(15, 25, 2, 1.2, 0),
  unlock: tube('M16 21 V15 C16 5 32 5 32 11', GREY, 3) + r(9, 20, 30, 23, 6, GREEN) + dot(24, 30, 3.2) + ln('M24 31 V36', 3.2),
  shuffle: tube('M5 14 H13 C22 14 26 34 35 34 H38', BLUE, 3.5) + tube('M5 34 H13 C22 34 26 14 35 14 H38', PINK, 3.5) + p('M37 8 L45 14 L37 20 Z', BLUE, 'stroke-width="2.5"') + p('M37 28 L45 34 L37 40 Z', PINK, 'stroke-width="2.5"'),
  crown: p('M5 36 L8 13 L17 23 L24 8 L31 23 L40 13 L43 36 Z', YEL) + r(5, 34, 38, 7, 3, ORANGE) + c(24, 25, 3, RED, 'stroke-width="2"') + c(13, 27, 2.2, BLUE, 'stroke-width="1.8"') + c(35, 27, 2.2, BLUE, 'stroke-width="1.8"'),
  medalGold: medal(GOLD),
  medalSilver: medal('#dfe4ee'),
  medalBronze: medal('#e0915a'),
  invite: p('M4 43 C4 32 10 28 18 28 C26 28 32 32 32 43 Z', PINK) + c(18, 16, 9, PINK) + dot(15, 15, 1.8) + dot(21, 15, 1.8) + c(37, 30, 9, GREEN) + ln('M37 25 V35 M32 30 H42', 3.2, '#fff'),
  link: `<g transform="rotate(-45 24 24)">${tube('M8 18 H20 C25 18 25 30 20 30 H8 C3 30 3 18 8 18 Z', GREY, 3)}${tube('M28 18 H40 C45 18 45 30 40 30 H28 C23 30 23 18 28 18 Z', GREY, 3)}</g>`,
  star: p(star(24, 25, 21, 9.5, 5), YEL) + shine(19, 16, 2.5, 1.5),
  pin: ln('M21 27 L7 43', 3.5) + p('M30 5 L43 18 L37 20 L29 28 L30 34 L14 18 L20 19 L28 11 Z', RED) + shine(31, 11, 2.5, 1.5, 45),
  camera: r(4, 14, 40, 27, 6, DARK) + r(12, 8, 12, 8, 2.5, DARK) + c(24, 27, 9, SKY) + dot(24, 27, 3.5) + dot(37, 20, 2, YEL) + shine(21, 24, 2.5, 1.5),
  video: r(3, 13, 30, 23, 6, DARK) + p('M33 20 L45 13 V36 L33 29 Z', GREY) + c(14, 24, 5, SKY, 'stroke-width="2.5"') + dot(26, 19, 2, RED),
  sound: speaker + ln('M31 16 C35 20 35 28 31 32 M36 11 C43 18 43 30 36 37', 3),
  mute: speaker + ln('M31 18 L42 30 M42 18 L31 30', 3.5),
  gamepad: p('M11 15 H37 C43 15 46 22 45 30 C44 38 38 40 34 35 L31 31 H17 L14 35 C10 40 4 38 3 30 C2 22 5 15 11 15 Z', PURPLE) + ln('M13 21 V29 M9 25 H17', 3.5, '#fff') + dot(33, 22, 2.6, YEL) + dot(38, 26, 2.6, GREEN) + dot(29, 26, 2.6, BLUE) + dot(33, 30, 2.6, RED),
  glove: p('M12 15 C12 8 18 6 26 6 C36 6 41 12 41 22 C41 31 35 35 28 35 H18 C14 35 12 31 12 27 Z', RED) + r(13, 33, 17, 10, 3, WHITE) + p('M12 22 C8 20 5 24 8 28 C10 30 13 29 14 27', RED) + shine(22, 13, 4, 2),
  wave: p('M3 30 C9 23 14 23 18 30 C22 37 26 37 30 30 C34 23 39 23 45 30 V45 H3 Z', BLUE) + ln('M8 38 C12 35 15 35 18 38 M30 38 C34 35 37 35 40 38', 2, '#fff'),
  burger: p('M6 20 C6 10 14 6 24 6 C34 6 42 10 42 20 Z', '#f2a33a') + p('M5 23 C9 20 12 26 16 23 C20 20 23 26 27 23 C31 20 34 26 38 23 C40 22 42 22 43 23 V26 H5 Z', GREEN, 'stroke-width="2.5"') + r(5, 26, 38, 7, 3.5, '#8a4b2a') + r(6, 33, 36, 3.5, 1.7, YEL, 'stroke-width="2.3"') + p('M6 36 H42 C42 41 38 43 34 43 H14 C10 43 6 41 6 36 Z', '#f2a33a') + dot(17, 12, 1.2, CREAM) + dot(25, 10, 1.2, CREAM) + dot(31, 14, 1.2, CREAM) + shine(14, 13, 3, 1.5, -20),
  flag: ln('M11 4 V45', 3.5) + p('M12 6 C19 3 25 10 32 7 C35 6 38 5 40 5 V25 C33 29 27 21 19 25 C16 26 14 26 12 26 Z', RED) + shine(19, 11, 3, 1.5, -10),
  heart: p('M24 42 C12 33 5 26 5 17 C5 10 10 6 16 6 C20 6 22.5 8 24 11 C25.5 8 28 6 32 6 C38 6 43 10 43 17 C43 26 36 33 24 42 Z', PINK) + shine(14, 14, 3.5, 2),
  popcorn: p('M9 20 L14 44 H34 L39 20 Z', WHITE) + `<path d="M12.5 21 L16.5 43 H21 L19 21 Z M26.5 21 L27 43 H31.5 L35.5 21 Z" fill="${RED}"/>` + p('M9 20 L14 44 H34 L39 20 Z', 'none') + c(14, 17, 5.5, CREAM) + c(22, 13, 6, CREAM) + c(31, 14, 6, CREAM) + c(36, 19, 4.5, CREAM) + c(27, 20, 4.5, '#ffe9a8', 'stroke-width="2.5"'),
  duck: e(21, 33, 17, 10, YEL) + c(31, 17, 9, YEL) + p('M38 16 C44 15 46 18 45 20 C43 22 40 21 38 21 Z', ORANGE, 'stroke-width="2.5"') + dot(33, 15, 2) + p('M8 30 C13 28 19 31 20 36', 'none', 'stroke-width="2.5"') + shine(26, 13, 2.5, 1.5),
  noodle: ln('M30 4 L20 26 M36 5 L24 27', 3) + p('M4 24 H44 C44 36 36 43 24 43 C12 43 4 36 4 24 Z', RED) + ln('M10 24 C12 18 16 30 19 22 C21 17 25 29 28 22 C30 17 34 28 38 23', 2.5, YEL) + ln('M11 33 H37', 2, '#fff'),
  hand: p('M15 26 V12 C15 9.5 19 9.5 19 12 V22 V8 C19 5.5 23 5.5 23 8 V22 V7 C23 4.5 27 4.5 27 7 V22 V10 C27 7.5 31 7.5 31 10 V27 C33 23 35 21 37 21 C40 21 40 24 39 26 C36 33 33 42 23 42 C17 42 15 37 15 32 Z', SKIN) + ln('M40 8 C42 10 43 13 43 15 M5 13 C5 11 6 8 8 6', 2.5),
  muscle: p('M8 42 C6 34 8 26 13 22 L18 10 C19 6 25 5 27 8 C28 10 27 13 25 15 L22 18 C26 16 31 16 34 19 C40 16 44 21 43 28 C42 37 34 42 24 42 Z', SKIN) + p('M22 19 C26 17 31 17 34 20 C36 24 34 29 29 30', 'none', 'stroke-width="2.5"') + shine(33, 25, 3, 1.8, -20),
  bow: tube('M17 43 V28 C17 19 22 16 30 16 H33', BLUE, 12) + dot(31, 19.5, 2) + dot(36.5, 19.5, 2) + p('M31 25 Q34 27 37 25', 'none', 'stroke-width="2"') + ln('M5 44 H43', 3) + shine(15, 32, 1.5, 4, 0),
  comet: p('M6 42 C12 30 20 22 34 12 L40 20 C28 28 18 36 6 42 Z', ORANGE) + p('M10 40 C16 32 22 26 34 16 L37 19 C27 27 19 34 10 40 Z', YEL, 'stroke-width="0"') + c(36, 14, 8, '#ffe98a') + shine(33, 11, 2.5, 1.5),
  picture: r(4, 8, 40, 32, 5, WHITE) + r(8, 12, 32, 24, 2, SKY, 'stroke-width="2"') + p('M8 36 L18 22 L25 30 L30 25 L40 36 Z', GREEN, 'stroke-width="2"') + c(33, 18, 3.5, YEL, 'stroke-width="2"'),
  finishFlag: ln('M9 4 V45', 3.5) + p('M10 6 H40 V28 H10 Z', WHITE) + `<path d="M10 6 H17.5 V13.3 H10 Z M25 6 H32.5 V13.3 H25 Z M17.5 13.3 H25 V20.6 H17.5 Z M32.5 13.3 H40 V20.6 H32.5 Z M10 20.6 H17.5 V28 H10 Z M25 20.6 H32.5 V28 H25 Z" fill="${INK}"/>` + p('M10 6 H40 V28 H10 Z', 'none'),
  skull: p('M24 5 C35 5 42 12 42 22 C42 29 38 32 36 33 V40 H12 V33 C10 32 6 29 6 22 C6 12 13 5 24 5 Z', WHITE) + c(16.5, 22, 4.5, DARK, 'stroke-width="2"') + c(31.5, 22, 4.5, DARK, 'stroke-width="2"') + p('M24 27 L21 32 H27 Z', DARK, 'stroke-width="1.5"') + ln('M19 40 V35 M24 40 V35 M29 40 V35', 2),
  sparkles: p(star(19, 27, 16, 5, 4, -90), YEL) + p(star(36, 11, 8, 2.8, 4, -90), WHITE, 'stroke-width="2.5"') + p(star(37, 36, 6, 2.2, 4, -90), PINK, 'stroke-width="2.3"'),
  chat: p('M6 10 C6 7 8 5 11 5 H37 C40 5 42 7 42 10 V28 C42 31 40 33 37 33 H20 L11 42 V33 C8 33 6 31 6 28 Z', WHITE) + dot(15.5, 19, 2.8) + dot(24, 19, 2.8) + dot(32.5, 19, 2.8),
  warning: p('M24 4 L45 41 H3 Z', YEL) + ln('M24 17 V29', 4) + dot(24, 35, 2.6),
  party: p('M5 43 L16 14 L34 32 Z', PURPLE) + ln('M10 30 L20 38 M13 22 L27 34', 2, '#fff') + ln('M28 6 L30 12 M40 10 L35 15 M42 22 L36 22', 3) + dot(22, 7, 2.3, PINK) + dot(40, 30, 2.3, YEL) + dot(33, 4, 2, BLUE),
  mouse: r(12, 5, 24, 38, 12, WHITE) + ln('M24 5 V18 M12.5 18 H35.5', 2.5) + r(21.5, 9, 5, 7, 2.5, PINK, 'stroke-width="2"'),
  laptop: r(8, 8, 32, 22, 3, DARK) + r(11, 11, 26, 16, 1.5, SKY, 'stroke-width="2"') + p('M3 33 H45 L42 39 H6 Z', GREY),
  phone: r(13, 4, 22, 40, 5, DARK) + r(16, 9, 16, 28, 2, SKY, 'stroke-width="2"') + dot(24, 40.5, 1.6, '#fff'),
  shield: p('M24 4 L41 10 V22 C41 33 34 40 24 44 C14 40 7 33 7 22 V10 Z', BLUE) + p('M24 10 L35 14 V22 C35 29 31 34 24 37 Z', SKY, 'stroke-width="2"'),
  hook: tube('M26 4 V26 C26 36 14 38 12 29', '#eef1f8', 3.5) + p('M8 30 L12 23 L16 30 Z', '#eef1f8', 'stroke-width="2.5"') + c(26, 6, 4, DARK, 'stroke-width="2.5"'),
  fist: p('M10 22 C10 15 14 12 20 12 H34 C38 12 40 15 40 19 V30 C40 37 35 41 29 41 H19 C13 41 10 37 10 31 Z', SKIN) + ln('M19 12 V21 M26 12 V21 M33 12 V21', 2.3) + p('M10 25 C10 21 21 20 21 25 C21 29 14 30 10 29', SKIN, 'stroke-width="2.5"'),
  reload: tube('M36 17 C32 9 21 7 14 13 C7 19 8 31 16 36 C23 40 32 38 36 31', GREEN, 3.5) + p('M30 13 L40 11 L39 21 Z', GREEN, 'stroke-width="2.5"'),
  dash: p('M17 38 C9 38 8 29 14 27 C13 20 21 16 26 20 C29 13 40 15 39 24 C45 26 44 38 37 38 Z', WHITE) + ln('M3 17 H14 M1 25 H9 M5 33 H10', 3),
  taunt: c(24, 24, 19, YEL) + dot(17, 20, 2.8) + p('M28 18 L34 20.5 L28 23', 'none', 'stroke-width="2.6"') + p('M15 29 Q24 38 33 29', PINK, 'stroke-width="2.6"') + p('M23 33 C23 40 29 40 29 34', RED, 'stroke-width="2.3"') + shine(15, 13, 3.5, 2),
  pause: r(4, 4, 40, 40, 11, PURPLE) + bars,
  body: tubeGuy(PINK),
  palette: p('M24 5 C12 5 4 13 4 24 C4 35 12 43 22 43 C26 43 27 40 25 37 C23 34 25 31 29 31 H35 C40 31 44 28 44 22 C44 12 35 5 24 5 Z', CREAM) + c(14, 21, 3.5, RED, 'stroke-width="2.3"') + c(20, 12, 3.5, YEL, 'stroke-width="2.3"') + c(30, 11, 3.5, GREEN, 'stroke-width="2.3"') + c(37, 19, 3.5, BLUE, 'stroke-width="2.3"'),
  brush: `<g transform="rotate(40 24 24)">${r(20, 22, 8, 24, 3.5, ORANGE)}${r(19, 17, 10, 7, 1.5, GREY, 'stroke-width="2.5"')}${p('M19 17 C19 9 22 3 24 1 C26 3 29 9 29 17 Z', PINK)}</g>`,
  stripes: r(13, 4, 22, 40, 9, WHITE) + `<path d="M14.5 14 H33.5 V18 H14.5 Z M14.5 22 H33.5 V26 H14.5 Z M14.5 30 H33.5 V34 H14.5 Z" fill="${PINK}"/>` + r(13, 4, 22, 40, 9, 'none'),
  smile: c(24, 24, 19, YEL) + dot(17, 20, 2.8) + dot(31, 20, 2.8) + p('M15 28 Q24 37 33 28', 'none', 'stroke-width="3"') + shine(15, 13, 3.5, 2),
  eyes: e(15, 24, 9, 12, WHITE) + e(33, 24, 9, 12, WHITE) + dot(17, 27, 4.2) + dot(35, 27, 4.2) + dot(18.5, 25.5, 1.3, '#fff') + dot(36.5, 25.5, 1.3, '#fff'),
  hat: e(24, 37, 21, 6, DARK) + r(12, 8, 24, 30, 4, DARK) + r(12, 27, 24, 6, 1, RED, 'stroke-width="2.5"') + shine(18, 15, 1.5, 4, 0),
  pedestal: r(6, 34, 36, 9, 4, DARK) + r(11, 20, 26, 15, 3, PURPLE) + e(24, 20, 13, 4, LILAC, 'stroke-width="2.5"'),
  gloss: p('M24 4 C30 14 38 21 38 30 C38 38 32 44 24 44 C16 44 10 38 10 30 C10 21 18 14 24 4 Z', PINK) + p('M17 28 C17 23 20 20 22 19', 'none', 'stroke="#fff" stroke-width="3.5" stroke-linecap="round"'),
  music: ln('M18 36 V9 L40 4 V31', 3.5) + e(13, 36, 6.5, 5, PINK) + e(35, 31, 6.5, 5, PINK) + ln('M18 16 L40 11', 3.5),
  bag: p('M8 18 H40 L37 43 H11 Z', ORANGE) + ln('M17 18 C17 8 31 8 31 18', 3.5) + r(20, 24, 8, 6, 2, YEL, 'stroke-width="2.3"'),
  rotate: r(15, 9, 18, 30, 4, DARK) + r(18, 13, 12, 20, 1.5, SKY, 'stroke-width="2"') + tube('M40 16 C44 22 44 30 38 35', GREEN, 3) + p('M34 32 L40 38 L42 30 Z', GREEN, 'stroke-width="2.3"'),
  toolbox: r(4, 17, 40, 25, 5, RED) + tube('M16 17 V11 H32 V17', GREY, 3) + r(20, 25, 8, 6, 2, YEL, 'stroke-width="2.3"') + ln('M5 28 H20 M28 28 H43', 2.3),
  none: c(24, 24, 17, 'none', `stroke="${STEEL}" stroke-width="4"`) + ln('M12 36 L36 12', 4, STEEL),
} as const;

export type IconName = keyof typeof ICONS;

/** The SVG markup for an icon (for HTML strings such as kill feed lines). */
export function iconHtml(name: IconName, cls = ''): string {
  return `<svg class="bl-icon${cls ? ` ${cls}` : ''}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

/** An icon element (a span holding the SVG, sized by the font size: 1.25em by default). */
export function icon(name: IconName, cls = ''): HTMLElement {
  const span = document.createElement('span');
  span.className = `bl-ico${cls ? ` ${cls}` : ''}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = iconHtml(name);
  return span;
}

/**
 * Sets an element's text, drawing `{name}` tokens as icons (touch button names inside hints such
 * as "{dash} to dash out"). Other text stays plain text.
 */
export function setRich(target: HTMLElement, text: string): void {
  target.textContent = '';
  for (const [i, part] of text.split(/\{([A-Za-z]+)\}/).entries()) {
    if (i % 2 === 1 && isIconName(part)) target.append(icon(part));
    else if (i % 2 === 1) target.append(`{${part}}`);
    else if (part) target.append(part);
  }
}

/** Every icon's name (the look-dev sheet draws them all). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function isIconName(s: string): s is IconName {
  return Object.hasOwn(ICONS, s);
}
