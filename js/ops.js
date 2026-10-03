// Race operations — the event log every device shares.
//
// A race is stored as a base state plus a list of operations (PIT IN at
// 10:45:12, safety car out at 11:02:40 …). Every device replays the same
// operations in time order, so two people tapping at once, or a device that
// was offline for a while, merge cleanly instead of overwriting each other.
// Undo is itself an operation that cancels the latest change.

import {
  compute, normalizeSettings, normalizeState, validateEdit,
  actStart, actPause, actResume, actPitIn, actPitOut, actSafetyCar,
  actFinish, actSyncClock, actEditStint, actResetStint, actSetRefuel,
} from './engine.js';

const LABELS = {
  start: 'Start',
  pause: 'Pause',
  resume: 'Resume',
  pitIn: 'Pit in',
  pitOut: 'Pit out',
  scOn: 'Safety car out',
  scOff: 'Safety car in',
  finish: 'Finish',
  sync: 'Clock sync',
  edit: 'Edit stint',
  reset: 'Reset stint',
  settings: 'Settings',
  stopType: 'Stop type',
  undo: 'Undo',
};

export const OP_TYPES = Object.keys(LABELS);

export function opLabel(op) {
  const a = op?.args || {};
  if (op?.type === 'pitIn' && a.refuel === false) return 'Pit in · no refuel';
  if (op?.type === 'stopType') return `${a.refuel === false ? 'No refuel' : 'Refuel'} at stop ${a.n ?? ''}`.trim();
  const base = LABELS[op?.type] ?? 'Change';
  return (op.type === 'edit' || op.type === 'reset') && a.n ? `${base} ${a.n}` : base;
}

const byTime = (a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Operations in replay order, minus undo operations and the operations they cancelled. */
export function effectiveOps(ops) {
  const list = [...ops].filter((o) => o && OP_TYPES.includes(o.type) && Number.isFinite(o.at)).sort(byTime);
  const undone = new Set(list.filter((o) => o.type === 'undo').map((o) => o.args?.target));
  return list.filter((o) => o.type !== 'undo' && !undone.has(o.id));
}

// Race-progress operations are ignored once the flag has fallen.
const PROGRESS = new Set(['pause', 'resume', 'pitIn', 'pitOut', 'scOn', 'scOff', 'finish']);

/** Apply one operation to `race` in place. Returns false when it had no effect. */
export function applyOp(race, op) {
  const at = op.at;
  const a = op.args || {};
  if (PROGRESS.has(op.type) && compute(race, at).finished) return false;
  switch (op.type) {
    case 'start':
      actStart(race, at);
      break;
    case 'pause':
      actPause(race, at);
      break;
    case 'resume':
      actResume(race, at);
      break;
    case 'pitIn':
      actPitIn(race, at, { refuel: a.refuel !== false });
      break;
    case 'pitOut':
      actPitOut(race, at);
      break;
    case 'scOn':
      actSafetyCar(race, at, true);
      break;
    case 'scOff':
      actSafetyCar(race, at, false);
      break;
    case 'finish':
      actFinish(race, at);
      break;
    case 'sync':
      actSyncClock(race, at, Number(a.elapsed));
      break;
    case 'edit': {
      const n = Number(a.n);
      const patch = a.patch && typeof a.patch === 'object' ? a.patch : {};
      // Re-checked here: another device's change may have made the edit invalid.
      if (!(n >= 1) || validateEdit(race, at, n, patch)) return false;
      actEditStint(race, at, n, patch);
      break;
    }
    case 'reset':
      actResetStint(race, Number(a.n));
      break;
    case 'stopType':
      actSetRefuel(race, Number(a.n), a.refuel !== false);
      break;
    case 'settings':
      race.settings = normalizeSettings(a.settings);
      break;
    default:
      return false;
  }
  return true;
}

/** Rebuild { settings, state } from a base and the full operation list. */
export function replay(base, ops) {
  const race = {
    settings: normalizeSettings(base?.settings),
    state: normalizeState(JSON.parse(JSON.stringify(base?.state ?? null))),
  };
  for (const op of effectiveOps(ops)) applyOp(race, op);
  return race;
}

/** The operation an undo would cancel (latest effective change), or null. */
export function lastOp(ops) {
  const eff = effectiveOps(ops);
  return eff[eff.length - 1] ?? null;
}
