// Race store: the one place views read races from and record changes to.
//
// A race is a document (name, starting state, latest snapshot for the race
// list) plus its list of operations (see ops.js). Views read with get(id) —
// replayed from the operations once open(id) has loaded them — and record
// changes with dispatch(id, type, args). Storage is an adapter: localStorage on
// one device (sync/local.js) or Firebase for a team sharing races live
// (sync/firebase.js). Both behave the same way here.

import { newState, normalizeSettings, normalizeState, DEFAULT_SETTINGS } from './engine.js';
import { replay, opLabel, lastOp, OP_TYPES } from './ops.js';

const ID_RE = /^[\w-]{1,64}$/;
const PREFS_KEY = 'ahk.prefs.v1';
const clean = (v) => JSON.parse(JSON.stringify(v ?? null));
const finiteOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Validate a race document from storage or another device. */
function normalizeDoc(d) {
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !ID_RE.test(d.id)) return null;
  const now = Date.now();
  const pick = (x) => ({ settings: normalizeSettings(x?.settings), state: normalizeState(x?.state) });
  const base = pick(d.base ?? d);
  const last = d.lastOp && typeof d.lastOp === 'object' ? d.lastOp : null;
  return {
    id: d.id,
    name: String(d.name ?? '').trim().slice(0, 80) || 'Race',
    createdAt: finiteOr(d.createdAt, now),
    updatedAt: finiteOr(d.updatedAt, now),
    createdBy: String(d.createdBy ?? '').slice(0, 80),
    base,
    snap: d.snap ? pick(d.snap) : base,
    opCount: finiteOr(d.opCount, 0),
    lastOp: last ? { label: String(last.label ?? '').slice(0, 60), at: finiteOr(last.at, 0), by: String(last.by ?? '').slice(0, 80) } : null,
  };
}

function normalizeOp(o) {
  if (!o || typeof o.id !== 'string' || !OP_TYPES.includes(o.type) || !Number.isFinite(o.at)) return null;
  return {
    id: o.id,
    type: o.type,
    args: o.args && typeof o.args === 'object' ? o.args : {},
    at: o.at,
    by: String(o.by ?? '').slice(0, 80),
    dev: String(o.dev ?? '').slice(0, 64),
  };
}

export function createStore({ device, now = () => Date.now() } = {}) {
  let adapter = null;
  let docs = new Map();
  const ops = new Map(); // raceId → { map, list, pending }
  const opened = new Map(); // raceId → { refs, unsub }
  const cache = new Map(); // raceId → { doc, list, race }
  const refreshTimers = new Map();
  const subs = new Set();
  let stopRaces = null;
  let racesLoaded = false;
  let syncStatus = 'local';
  let deviceId = device || null;

  const emit = (evt = { type: 'change' }) => subs.forEach((fn) => fn(evt));
  const fail = (err) => emit({ type: 'error', message: err?.message || String(err) });

  function setDocs(list) {
    const next = new Map();
    for (const raw of list) {
      const d = normalizeDoc(raw);
      if (d) next.set(d.id, d);
    }
    docs = next;
    racesLoaded = true;
    emit();
  }

  function setOps(id, list) {
    const prev = ops.get(id);
    const map = new Map();
    for (const raw of list) {
      const o = normalizeOp(raw);
      if (o) map.set(o.id, o);
    }
    // Keep our own operations until the backend echoes them back.
    const pending = new Set();
    if (prev) {
      for (const pid of prev.pending) {
        if (!map.has(pid) && prev.map.has(pid)) {
          map.set(pid, prev.map.get(pid));
          pending.add(pid);
        }
      }
    }
    ops.set(id, { map, list: [...map.values()], pending });
    scheduleSnapRefresh(id);
    emit();
  }

  // When two devices write at the same moment, the race-list snapshot may miss
  // one operation. Whoever has the race open repairs it shortly after.
  function scheduleSnapRefresh(id) {
    if (refreshTimers.has(id) || typeof setTimeout !== 'function') return;
    const t = setTimeout(() => {
      refreshTimers.delete(id);
      const doc = docs.get(id);
      const o = ops.get(id);
      if (!doc || !o || o.pending.size || doc.opCount === o.map.size) return;
      const r = get(id);
      adapter.updateRace(id, clean({ snap: { settings: r.settings, state: r.state }, opCount: o.map.size })).catch(() => {});
    }, 1500 + Math.random() * 1500);
    refreshTimers.set(id, t);
  }

  function watchRaces() {
    stopRaces?.();
    stopRaces = null;
    racesLoaded = false;
    if (adapter.user()) stopRaces = adapter.watchRaces(setDocs, fail);
    else {
      docs = new Map();
      ops.clear();
      cache.clear();
      emit();
    }
  }

  function init(a) {
    adapter = a;
    deviceId = deviceId || getDeviceId();
    adapter.onStatus((s) => {
      syncStatus = s;
      emit({ type: 'status', status: s });
    });
    adapter.onAuth(() => {
      watchRaces();
      emit({ type: 'auth' });
    });
    watchRaces();
  }

  function get(id) {
    const doc = docs.get(id);
    if (!doc) return null;
    const o = ops.get(id);
    const list = o ? o.list : null;
    const hit = cache.get(id);
    let r;
    if (hit && hit.doc === doc && hit.list === list) r = hit.race;
    else {
      r = list ? replay(doc.base, list) : doc.snap;
      cache.set(id, { doc, list, race: r });
    }
    return {
      id: doc.id,
      name: doc.name,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      createdBy: doc.createdBy,
      lastOp: doc.lastOp,
      settings: r.settings,
      state: r.state,
      synced: !!o, // full operation log loaded (needed before recording changes)
    };
  }

  const list = () => [...docs.keys()].map(get).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);

  /** Load and follow a race's operations. Returns a release function. */
  function open(id) {
    let o = opened.get(id);
    if (!o) {
      o = { refs: 0, unsub: null };
      opened.set(id, o);
      o.unsub = adapter.watchOps(id, (l) => setOps(id, l), fail);
    }
    o.refs++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--o.refs > 0) return;
      o.unsub?.();
      opened.delete(id);
      ops.delete(id);
      cache.delete(id);
      clearTimeout(refreshTimers.get(id));
      refreshTimers.delete(id);
    };
  }

  /** Record an operation. Returns it, or null while the race is still loading. */
  function dispatch(id, type, args = {}) {
    const doc = docs.get(id);
    const o = ops.get(id);
    if (!doc || !o || !OP_TYPES.includes(type)) return null;
    const op = { id: uid(), type, args: clean(args) || {}, at: now(), by: adapter.user() || '', dev: deviceId };
    o.map.set(op.id, op);
    o.pending.add(op.id);
    o.list = [...o.map.values()];
    const r = get(id);
    const label = type === 'undo' ? `Undo: ${opLabel(o.map.get(op.args.target))}` : opLabel(op);
    const patch = clean({
      snap: { settings: r.settings, state: r.state },
      opCount: o.map.size,
      updatedAt: op.at,
      lastOp: { label, at: op.at, by: op.by },
    });
    docs.set(id, normalizeDoc({ ...doc, ...patch }));
    emit();
    adapter.addOp(id, op, patch).catch(fail);
    return op;
  }

  /** Cancel the latest change (from any device). Returns its label. */
  function undo(id) {
    const o = ops.get(id);
    const last = o && lastOp(o.list);
    if (!last) return null;
    dispatch(id, 'undo', { target: last.id });
    return opLabel(last);
  }

  const lastEvent = (id) => {
    const o = ops.get(id);
    return o ? lastOp(o.list) : null;
  };
  const lastStep = (id) => {
    const l = lastEvent(id);
    return l ? opLabel(l) : null;
  };

  /** The most recent event of any kind (undo included), with a readable label. */
  function newestOp(id) {
    const o = ops.get(id);
    if (!o) return null;
    let op = null;
    for (const x of o.list) if (!op || x.at > op.at || (x.at === op.at && x.id > op.id)) op = x;
    if (!op) return null;
    const label = op.type === 'undo' ? `Undo: ${opLabel(o.map.get(op.args.target) ?? {})}` : opLabel(op);
    return { op, label };
  }

  function create(name, settings, { state, createdAt } = {}) {
    const t = now();
    const base = clean({
      settings: normalizeSettings(settings || DEFAULT_SETTINGS),
      state: state ? normalizeState(state) : newState(),
    });
    const raw = {
      id: uid(),
      name: String(name ?? '').trim().slice(0, 80) || `Race ${docs.size + 1}`,
      createdAt: finiteOr(createdAt, t),
      updatedAt: t,
      createdBy: adapter.user() || '',
      base,
      snap: base,
      opCount: 0,
      lastOp: null,
    };
    docs.set(raw.id, normalizeDoc(raw));
    emit();
    adapter.createRace(raw).catch(fail);
    return get(raw.id);
  }

  function duplicate(id) {
    const r = get(id);
    return r ? create(`${r.name} (copy)`, clean(r.settings)) : null;
  }

  function remove(id) {
    docs.delete(id);
    ops.delete(id);
    cache.delete(id);
    emit();
    adapter.deleteRace(id).catch(fail);
  }

  function rename(id, name) {
    const doc = docs.get(id);
    const n = String(name ?? '').trim().slice(0, 80);
    if (!doc || !n || n === doc.name) return;
    const t = now();
    docs.set(id, { ...doc, name: n, updatedAt: t });
    emit();
    adapter.updateRace(id, { name: n, updatedAt: t }).catch(fail);
  }

  function exportJSON() {
    const races = list().map(({ id, name, createdAt, updatedAt, settings, state }) => ({ id, name, createdAt, updatedAt, settings, state }));
    return JSON.stringify({ app: 'ahk-timer', version: 2, exportedAt: new Date().toISOString(), races }, null, 2);
  }

  /** Add races (from an export or another device's local storage) as new races. */
  function importRaces(incoming) {
    let n = 0;
    for (const r of incoming) {
      if (!r || typeof r !== 'object' || !r.settings || !r.state) continue;
      create(r.name, r.settings, { state: r.state, createdAt: r.createdAt });
      n++;
    }
    return n;
  }

  function importJSON(text) {
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data?.races;
    if (!Array.isArray(incoming)) throw new Error('Not an AHK Timer export.');
    return importRaces(incoming);
  }

  return {
    init,
    list,
    get,
    open,
    dispatch,
    undo,
    lastStep,
    lastEvent,
    newestOp,
    create,
    duplicate,
    remove,
    rename,
    exportJSON,
    importJSON,
    importRaces,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    mode: () => adapter?.mode ?? 'local',
    loaded: () => racesLoaded,
    status: () => syncStatus,
    user: () => adapter?.user() ?? null,
    signIn: (u, p) => adapter.signIn(u, p),
    signOut: () => adapter.signOut(),
    device: () => deviceId,
  };
}

// ---- small per-device preferences (time display, last race, view-only lock)

export function prefs() {
  try {
    return { timeMode: 'clock', lastRace: null, locked: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { timeMode: 'clock', lastRace: null, locked: false };
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), [key]: value }));
  } catch {
    /* preferences are optional */
  }
}

function getDeviceId() {
  const p = prefs();
  if (p.device) return p.device;
  const id = uid().slice(0, 12);
  setPref('device', id);
  return id;
}

// The app's store. Tests create their own with createStore().
const app = createStore();
export const {
  init, list, get, open, dispatch, undo, lastStep, lastEvent, newestOp, create, duplicate, remove, rename,
  exportJSON, importJSON, importRaces, subscribe, mode, loaded, status, user, signIn, signOut, device,
} = app;
