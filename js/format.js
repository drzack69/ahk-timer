// Time formatting and parsing. Durations are seconds, wall times epoch ms.

export const pad2 = (n) => String(n).padStart(2, '0');

const whole = (sec) => Math.max(0, Math.floor(Math.round(sec * 1000) / 1000));

/** 01:23:45 */
export function hms(sec) {
  const s = whole(sec);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}

/** 05:07 — minutes may exceed 59 */
export function mmss(sec) {
  const s = whole(sec);
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/** Countdown, switches to h:mm:ss above an hour: 23:12 / 1:05:00 */
export function countdown(sec) {
  const s = whole(Math.abs(sec));
  const h = Math.floor(s / 3600);
  const body = h ? `${h}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}` : mmss(s);
  return sec < 0 ? `+${body}` : body;
}

/** Stint-style duration: 105′ or 104′32″ (negative with a minus sign) */
export function mins(sec) {
  const neg = sec < -0.5;
  const s = Math.round(Math.abs(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (neg ? '−' : '') + (r ? `${m}′${pad2(r)}″` : `${m}′`);
}

/** Wall clock HH:MM */
export function clock(wall) {
  if (wall == null) return '—';
  const d = new Date(Math.round(wall / 1000) * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Race-relative time h:mm */
export function raceRel(sec) {
  const m = Math.floor(Math.round(Math.max(0, sec)) / 60);
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

/** 6 h · 6 h 30 min · 45 min */
export function hoursLabel(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function dateLabel(ms) {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "105" → 6300, "104:30" → 6270, "104.5" → 6270, "1h45" → 6300. NaN when unparseable. */
export function parseDuration(str) {
  const t = String(str ?? '').trim().toLowerCase().replace(',', '.');
  if (!t) return NaN;
  let m = t.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|′|')?$/);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  m = t.match(/^(\d+)\s*h\s*(\d{1,2})?\s*(?:m|min)?$/);
  if (m) return parseInt(m[1], 10) * 3600 + parseInt(m[2] || '0', 10) * 60;
  return NaN;
}

/** "12:45", "12:45:10", "1245", "9.05" → seconds since midnight (or since race start). NaN if invalid. */
export function parseTimeOfDay(str) {
  const t = String(str ?? '').trim().replace(/[.,]/g, ':');
  let m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const d = t.match(/^(\d{1,2})(\d{2})$/);
    if (d) m = [t, d[1], d[2], '0'];
  }
  if (!m) return NaN;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const s = parseInt(m[3] || '0', 10);
  if (mi > 59 || s > 59) return NaN;
  return h * 3600 + mi * 60 + s;
}

/** "1:23:45" / "83:45" / "45" (minutes) → seconds, for race-clock inputs. */
export function parseHms(str) {
  const parts = String(str ?? '').trim().split(':').map((p) => p.trim());
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return NaN;
  const n = parts.map((p) => parseInt(p, 10));
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  if (n.length === 2) return n[0] * 3600 + n[1] * 60;
  if (n.length === 1) return n[0] * 60;
  return NaN;
}
