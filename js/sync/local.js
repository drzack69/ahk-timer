// Local adapter: races live in this browser's localStorage only.
//
// Each race document and each operation has its own key, so several tabs on
// the same device can record events at once without overwriting each other.
// Used when no Firebase project is configured in config.js.

import { USERS } from '../../config.js';
import { sha256 } from '../sha256.js';
import { replay } from '../ops.js';

const RACE = 'ahk2.race.';
const OP = 'ahk2.op.';
const SESSION = 'ahk.session.v1';
const V1 = 'ahk.races.v1';
const MIGRATED = 'ahk2.migrated';

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Browser storage is full — export and delete old races.');
  }
}

function keys(prefix) {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) out.push(k);
  }
  return out;
}

const readRaces = () => keys(RACE).map(read).filter((d) => d && d.id);
const readOps = (id) => keys(`${OP}${id}.`).map(read).filter((o) => o && o.id);

/** One-time move of races saved by the first version of the app. */
function migrateV1() {
  if (localStorage.getItem(MIGRATED)) return;
  const old = read(V1);
  if (Array.isArray(old)) {
    for (const r of old) {
      if (!r || typeof r.id !== 'string' || localStorage.getItem(RACE + r.id)) continue;
      const base = { settings: r.settings, state: r.state };
      write(RACE + r.id, {
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        createdBy: '',
        base,
        snap: base,
        opCount: 0,
        lastOp: null,
      });
    }
  }
  localStorage.setItem(MIGRATED, '1');
}

/** Races stored on this device, with their current state (for uploading to team sync). */
export function readLocalRaces() {
  try {
    migrateV1();
  } catch {
    /* nothing to migrate */
  }
  return readRaces().map((d) => {
    const r = replay(d.base, readOps(d.id));
    return { id: d.id, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt, settings: r.settings, state: r.state };
  });
}

export function deleteLocalRaces(ids) {
  for (const id of ids) {
    for (const k of keys(`${OP}${id}.`)) localStorage.removeItem(k);
    localStorage.removeItem(RACE + id);
  }
}

export function createLocalAdapter() {
  try {
    migrateV1();
  } catch {
    /* storage unavailable — the app still runs from memory */
  }
  const raceCbs = new Set();
  const opCbs = new Map();
  const authCbs = new Set();
  const session = () => read(SESSION);
  const emitRaces = () => {
    const list = readRaces();
    raceCbs.forEach((cb) => cb(list));
  };
  const emitOps = (id) => {
    const set = opCbs.get(id);
    if (!set?.size) return;
    const list = readOps(id);
    set.forEach((cb) => cb(list));
  };

  // Other tabs of this browser act like other devices.
  window.addEventListener('storage', (e) => {
    if (e.key === SESSION) authCbs.forEach((cb) => cb(session()?.username ?? null));
    if (e.key == null || e.key.startsWith('ahk2.')) {
      emitRaces();
      opCbs.forEach((_, id) => emitOps(id));
    }
  });

  return {
    mode: 'local',
    ready: Promise.resolve(),
    user: () => session()?.username ?? null,
    onAuth(cb) {
      authCbs.add(cb);
      return () => authCbs.delete(cb);
    },
    async signIn(username, password) {
      const name = String(username || '').trim().toLowerCase();
      const account = USERS.find((u) => u.username.toLowerCase() === name);
      const hash = await sha256(String(password || ''));
      if (!account || hash !== String(account.passwordSha256).toLowerCase()) {
        return { ok: false, error: 'Wrong username or password.' };
      }
      write(SESSION, { username: account.username, at: Date.now() });
      authCbs.forEach((cb) => cb(account.username));
      return { ok: true };
    },
    async signOut() {
      localStorage.removeItem(SESSION);
      authCbs.forEach((cb) => cb(null));
    },
    watchRaces(cb) {
      raceCbs.add(cb);
      cb(readRaces());
      return () => raceCbs.delete(cb);
    },
    watchOps(id, cb) {
      if (!opCbs.has(id)) opCbs.set(id, new Set());
      opCbs.get(id).add(cb);
      cb(readOps(id));
      return () => opCbs.get(id)?.delete(cb);
    },
    async addOp(id, op, patch) {
      write(`${OP}${id}.${op.id}`, op);
      const doc = read(RACE + id);
      if (doc) write(RACE + id, { ...doc, ...patch });
      emitOps(id);
      emitRaces();
    },
    async createRace(doc) {
      write(RACE + doc.id, doc);
      emitRaces();
    },
    async updateRace(id, patch) {
      const doc = read(RACE + id);
      if (!doc) return;
      write(RACE + id, { ...doc, ...patch });
      emitRaces();
    },
    async deleteRace(id) {
      deleteLocalRaces([id]);
      emitRaces();
      emitOps(id);
    },
    onStatus(cb) {
      cb('local');
      return () => {};
    },
  };
}
