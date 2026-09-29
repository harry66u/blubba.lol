/**
 * A little flat tube man for the menus (logo mascot, podium, queue screen). Pure SVG markup so it
 * costs nothing to draw; CSS animates the arms and sway (see "Mascot" in style.css).
 */
export function tubeManSvg(color = '#ff3b5c', opts: { mood?: 'happy' | 'wow'; className?: string } = {}): string {
  const mouth =
    opts.mood === 'wow'
      ? '<ellipse cx="50.5" cy="57" rx="5" ry="6" fill="#1d1b3a"/>'
      : '<path d="M42 53 Q50.5 64 59 53 Z" fill="#1d1b3a" stroke="#1d1b3a" stroke-width="3" stroke-linejoin="round"/>';
  return `<svg class="tube-man ${opts.className ?? ''}" viewBox="0 0 100 140" aria-hidden="true" focusable="false" style="--tm:${color}">
  <g class="tm-sway">
    <g class="tm-arm tm-arm-l"><path d="M38 70 C24 66 15 52 8 38" fill="none" stroke="#1d1b3a" stroke-width="15" stroke-linecap="round"/><path d="M38 70 C24 66 15 52 8 38" fill="none" stroke="var(--tm)" stroke-width="8" stroke-linecap="round"/></g>
    <g class="tm-arm tm-arm-r"><path d="M62 70 C77 73 86 62 93 49" fill="none" stroke="#1d1b3a" stroke-width="15" stroke-linecap="round"/><path d="M62 70 C77 73 86 62 93 49" fill="none" stroke="var(--tm)" stroke-width="8" stroke-linecap="round"/></g>
    <path d="M41 22 L44 8 L49 19 L54 6 L57 21" fill="var(--tm)" stroke="#1d1b3a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M36 126 C35 92 34 62 36 38 C37 16 64 16 65 38 C67 62 66 92 65 126 Z" fill="var(--tm)" stroke="#1d1b3a" stroke-width="5" stroke-linejoin="round"/>
    <path d="M58 30 C62 50 62 96 60 124 L65 124 C66 92 67 62 65 38 C64.5 33 62 30 58 30 Z" fill="#000" opacity=".14"/>
    <path d="M41 78 L41 112" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".45"/>
    <circle cx="43.5" cy="40" r="7" fill="#fff" stroke="#1d1b3a" stroke-width="3"/>
    <circle cx="57.5" cy="40" r="7" fill="#fff" stroke="#1d1b3a" stroke-width="3"/>
    <circle class="tm-eye" cx="45" cy="41" r="3.2" fill="#1d1b3a"/>
    <circle class="tm-eye" cx="59" cy="41" r="3.2" fill="#1d1b3a"/>
    ${mouth}
  </g>
  <rect x="26" y="121" width="49" height="16" rx="6" fill="#3d3a66" stroke="#1d1b3a" stroke-width="4"/>
  <rect x="32" y="125" width="18" height="4" rx="2" fill="#fff" opacity=".3"/>
</svg>`;
}

/** The mascot as an element (for el() children); `className` goes on the wrapper (e.g. "flail"). */
export function tubeMan(color?: string, opts: { mood?: 'happy' | 'wow'; className?: string } = {}): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `tube-man-wrap ${opts.className ?? ''}`;
  wrap.innerHTML = tubeManSvg(color, { mood: opts.mood });
  return wrap;
}
