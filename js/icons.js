// Inline SVG icons (24×24, stroke = currentColor) and the AHK wordmark.

export const LOGO_PATH =
  'M0 59.5 L58.6 0 H130.6 V59.5 H95.5 V6.8 H86.8 L35 59.5 Z ' +
  'M140.8 0 H176 V32.8 H193.5 L204.5 21.8 H231 A5.8 5.8 0 0 0 236.8 16 V0 H271.8 V59.5 H236.8 V45.3 A5.8 5.8 0 0 0 231 39.5 H176 V59.5 H140.8 Z ' +
  'M282 0 H317 V32.8 H334.5 L366.6 0 H401.8 L369.8 32.8 H386.5 L412.5 59.5 H377.5 L358 39.5 H322.8 A5.8 5.8 0 0 0 317 45.3 V59.5 H282 Z';

export const logo = (cls = 'logo') =>
  `<svg class="${cls}" viewBox="0 0 412.5 59.5" role="img" aria-label="AHK"><path fill="currentColor" d="${LOGO_PATH}"/></svg>`;

function gearPath(teeth = 8, rOut = 9.6, rIn = 7.1) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  const tip = step * 0.2;
  const base = step * 0.31;
  const p = (r, a) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    pts.push(p(rIn, a - base), p(rOut, a - tip), p(rOut, a + tip), p(rIn, a + base));
  }
  return `M${pts.join(' L')} Z`;
}

const P = {
  races: '<path d="M9.5 6h10.5M9.5 12h10.5M9.5 18h10.5"/><rect x="3.5" y="4.5" width="3" height="3" rx="1"/><rect x="3.5" y="10.5" width="3" height="3" rx="1"/><rect x="3.5" y="16.5" width="3" height="3" rx="1"/>',
  settings: `<path d="${gearPath()}"/><circle cx="12" cy="12" r="3"/>`,
  monitor: '<path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.2-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6z"/>',
  play: '<path fill="currentColor" stroke="none" d="M7.5 5.2v13.6a1.1 1.1 0 0 0 1.68.93l10.7-6.8a1.1 1.1 0 0 0 0-1.86L9.18 4.27A1.1 1.1 0 0 0 7.5 5.2z"/>',
  pause: '<rect fill="currentColor" stroke="none" x="6" y="4.5" width="4.2" height="15" rx="1.3"/><rect fill="currentColor" stroke="none" x="13.8" y="4.5" width="4.2" height="15" rx="1.3"/>',
  stats: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3.5" height="6" rx="1"/><rect x="10.25" y="5" width="3.5" height="12" rx="1"/><rect x="15" y="13.5" width="3.5" height="3.5" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.5a2.5 2.5 0 0 0-2.5-2.5H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l.9 11.2A2 2 0 0 0 8.9 20h6.2a2 2 0 0 0 2-1.8L18 7M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/>',
  edit: '<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5h12.5l-2.2 4.25 2.2 4.25H5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  logout: '<path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5"/><path d="m10 16.5-4.5-4.5L10 7.5"/><path d="M5.5 12H16"/>',
  pitIn: '<path d="M3 12h11"/><path d="m10 7.5 4.5 4.5-4.5 4.5"/><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/>',
  pitOut: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M9 12h11.5"/><path d="m16 7.5 4.5 4.5-4.5 4.5"/>',
  car: '<path d="M10 3.5h4"/><path d="M5 16.5H3.8a.8.8 0 0 1-.8-.8v-2.6a2 2 0 0 1 1.3-1.87L7 10.2l2-3.2h6l2 3.2 2.7 1.03A2 2 0 0 1 21 13.1v2.6a.8.8 0 0 1-.8.8H19M9 16.5h6"/><circle cx="7" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  fuel: '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20M3.5 20h12M14 10h1.5a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8.5L18 6"/><path d="M7.5 7.5h4v3h-4z"/>',
  wheel: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M3.8 10.5H10M14 10.5h6.2M12 14v6.5"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4.5 19.5h15"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5M12 2.5V6"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 7.75-1.4"/>',
  sync: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/><path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15"/><path d="M4.5 19.5V15H9"/>',
  pin: '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  wrench: '<path d="M14.5 4.2a4.6 4.6 0 0 0-5.3 6.2L3.9 15.7a2 2 0 0 0 2.8 2.8l5.3-5.3a4.6 4.6 0 0 0 6.2-5.3l-2.9 2.9-2.6-.6-.6-2.6z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
