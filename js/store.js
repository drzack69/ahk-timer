// Race storage in localStorage, with per-race undo history.
// Data lives in this browser only; use export/import to move it between devices.

import { newState, normalizeSettings, normalizeState, DEFAULT_SETTINGS } from './engine.js';

const KEY = 'ahk.races.v1';
const PREFS_KEY = 'ahk.prefs.v1';
const HISTORY_LIVE = 40;
const HISTORY_FINISHED = 10;

const clone = (v) => JSON.parse(JSON.stringify(v));
const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const ID_RE = /^[\w-]{1,64}$/;
const finiteOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Validate a stored or imported race so nothing malformed reaches the views. */
function normalizeRace(r) {
  if (!r || typeof r !== 'object') return null;
  const now = Date.now();
  const snap = (h) => ({
    label: String(h.label ?? 'Change').slice(0, 40),
    at: finiteOr(h.at, now),
    settings: normalizeSettings(h.settings || {}),
    state: normalizeState(h.state),
  });
  return {
    id: typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : uid(),
    name: String(r.name ?? '').trim().slice(0, 80) || 'Race',
    createdAt: finiteOr(r.createdAt, now),
    updatedAt: finiteOr(r.updatedAt, now),
    settings: normalizeSettings(r.settings || {}),
    state: normalizeState(r.state),
    history: (Array.isArray(r.history) ? r.history : [])
      .filter((h) => h && typeof h === 'object')
      .slice(-HISTORY_LIVE)
      .map(snap),
  };
}

let races = load();
const subs = new Set();

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.map(normalizeRace).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(races));
  } catch {
    // Out of space: keep only the latest undo steps and try once more.
    races.forEach((r) => (r.history = (r.history || []).slice(-3)));
    try {
      localStorage.setItem(KEY, JSON.stringify(races));
    } catch {
      emit({ type: 'error', message: 'Browser storage is full — export and delete old races.' });
      return;
    }
  }
  emit({ type: 'change' });
}

function emit(evt) {
  subs.forEach((fn) => fn(evt));
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    races = load();
    emit({ type: 'change', external: true });
  }
});

export const list = () => [...races].sort((a, b) => b.updatedAt - a.updatedAt);
export const get = (id) => races.find((r) => r.id === id) || null;

export function create(name, settings) {
  const now = Date.now();
  const race = {
    id: uid(),
    name: (name || '').trim() || `Race ${races.length + 1}`,
    createdAt: now,
    updatedAt: now,
    settings: normalizeSettings(settings || DEFAULT_SETTINGS),
    state: newState(),
    history: [],
  };
  races.push(race);
  persist();
  return race;
}

export function duplicate(id) {
  const src = get(id);
  if (!src) return null;
  return create(`${src.name} (copy)`, clone(src.settings));
}

export function remove(id) {
  races = races.filter((r) => r.id !== id);
  persist();
}

export function rename(id, name) {
  const r = get(id);
  if (!r || !name.trim()) return;
  r.name = name.trim();
  r.updatedAt = Date.now();
  persist();
}

/**
 * Apply `fn(race)` as one undoable step. `label` names the step for the
 * undo button ("Pit in", "Safety car" …).
 */
export function mutate(id, label, fn) {
  const r = get(id);
  if (!r) return null;
  const snap = { label, at: Date.now(), settings: clone(r.settings), state: clone(r.state) };
  const result = fn(r);
  if (result === false) return r; // nothing changed
  r.history = [...(r.history || []), snap].slice(-(r.state.status === 'finished' ? HISTORY_FINISHED : HISTORY_LIVE));
  r.updatedAt = Date.now();
  persist();
  return r;
}

/** Change the race without an undo step (automatic finish, etc.). */
export function silent(id, fn) {
  const r = get(id);
  if (!r) return;
  fn(r);
  r.updatedAt = Date.now();
  persist();
}

/** Revert the last step. `fixup(race)` may adjust the restored race before anyone is notified. */
export function undo(id, fixup) {
  const r = get(id);
  const snap = r?.history?.pop();
  if (!snap) return null;
  r.settings = snap.settings;
  r.state = snap.state;
  fixup?.(r);
  r.updatedAt = Date.now();
  persist();
  return snap.label;
}

export const lastStep = (id) => get(id)?.history?.at(-1)?.label ?? null;

export function exportJSON() {
  return JSON.stringify({ app: 'ahk-timer', version: 1, exportedAt: new Date().toISOString(), races }, null, 2);
}

/** Merge races from an export. Races with the same id are replaced. Returns the count imported. */
export function importJSON(text) {
  const data = JSON.parse(text);
  const incoming = Array.isArray(data) ? data : data?.races;
  if (!Array.isArray(incoming)) throw new Error('Not an AHK Timer export.');
  let n = 0;
  for (const raw of incoming) {
    const item = normalizeRace(raw);
    if (!item) continue;
    const i = races.findIndex((x) => x.id === item.id);
    if (i >= 0) races[i] = item;
    else races.push(item);
    n++;
  }
  persist();
  return n;
}

// ---- small per-device preferences (time display mode, last race)

export function prefs() {
  try {
    return { timeMode: 'clock', lastRace: null, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { timeMode: 'clock', lastRace: null };
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), [key]: value }));
  } catch {
    /* preferences are optional */
  }
}
