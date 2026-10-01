// Strategy engine — pure functions, no DOM and no storage.
//
// All race times are seconds on the race clock (paused intervals excluded),
// where 0 is the green flag. Wall-clock times are epoch milliseconds.
//
// Model
//   T  race length, S  max stint (fuel range at green-flag consumption),
//   P  planned pit-stop duration, k  fuel burn under safety car (0.5 = half).
//
//   Stints run back to back with a pit stop in between, and the race clock
//   keeps running while the car is in the pits. Every stint defaults to its
//   full fuel range; the last stint only has to reach the flag, so it is
//   usually shorter. Its unused range is the BUFFER: the total time you can
//   still pit early (shorten stints) without needing an extra stop.
//   Shortening a stint by X uses X of buffer. Safety-car minutes burn only k
//   of a green minute, so each SC minute adds (1 - k) minutes of range to the
//   stint it happens in.

export const DEFAULT_SETTINGS = Object.freeze({
  raceLengthMin: 360,
  maxStintMin: 105,
  pitOpenFirstMin: 30,
  drivers: 3,
  driverNames: [],
  pitStopMin: 5,
  scFactor: 0.5,
});

const clampNum = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export function normalizeSettings(s = {}) {
  const out = {
    raceLengthMin: clampNum(s.raceLengthMin, 360, 1, 48 * 60),
    maxStintMin: clampNum(s.maxStintMin, 105, 1, 24 * 60),
    pitOpenFirstMin: clampNum(s.pitOpenFirstMin, 0, 0, 24 * 60),
    drivers: Math.round(clampNum(s.drivers, 3, 1, 12)),
    pitStopMin: clampNum(s.pitStopMin, 5, 0, 120),
    scFactor: clampNum(s.scFactor, 0.5, 0, 1),
  };
  const names = Array.isArray(s.driverNames) ? s.driverNames : [];
  out.driverNames = Array.from({ length: out.drivers }, (_, i) =>
    String(names[i] ?? '').trim() || `Driver ${i + 1}`);
  return out;
}

export function newState() {
  return {
    status: 'draft', // draft | running | paused | finished
    startedAt: null, // wall ms of the green flag (shifted by clock sync)
    pauses: [], // [{ from, to }] wall ms, to = null while paused
    finishedAt: null, // race seconds
    stints: [], // [{ start, end, driver, planDur }] race seconds, end = null while on track
    sc: [], // [{ from, to }] race seconds, to = null while the safety car is out
    plan: {}, // { [stintNumber]: { dur, pit, driver } } overrides for upcoming stints
  };
}

// ---------------------------------------------------------------- clock

export function pausedMs(state, nowWall) {
  let ms = 0;
  for (const p of state.pauses) ms += Math.max(0, (p.to ?? nowWall) - p.from);
  return ms;
}

/** Current race time in seconds, capped at the race length. */
export function raceNow(race, nowWall) {
  const st = race.state;
  const T = normalizeSettings(race.settings).raceLengthMin * 60;
  if (st.status === 'draft' || st.startedAt == null) return 0;
  if (st.status === 'finished') return st.finishedAt ?? T;
  // Whole seconds, so every timer and countdown derived from it agrees.
  const e = Math.floor((nowWall - st.startedAt - pausedMs(st, nowWall)) / 1000);
  return Math.min(T, Math.max(0, e));
}

/** Wall-clock ms at which race second `r` happened (or will, if no further pauses). */
export function wallAt(race, r, nowWall) {
  const st = race.state;
  if (st.startedAt == null) return null;
  let wall = st.startedAt + r * 1000;
  let acc = 0;
  for (const p of st.pauses) {
    const len = Math.max(0, (p.to ?? nowWall) - p.from);
    const rAtPause = (p.from - st.startedAt - acc) / 1000;
    if (r > rAtPause) wall += len;
    acc += len;
  }
  return wall;
}

/** Race second at wall-clock ms `wall`. */
export function raceAt(race, wall, nowWall) {
  const st = race.state;
  if (st.startedAt == null) return null;
  let paused = 0;
  for (const p of st.pauses) {
    paused += Math.max(0, Math.min(wall, p.to ?? nowWall) - p.from);
  }
  return (wall - st.startedAt - paused) / 1000;
}

function overlap(periods, a, b, now) {
  let s = 0;
  for (const p of periods) s += Math.max(0, Math.min(b, p.to ?? now) - Math.max(a, p.from));
  return s;
}

// ---------------------------------------------------------------- plan

/**
 * Builds the full stint sheet for `race` at wall time `nowWall`:
 * finished and active stints from what actually happened, then planned
 * stints until the flag, plus buffer and pit-window figures.
 */
export function compute(race, nowWall = Date.now()) {
  const set = normalizeSettings(race.settings);
  const st = race.state;
  const T = set.raceLengthMin * 60;
  const S = set.maxStintMin * 60;
  const P = set.pitStopMin * 60;
  const open1 = set.pitOpenFirstMin * 60;
  const k = set.scFactor;
  const D = set.drivers;
  const started = st.status !== 'draft';
  const finished = st.status === 'finished';
  const now = raceNow(race, nowWall);
  const plan = st.plan || {};
  const ov = (n) => plan[n] || {};
  const rows = [];
  let prevDriver = -1;
  const rotate = () => (prevDriver + 1) % D;

  // 1) stints that actually started
  st.stints.forEach((a, i) => {
    const n = i + 1;
    const active = a.end == null && !finished;
    const sc = overlap(st.sc, a.start, a.end ?? now, now);
    const cap = S + sc * (1 - k);
    let end;
    let plannedDur = null;
    if (active) {
      plannedDur = ov(n).dur ?? cap;
      end = Math.max(a.start + plannedDur, now);
    } else {
      end = a.end ?? now;
    }
    let isFinal = false;
    if (active && end >= T) {
      end = T;
      isFinal = true;
    }
    const driver = Number.isInteger(a.driver) ? a.driver : rotate();
    rows.push({
      n,
      status: active ? 'active' : 'done',
      start: a.start,
      end,
      dur: end - a.start,
      cap,
      sc,
      plannedDur,
      planDurAtStart: a.planDur ?? null,
      pitBefore: i === 0 ? 0 : a.start - st.stints[i - 1].end,
      driver,
      isFinal,
      overridden: active && ov(n).dur != null,
    });
    prevDriver = driver;
  });

  const last = st.stints[st.stints.length - 1];
  const inPit = started && !finished && !!last && last.end != null;

  // 2) stints still to come
  const lastActual = rows[rows.length - 1];
  if (!finished && !(lastActual && lastActual.isFinal)) {
    let n = st.stints.length + 1;
    let t = 0;
    if (lastActual) {
      t = lastActual.end + (ov(n).pit ?? P);
      if (inPit) t = Math.max(t, now);
    }
    for (let guard = 0; guard < 500; guard++, n++) {
      const prev = rows[rows.length - 1];
      if (guard > 0) t = prev.end + (ov(n).pit ?? P);
      const o = ov(n);
      const start = Math.min(t, T);
      const plannedDur = o.dur != null ? Math.max(60, o.dur) : S;
      let end = start + plannedDur;
      let isFinal = false;
      if (end >= T) {
        end = T;
        isFinal = true;
      }
      const driver = Number.isInteger(o.driver) && o.driver < D ? o.driver : rotate();
      rows.push({
        n,
        status: 'planned',
        start,
        end,
        dur: end - start,
        cap: S,
        sc: 0,
        plannedDur,
        planDurAtStart: null,
        pitBefore: prev ? start - prev.end : 0,
        driver,
        isFinal,
        overridden: o.dur != null,
      });
      prevDriver = driver;
      if (isFinal) break;
    }
  }
  if (finished && rows.length) rows[rows.length - 1].isFinal = true;

  // 3) buffer: unused range of the final stint, and per row the buffer left
  //    after that stint = final slack + slack of the stints between it and the end
  const N = rows.length;
  let finalSlack = 0;
  let initialBuffer = 0;
  if (N) {
    const f = rows[N - 1];
    finalSlack = f.cap - f.dur;
    f.bufferAfter = finalSlack;
    f.bufferUsed = null;
    let acc = finalSlack;
    for (let i = N - 2; i >= 0; i--) {
      if (i + 1 <= N - 2) acc += rows[i + 1].cap - rows[i + 1].dur;
      rows[i].bufferAfter = acc;
      rows[i].bufferUsed = rows[i].cap - rows[i].dur;
    }
    initialBuffer = N >= 2 ? acc + rows[0].bufferUsed : finalSlack;
  }

  // 4) where are we now
  let phase;
  let cur = null;
  let next = null;
  if (!started) {
    phase = 'pre';
    cur = rows[0] ?? null;
    next = rows[1] ?? null;
  } else if (finished) {
    phase = 'finished';
  } else {
    phase = inPit ? 'pit' : 'stint';
    cur = rows[st.stints.length - 1] ?? null;
    next = rows[st.stints.length] ?? null;
  }

  let pitIn = null;
  let pitOpen = null;
  let pitOpenBy = null;
  let fuelLeft = null;
  if (cur && (phase === 'pre' || phase === 'stint')) {
    fuelLeft = cur.cap - (now - cur.start);
    if (!cur.isFinal) {
      pitIn = cur.end;
      const byBuffer = cur.end - finalSlack;
      const byRule = cur.start + (cur.n === 1 ? open1 : 0);
      pitOpen = Math.max(byBuffer, byRule);
      pitOpenBy = byBuffer >= byRule ? 'buffer' : 'rule';
    }
  }

  const openSc = st.sc.find((p) => p.to == null);
  const curNumber = phase === 'pit' ? (cur?.n ?? 0) + 1 : (cur?.n ?? 1);

  return {
    T,
    S,
    P,
    k,
    D,
    now,
    remaining: Math.max(0, T - now),
    started,
    finished,
    paused: st.status === 'paused',
    phase,
    rows,
    cur,
    next,
    finalSlack,
    initialBuffer,
    pitIn,
    pitOpen,
    pitOpenBy,
    fuelLeft,
    stintElapsed: cur && phase === 'stint' ? now - cur.start : 0,
    pitElapsed: phase === 'pit' && last ? now - last.end : 0,
    stopsLeft: Math.max(0, N - curNumber),
    stintCount: N,
    scActive: !!openSc,
    scElapsed: openSc ? now - openSc.from : 0,
    scTotal: overlap(st.sc, 0, now, now),
    driverNames: set.driverNames,
  };
}

/** The plan a fresh race with these settings would get. */
export function previewPlan(settings) {
  return compute({ settings, state: newState() }, 0);
}

// ---------------------------------------------------------------- actions
// Each mutates race.state in place; the store snapshots before calling.

export function actStart(race, nowWall) {
  const c = compute(race, nowWall);
  const st = race.state;
  const first = c.rows[0];
  Object.assign(st, {
    status: 'running',
    startedAt: nowWall,
    pauses: [],
    finishedAt: null,
    sc: [],
    stints: [{ start: 0, end: null, driver: first?.driver ?? 0, planDur: first?.plannedDur ?? null }],
  });
}

export function actPause(race, nowWall) {
  const st = race.state;
  if (st.status !== 'running') return;
  st.pauses.push({ from: nowWall, to: null });
  st.status = 'paused';
}

export function actResume(race, nowWall) {
  const st = race.state;
  if (st.status !== 'paused') return;
  const p = st.pauses[st.pauses.length - 1];
  if (p && p.to == null) p.to = nowWall;
  st.status = 'running';
}

export function actPitIn(race, nowWall) {
  const now = raceNow(race, nowWall);
  const a = race.state.stints[race.state.stints.length - 1];
  if (!a || a.end != null) return;
  a.end = Math.max(a.start, now);
}

export function actPitOut(race, nowWall) {
  const c = compute(race, nowWall);
  const st = race.state;
  const last = st.stints[st.stints.length - 1];
  if (!last || last.end == null) return;
  st.stints.push({
    start: Math.max(c.now, last.end),
    end: null,
    driver: c.next?.driver ?? (last.driver + 1) % c.D,
    planDur: c.next?.plannedDur ?? null,
  });
}

export function actSafetyCar(race, nowWall) {
  const now = raceNow(race, nowWall);
  const open = race.state.sc.find((p) => p.to == null);
  if (open) open.to = Math.max(open.from, now);
  else race.state.sc.push({ from: now, to: null });
}

export function actFinish(race, nowWall, atSec) {
  const st = race.state;
  const now = atSec ?? raceNow(race, nowWall);
  const a = st.stints[st.stints.length - 1];
  if (a && a.end == null) a.end = Math.max(a.start, now);
  st.sc.forEach((p) => {
    if (p.to == null) p.to = Math.max(p.from, now);
  });
  st.pauses.forEach((p) => {
    if (p.to == null) p.to = nowWall;
  });
  st.status = 'finished';
  st.finishedAt = now;
}

/** Re-align the race clock so that elapsed time equals `elapsedSec` now. */
export function actSyncClock(race, nowWall, elapsedSec) {
  const st = race.state;
  st.startedAt = nowWall - pausedMs(st, nowWall) - elapsedSec * 1000;
}

/**
 * Validate an edit from the stint modal. `patch` may hold
 * start / end / dur / pit (race seconds, dur & pit may be null = back to auto)
 * and driver. Returns an error message or null.
 */
export function validateEdit(race, nowWall, n, patch) {
  const st = race.state;
  const a = st.stints[n - 1];
  const now = raceNow(race, nowWall);
  if (patch.dur != null && !(patch.dur >= 60)) return 'Stint must be at least 1 minute.';
  if (patch.pit != null && !(patch.pit >= 0)) return 'Pit stop can’t be negative.';
  if (a) {
    const prev = st.stints[n - 2];
    const nxt = st.stints[n];
    const start = patch.start ?? a.start;
    const end = patch.end ?? a.end;
    if (n === 1 && patch.start != null && Math.abs(patch.start) > 0.5)
      return 'Stint 1 starts with the race — adjust the race clock instead.';
    if (prev && start < prev.end) return 'Start can’t be before the previous pit-in.';
    if (start > now + 0.5) return 'Start can’t be in the future.';
    if (end != null) {
      if (end < start) return 'Pit-in can’t be before the stint start.';
      if (nxt && end > nxt.start) return 'Pit-in can’t be after the next stint started.';
      if (!nxt && end > now + 0.5) return 'Pit-in can’t be in the future.';
    }
  }
  return null;
}

export function actEditStint(race, nowWall, n, patch) {
  const st = race.state;
  st.plan = st.plan || {};
  const a = st.stints[n - 1];
  const o = { ...(st.plan[n] || {}) };
  const setOv = (key, v) => {
    if (v == null) delete o[key];
    else o[key] = v;
  };
  if (a) {
    if ('start' in patch && patch.start != null && n > 1) a.start = patch.start;
    if ('end' in patch && patch.end != null && a.end != null) a.end = patch.end;
    if ('dur' in patch && a.end == null) setOv('dur', patch.dur);
    if ('driver' in patch && patch.driver != null) a.driver = patch.driver;
  } else {
    if ('dur' in patch) setOv('dur', patch.dur);
    if ('pit' in patch) setOv('pit', patch.pit);
    if ('driver' in patch) setOv('driver', patch.driver);
  }
  if (Object.keys(o).length) st.plan[n] = o;
  else delete st.plan[n];
}

// ---------------------------------------------------------------- stats

export function raceStats(race) {
  const set = normalizeSettings(race.settings);
  const c = compute(race, Date.now());
  const st = race.state;
  const P = set.pitStopMin * 60;
  const done = c.rows.filter((r) => r.status !== 'planned');
  const pits = [];
  for (let i = 1; i < st.stints.length; i++) {
    pits.push({ after: i, dur: st.stints[i].start - st.stints[i - 1].end, planned: P });
  }
  const drivers = set.driverNames.map((name, i) => ({ i, name, time: 0, stints: 0, longest: 0 }));
  for (const r of done) {
    const d = drivers[r.driver] || (drivers[r.driver] = { i: r.driver, name: `Driver ${r.driver + 1}`, time: 0, stints: 0, longest: 0 });
    d.time += r.dur;
    d.stints += 1;
    d.longest = Math.max(d.longest, r.dur);
  }
  const pitTotal = pits.reduce((s, p) => s + p.dur, 0);
  return {
    settings: set,
    c,
    stints: done,
    pits,
    drivers: drivers.filter(Boolean),
    driveTotal: done.reduce((s, r) => s + r.dur, 0),
    pitTotal,
    pitAvg: pits.length ? pitTotal / pits.length : 0,
    pitMin: pits.length ? Math.min(...pits.map((p) => p.dur)) : 0,
    pitMax: pits.length ? Math.max(...pits.map((p) => p.dur)) : 0,
    scTotal: c.scTotal,
    scCount: st.sc.length,
    baseline: previewPlan(set),
  };
}
