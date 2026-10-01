// Race timeline strip: stints as clips, pit stops as gaps, safety-car periods,
// the current pit window and a playhead. Shared by settings, monitor and stats.

import { raceRel } from './format.js';

export function timelineHTML(c, { sc = [], head = null, win = null, labels = true, ticks = true } = {}) {
  const T = c.T || 1;
  const pct = (x) => (Math.max(0, Math.min(T, x)) / T) * 100;
  const segs = c.rows
    .map((r) => {
      const left = pct(r.start);
      const width = pct(r.end) - left;
      if (width <= 0) return '';
      // Only label clips wide enough to hold the text comfortably.
      const label = labels && width >= 6 ? `<span>S${r.n}</span>` : '';
      return `<div class="tl-seg ${r.status}" style="left:${left}%;width:${width}%">${label}</div>`;
    })
    .join('');
  const scHtml = sc
    .map((p) => {
      const l = pct(p.from);
      const w = Math.max(0.35, pct(p.to ?? c.now) - l);
      return `<div class="tl-sc wash" style="left:${l}%;width:${w}%"></div><div class="tl-sc" style="left:${l}%;width:${w}%"></div>`;
    })
    .join('');
  const winHtml =
    win && win[1] > win[0]
      ? `<div class="tl-win" style="left:${pct(win[0])}%;width:${Math.max(0.35, pct(win[1]) - pct(win[0]))}%"></div>`
      : '';
  const headHtml = head != null ? `<div class="tl-head" style="left:${pct(head)}%"></div>` : '';
  return `<div class="tl"><div class="tl-track">${segs}${scHtml}${winHtml}${headHtml}</div>${ticks ? tickHTML(T) : ''}</div>`;
}

function tickHTML(T) {
  const h = T / 3600;
  const step = h <= 3 ? 1800 : h <= 12 ? 3600 : h <= 24 ? 7200 : 14400;
  const marks = [];
  for (let t = 0; t < T - step * 0.45; t += step) marks.push(t);
  marks.push(T);
  return `<div class="tl-ticks">${marks
    .map((t) => `<span style="left:${(t / T) * 100}%">${raceRel(t)}</span>`)
    .join('')}</div>`;
}
