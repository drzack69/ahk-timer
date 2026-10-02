// Race monitor: live timers, current stint, pit window, PIT IN / SAFETY CAR / PIT OUT,
// the editable stint sheet, undo, pause and clock sync.

import * as store from '../store.js';
import { compute, wallAt, raceAt, actEditStint, validateEdit } from '../engine.js';
import { icon } from '../icons.js';
import { esc, digits, setHTML, setText, openModal, confirmDialog, toast } from '../ui.js';
import { hms, mmss, countdown, mins, clock, raceRel, parseDuration, parseTimeOfDay, parseHms } from '../format.js';
import { timelineHTML } from '../timeline.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export function MonitorView({ view, bottom, raceId, go }) {
  const id = raceId;
  let race = store.get(id);
  let timeMode = store.prefs().timeMode === 'race' ? 'race' : 'clock';
  let lastActive = null;
  let wakeLock = null;
  let wakePending = false;
  let destroyed = false;
  let locked = !!store.prefs().locked; // view-only on this device
  let finishedBefore = null;
  let seenOp; // newest event already shown, to announce other devices' events
  const lastAct = {};
  const release = store.open(id); // load and follow this race's events

  view.innerHTML = `
    <div class="monitor">
      <section class="panel m-time" data-ref="time" title="Click to adjust the race clock">
        <div class="tcell"><span class="lbl">Time elapsed</span><span class="big" data-ref="elapsed"></span></div>
        <div class="center" data-ref="badges"></div>
        <div class="tcell right"><span class="lbl">Time left</span><span class="big" data-ref="left"></span></div>
        <div data-ref="tl" style="grid-column:1/-1"></div>
      </section>

      <section class="panel m-stint">
        <div class="head" data-ref="stintHead"></div>
        <div class="huge" data-ref="stintClock"></div>
        <div class="fuel" data-ref="fuel"></div>
        <div class="stint-meta" data-ref="stintMeta"></div>
      </section>

      <section class="panel m-pit">
        <div class="pitrow"><span class="lbl" data-ref="p1l"></span><span class="val" data-ref="p1v"></span><div class="side" data-ref="p1s"></div></div>
        <div class="pitrow"><span class="lbl" data-ref="p2l"></span><span class="val" data-ref="p2v"></span><div class="side" data-ref="p2s"></div></div>
      </section>

      <section class="m-actions">
        <button class="act" data-act="pitin" data-ref="aIn">${icon('pitIn')}<div><div class="t">PIT IN</div><div class="s" data-ref="aInS"></div></div></button>
        <button class="act" data-act="sc" data-ref="aSc">${icon('car')}<div><div class="t">SAFETY CAR</div><div class="s" data-ref="aScS"></div></div></button>
        <button class="act" data-act="pitout" data-ref="aOut">${icon('pitOut')}<div><div class="t">PIT OUT</div><div class="s" data-ref="aOutS"></div></div></button>
      </section>

      <section class="panel m-sheet">
        <div class="sheet-head">
          <h3>Stint sheet</h3>
          <span data-ref="sheetChips" style="display:flex;gap:6px;flex-wrap:wrap"></span>
          <span class="grow"></span>
          <div class="seg" role="group" aria-label="Time display">
            <button data-mode="clock">Clock</button><button data-mode="race">Race time</button>
          </div>
        </div>
        <div class="sheet-scroll" data-ref="scroll">
          <table class="stints">
            <thead><tr><th>Stint</th><th>Start</th><th>Duration</th><th>End</th><th>Buffer left</th></tr></thead>
            <tbody data-ref="tbody"></tbody>
          </table>
        </div>
      </section>
    </div>`;

  bottom.innerHTML = `
    <button class="btn-icon" data-act="close" title="Close race" aria-label="Close race">${icon('close')}</button>
    <button class="btn" data-act="undo" data-ref="undo" title="Undo the last change">${icon('undo')}<span class="txt">Undo</span><small class="undo-label" data-ref="undoLabel"></small></button>
    <span class="status-line" data-ref="statusLine"></span>
    <span class="spacer"></span>
    <button class="btn-icon" data-act="lock" data-ref="lock"></button>
    <button class="btn" data-act="pause" data-ref="pause"></button>
    <button class="btn go" data-act="primary" data-ref="primary"></button>`;

  const ref = {};
  for (const el of [...view.querySelectorAll('[data-ref]'), ...bottom.querySelectorAll('[data-ref]')]) ref[el.dataset.ref] = el;

  // ---------------------------------------------------------------- helpers

  const driverName = (c, i) => c.driverNames[i] ?? `Driver ${i + 1}`;
  const useClock = (c) => timeMode === 'clock' && c.started;
  const fmtT = (c, sec, nowWall) => (useClock(c) ? clock(wallAt(race, sec, nowWall)) : raceRel(sec));

  /** Parse a time typed in the current display mode back to race seconds. */
  function parseT(c, str, refSec, nowWall) {
    if (!useClock(c)) return parseHms(str);
    const sod = parseTimeOfDay(str);
    if (Number.isNaN(sod)) return NaN;
    const refWall = wallAt(race, refSec, nowWall);
    const ref = new Date(refWall);
    const [h, mi, s] = [Math.floor(sod / 3600), Math.floor(sod / 60) % 60, sod % 60];
    // Build each candidate from calendar fields so daylight-saving days stay correct.
    const candidates = [-1, 0, 1].map((k) => new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + k, h, mi, s).getTime());
    const best = candidates.reduce((a, b) => (Math.abs(b - refWall) < Math.abs(a - refWall) ? b : a));
    return raceAt(race, best, nowWall);
  }

  async function keepAwake(on) {
    if (wakePending) return;
    wakePending = true;
    try {
      if (on && !destroyed && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
        if (destroyed) await wakeLock.release();
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      /* wake lock is best effort */
    } finally {
      wakePending = false;
    }
  }

  // ---------------------------------------------------------------- paint

  function rowHTML(r, c, nowWall) {
    const durTags = [];
    if (r.sc > 1 && r.status !== 'planned') durTags.push(`<span class="tag sc" title="Range added by safety car">SC +${mins(r.sc * (1 - c.k))}</span>`);
    if (r.status === 'active' && c.now > r.start + r.cap) durTags.push('<span class="tag crit">OVER</span>');
    if (r.overridden) durTags.push(`<span class="tag pin" title="Duration set manually">${icon('edit')}</span>`);
    if (r.isFinal && r.status !== 'done') durTags.push('<span class="tag fin" title="Runs to the flag">FINAL</span>');
    let bufTag = '';
    const used = r.bufferUsed;
    if (used != null && Math.abs(used) >= 30 && (r.status === 'done' || r.overridden)) {
      bufTag = used > 0
        ? `<span class="tag used" title="Buffer used by this stint">−${mins(used)}</span>`
        : `<span class="tag gain" title="Ran longer than the planned range">+${mins(-used)}</span>`;
    }
    return `<tr class="${r.status}" data-n="${r.n}">
      <td data-f="driver"><div class="cell-no"><span class="n">${r.n}</span><span class="who">${esc(driverName(c, r.driver))}</span></div></td>
      <td data-f="start">${fmtT(c, r.start, nowWall)}</td>
      <td data-f="dur">${mins(r.dur)}${durTags.join('')}</td>
      <td data-f="end">${fmtT(c, r.end, nowWall)}</td>
      <td data-f="buffer">${mins(r.bufferAfter)}${bufTag}</td>
    </tr>`;
  }

  function paint(c, nowWall) {
    const st = race.state;
    const t = (sec) => fmtT(c, sec, nowWall);

    // time bar
    setHTML(ref.elapsed, digits(hms(c.now)));
    setHTML(ref.left, digits(hms(c.remaining)));
    const badges = [];
    if (!c.started) badges.push('<span class="chip ghost">Pre-race</span>');
    else if (c.finished) badges.push(`<span class="chip done">${icon('flag')} Finished</span>`);
    else if (c.paused) badges.push(`<span class="chip sc">${icon('pause')} Paused</span>`);
    else badges.push('<span class="chip live">Live</span>');
    if (c.scActive) badges.push(`<span class="chip sc">${icon('car')} SC ${mmss(c.scElapsed)}</span>`);
    if (!race.synced) badges.push('<span class="chip ghost">Syncing…</span>');
    if (locked) badges.push(`<span class="chip ghost">${icon('lock')} View only</span>`);
    setHTML(ref.badges, badges.join(''));
    const win = (c.phase === 'stint' || c.phase === 'pre') && c.pitOpen != null ? [c.pitOpen, c.pitIn] : null;
    setHTML(ref.tl, timelineHTML(c, { sc: st.sc, head: c.started ? c.now : null, win }));

    // current stint panel + pit panel
    const cur = c.cur;
    let head = '';
    let big = '';
    let fuel = '';
    let meta = '';
    let p1 = ['', '', ''];
    let p2 = ['', '', ''];
    const fuelBar = (start, span, elapsed, open, pin, over) => {
      const pct = (x) => Math.max(0, Math.min(100, ((x - start) / span) * 100));
      const fill = Math.max(0, Math.min(100, (elapsed / span) * 100));
      return `<div class="fill${over ? ' over' : ''}" style="width:${fill.toFixed(2)}%"></div>
        ${open != null && pin != null ? `<div class="win" style="left:${pct(open).toFixed(2)}%;width:${Math.max(0, pct(pin) - pct(open)).toFixed(2)}%"></div>` : ''}
        ${pin != null ? `<div class="mk" style="left:${pct(pin).toFixed(2)}%"></div>` : ''}`;
    };

    if (c.phase === 'pre' || c.phase === 'stint') {
      const live = c.phase === 'stint';
      head = `<span class="lbl">Stint</span><span class="no">#${cur.n}</span>
        <span class="driver">${icon('wheel')}${esc(driverName(c, cur.driver))}</span>
        ${cur.isFinal ? `<span class="chip ghost">${icon('flag')} Final</span>` : ''}
        ${!live ? '<span class="chip ghost">Ready</span>' : ''}`;
      big = digits(hms(c.stintElapsed));
      const span = Math.max(cur.cap, cur.dur, 1);
      fuel = fuelBar(cur.start, span, c.stintElapsed, c.pitOpen, c.pitIn ?? (cur.isFinal ? cur.end : null), live && c.stintElapsed > cur.cap);
      meta = `<span>${live ? 'Fuel left ≈' : 'Planned'} <b>${live ? mins(c.fuelLeft) : mins(cur.dur)}</b></span>
        <span>Buffer <b>${mins(c.finalSlack)}</b></span>
        <span>Stops left <b>${c.stopsLeft}</b></span>
        ${cur.sc > 1 ? `<span>SC range <b>+${mins(cur.sc * (1 - c.k))}</b></span>` : ''}`;
      if (cur.isFinal) {
        p1 = ['Pit in', '—', `<span class="chip ghost">${icon('flag')} Final stint</span><span class="why">No stop needed — run to the flag</span>`];
        p2 = ['Finish', t(c.T), live ? `<span class="cd">in ${countdown(c.remaining)}</span>` : ''];
      } else {
        const toIn = c.pitIn - c.now;
        p1 = [
          'Pit in',
          t(c.pitIn),
          !live
            ? `<span class="cd">${mins(c.pitIn - cur.start)} after start</span>`
            : toIn >= 0
              ? `<span class="cd">in ${countdown(toIn)}</span>`
              : `<span class="chip crit">Box now</span><span class="cd">${countdown(toIn)}</span>`,
        ];
        const toOpen = c.pitOpen - c.now;
        const why = c.pitOpenBy === 'rule' ? 'Pit-open rule for stint 1' : 'Earliest stop without adding one';
        p2 = [
          'Pit open',
          t(c.pitOpen),
          (live && toOpen <= 0
            ? `<span class="chip ok">${icon('check')} Open</span>`
            : live
              ? `<span class="cd">opens in ${countdown(toOpen)}</span>`
              : `<span class="cd">${mins(c.pitOpen - cur.start)} after start</span>`) + `<span class="why">${why}</span>`,
        ];
      }
    } else if (c.phase === 'pit') {
      const nx = c.next;
      head = `<span class="lbl">In pit</span><span class="no">after #${cur.n}</span>
        ${nx ? `<span class="driver">${icon('wheel')}next: ${esc(driverName(c, nx.driver))}</span>` : ''}`;
      big = digits(hms(c.pitElapsed));
      fuel = fuelBar(0, Math.max(c.P, c.pitElapsed, 1), c.pitElapsed, null, c.P, c.pitElapsed > c.P);
      meta = `<span>Planned stop <b>${mins(c.P)}</b></span>
        <span>Stint #${cur.n} <b>${mins(cur.dur)}</b></span>
        <span>Buffer <b>${mins(c.finalSlack)}</b></span>`;
      const left = c.P - c.pitElapsed;
      p1 = [
        'Pit out',
        nx ? t(nx.start) : '—',
        left >= 0 ? `<span class="cd">target in ${countdown(left)}</span>` : `<span class="chip crit">Long stop</span><span class="cd">${countdown(left)}</span>`,
      ];
      p2 = nx
        ? [nx.isFinal ? 'Finish' : 'Next pit in', t(nx.end), `<span class="cd">Stint #${nx.n} · ${mins(nx.dur)}</span>`]
        : ['Next pit in', '—', ''];
    } else {
      head = `<span class="lbl">Race</span><span class="no">Finished</span>`;
      big = digits(hms(c.now));
      fuel = fuelBar(0, 1, 1, null, null, false);
      meta = `<span>Stints <b>${c.stintCount}</b></span><span>Pit stops <b>${Math.max(0, st.stints.length - 1)}</b></span>
        <span>Unused buffer <b>${mins(c.finalSlack)}</b></span>`;
      p1 = ['Finished', t(c.now), `<span class="chip done">${icon('flag')} Flag</span>`];
      p2 = ['Safety car', mins(c.scTotal), `<span class="cd">${st.sc.length} period${st.sc.length === 1 ? '' : 's'}</span>`];
    }
    setHTML(ref.stintHead, head);
    setHTML(ref.stintClock, big);
    ref.stintClock.classList.toggle('pit', c.phase === 'pit');
    setHTML(ref.fuel, fuel);
    setHTML(ref.stintMeta, meta);
    setText(ref.p1l, p1[0]);
    setHTML(ref.p1v, digits(p1[1]));
    setHTML(ref.p1s, p1[2]);
    setText(ref.p2l, p2[0]);
    setHTML(ref.p2v, digits(p2[1]));
    setHTML(ref.p2s, p2[2]);

    // action buttons
    const canAct = race.synced && !locked;
    const onTrack = c.phase === 'stint';
    const finalStint = onTrack && cur?.isFinal;
    ref.aIn.disabled = !onTrack || !canAct;
    ref.aIn.classList.toggle('ready', onTrack && !finalStint && canAct);
    ref.aIn.classList.toggle('urgent', onTrack && !finalStint && canAct && c.pitIn != null && c.now >= c.pitIn - 60);
    setText(ref.aInS, !onTrack ? (c.phase === 'pit' ? 'Car in the pit' : 'Ends the stint')
      : finalStint ? 'Final stint'
      : c.now > c.pitIn ? `Box now ${countdown(c.pitIn - c.now)}`
      : `Planned ${t(c.pitIn)}`);
    const canSc = c.started && !c.finished;
    ref.aSc.disabled = !canSc || !canAct;
    ref.aSc.classList.toggle('sc-on', c.scActive);
    setText(ref.aScS, c.scActive ? `Out ${mmss(c.scElapsed)} · tap to end` : `Fuel ×${c.k.toFixed(2)} under SC`);
    const inPit = c.phase === 'pit';
    ref.aOut.disabled = !inPit || !canAct;
    ref.aOut.classList.toggle('ready', inPit && canAct);
    setText(ref.aOutS, inPit ? `In pit ${mmss(c.pitElapsed)}` : 'Starts next stint');

    // sheet
    const nowRows = c.rows.map((r) => rowHTML(r, c, nowWall)).join('');
    setHTML(ref.tbody, nowRows);
    const chips = [`<span class="chip">${c.stintCount} stints</span>`, `<span class="chip">Buffer ${mins(c.finalSlack)}</span>`];
    if (!c.started) chips.push('<span class="chip ghost">Times from start</span>');
    setHTML(ref.sheetChips, chips.join(''));
    for (const b of view.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === timeMode);
    const activeN = c.phase === 'stint' ? cur.n : c.phase === 'pit' ? cur.n + 1 : null;
    if (activeN !== lastActive) {
      lastActive = activeN;
      // Scroll only the sheet itself — never the page, so the timers stay in view.
      const row = ref.tbody.querySelector(`tr[data-n="${activeN}"]`);
      const box = ref.scroll;
      if (row && box.scrollHeight > box.clientHeight) {
        const top = row.offsetTop - 40;
        if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) {
          box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
      }
    }

    // bottom bar
    const undoLabel = store.lastStep(id);
    ref.undo.disabled = !undoLabel || !canAct;
    setHTML(ref.lock, icon(locked ? 'lock' : 'unlock'));
    ref.lock.classList.toggle('on', locked);
    ref.lock.title = locked ? 'View only — tap to unlock the controls on this device' : 'Lock the controls on this device (view only)';
    ref.lock.setAttribute('aria-label', ref.lock.title);
    setText(ref.undoLabel, undoLabel || '');
    let status = '';
    if (c.phase === 'pre') status = `${c.stintCount} stints planned · buffer ${mins(c.finalSlack)}`;
    else if (c.phase === 'stint') status = `Stint ${cur.n} of ${c.stintCount} · ${driverName(c, cur.driver)}`;
    else if (c.phase === 'pit') status = `Pit stop ${cur.n} of ${c.stintCount - 1}`;
    else status = 'Race complete';
    setText(ref.statusLine, status);
    setHTML(ref.pause, c.paused ? `${icon('play')}<span class="txt">Resume</span>` : `${icon('pause')}<span class="txt">Pause</span>`);
    ref.pause.disabled = !c.started || c.finished || !canAct;
    ref.pause.classList.toggle('primary', c.paused);
    ref.primary.className = 'btn go';
    ref.primary.disabled = !canAct && !c.finished;
    if (!c.started) {
      ref.primary.classList.add('primary');
      setHTML(ref.primary, `${icon('play')} START`);
    } else if (c.finished) {
      ref.primary.classList.add('primary');
      setHTML(ref.primary, `${icon('stats')} <span class="txt">Statistics</span>`);
    } else {
      setHTML(ref.primary, `${icon('flag')} <span class="txt">Finish</span>`);
    }
  }

  // ---------------------------------------------------------------- tick

  function tick() {
    if (destroyed) return;
    race = store.get(id);
    if (!race) return go('#/races');
    const nowWall = Date.now();
    const c = compute(race, nowWall);
    if (finishedBefore === false && c.finished) toast('Chequered flag — race finished', 'ok', 4000);
    finishedBefore = c.finished;
    announceRemote();
    paint(c, nowWall);
    keepAwake(c.started && !c.finished);
  }

  // Tell this device when someone else records an event.
  function announceRemote() {
    if (!race.synced) return;
    const n = store.newestOp(id);
    const key = n?.op.id ?? null;
    if (seenOp === undefined || key === seenOp) {
      seenOp = key;
      return;
    }
    seenOp = key;
    if (n && n.op.dev && n.op.dev !== store.device()) toast(`${n.label} · ${n.op.by || 'another device'}`);
  }

  // ---------------------------------------------------------------- actions

  /** Record an event for this race. */
  function send(type, args) {
    if (locked) {
      toast('Controls are locked on this device — tap the lock to unlock.');
      return false;
    }
    if (!store.dispatch(id, type, args)) {
      toast('Still syncing this race — try again in a moment.');
      return false;
    }
    tick();
    return true;
  }

  function doAction(act) {
    const nowWall = Date.now();
    if (['primary', 'pitin', 'pitout', 'sc', 'pause'].includes(act)) {
      if (nowWall - (lastAct[act] || 0) < 700) return; // accidental double tap
      lastAct[act] = nowWall;
    }
    const c = compute(race, nowWall);
    switch (act) {
      case 'pitin': {
        if (c.phase !== 'stint' || !send('pitIn')) return;
        const row = compute(store.get(id), Date.now()).rows[c.cur.n - 1];
        const used = row.bufferUsed;
        toast(`Pit in · stint ${row.n}: ${mins(row.dur)}${used > 30 ? ` · used ${mins(used)} buffer` : ''}`);
        return;
      }
      case 'pitout': {
        if (c.phase !== 'pit' || !send('pitOut')) return;
        const c2 = compute(store.get(id), Date.now());
        if (c2.cur) toast(`Stint ${c2.cur.n} · ${driverName(c2, c2.cur.driver)} · stop ${mmss(c.pitElapsed)}`);
        return;
      }
      case 'sc': {
        if (!c.started || c.finished) return;
        const on = !c.scActive;
        if (!send(on ? 'scOn' : 'scOff')) return;
        toast(on ? 'Safety car deployed — stint range extending' : `Safety car in · ${mmss(c.scElapsed)}`);
        return;
      }
      case 'pause':
        if (c.paused) {
          if (send('resume')) toast('Race clock running');
        } else if (c.started && !c.finished) {
          if (send('pause')) toast('Race clock paused');
        }
        return;
      case 'primary':
        if (!c.started) {
          if (send('start')) toast('Green flag — race clock running', 'ok');
        } else if (c.finished) go(`#/race/${id}/stats`);
        else
          confirmDialog({
            title: 'Finish the race now?',
            message: `The race clock stops at <b>${hms(c.now)}</b> and the current stint is closed. You can undo this.`,
            confirm: 'Finish race',
          }).then((ok) => {
            if (ok && send('finish')) toast('Race finished', 'ok');
          });
        return;
      case 'undo': {
        if (locked) return send('undo'); // shows the lock hint
        const label = store.undo(id);
        if (label) toast(`Undone: ${label}`);
        tick();
        return;
      }
      case 'lock':
        locked = !locked;
        store.setPref('locked', locked);
        toast(locked ? 'View only — controls locked on this device' : 'Controls unlocked on this device');
        tick();
        return;
      case 'close':
        go('#/races');
    }
  }

  // ---------------------------------------------------------------- stint editor

  function openEditor(n, focus) {
    const nowWall = Date.now();
    const c = compute(race, nowWall);
    const r = c.rows.find((x) => x.n === n);
    if (!r) return;
    const prev = c.rows.find((x) => x.n === n - 1);
    const kind = r.status; // done | active | planned
    const canStart = n > 1 && kind !== 'pre';
    const showPit = kind === 'planned' && n > 1;
    const showUsed = kind !== 'done' && !r.isFinal;
    const t = (sec) => fmtT(c, sec, nowWall);
    const timeHint = useClock(c) ? 'HH:MM' : 'race time h:mm';
    const d = { start: r.start, dur: r.dur, pit: r.pitBefore, driver: r.driver, auto: false };
    const touched = new Set();

    const durHint = kind === 'done' ? 'Actual stint time' : r.isFinal ? 'Runs to the flag — shorter adds a stop' : `Range ${mins(r.cap)}`;
    const body = `
      <div class="edit-grid">
        <div class="field full">
          <span class="field-label">Driver</span>
          <div class="drivers-pick">${c.driverNames
            .map((nm, i) => `<button type="button" data-driver="${i}" class="${i === d.driver ? 'on' : ''}">${esc(nm)}</button>`)
            .join('')}</div>
        </div>
        <label class="field"><span class="field-label">Start</span>
          <input class="input" data-in="start" value="${t(r.start)}" ${canStart ? '' : 'disabled'} inputmode="numeric" autocomplete="off">
          <span class="hint">${canStart ? (kind === 'planned' ? `${timeHint} · moves the pit stop before` : `${timeHint} · actual pit-out`) : 'Race start'}</span></label>
        ${
          showPit
            ? `<label class="field"><span class="field-label">Pit stop before</span>
                <input class="input" data-in="pit" value="${mmss(r.pitBefore)}" inputmode="decimal" autocomplete="off">
                <span class="hint">minutes (e.g. 5 or 5:30)</span></label>`
            : `<div class="field"><span class="field-label">${kind === 'done' ? 'Status' : 'Range'}</span>
                <div class="input" style="display:flex;align-items:center;color:var(--ink-2)">${kind === 'done' ? 'Completed' : mins(r.cap)}</div>
                <span class="hint">${kind === 'done' ? 'Edit times to correct mistakes' : 'Max stint incl. safety car'}</span></div>`
        }
        <label class="field"><span class="field-label">Duration</span>
          <input class="input" data-in="dur" value="${mmss(r.dur)}" inputmode="decimal" autocomplete="off">
          <span class="hint">${durHint}</span></label>
        <label class="field"><span class="field-label">${kind === 'done' ? 'Pit in' : 'End'}</span>
          <input class="input" data-in="end" value="${t(r.end)}" inputmode="numeric" autocomplete="off">
          <span class="hint">${timeHint}</span></label>
        ${
          showUsed
            ? `<label class="field full"><span class="field-label">Buffer used by this stint</span>
                <input class="input" data-in="used" value="${mmss(Math.max(0, r.cap - r.dur))}" inputmode="decimal" autocomplete="off">
                <div class="quick">
                  <button type="button" data-q="-5">−5′</button><button type="button" data-q="-1">−1′</button>
                  <button type="button" data-q="1">+1′</button><button type="button" data-q="5">+5′</button>
                  <button type="button" data-q="max" class="max">Full range</button>
                </div></label>`
            : ''
        }
      </div>
      <div class="impact" data-impact></div>
      <div class="form-error" data-err role="alert"></div>`;

    const hasOverride = kind !== 'done' && !!race.state.plan?.[n];
    const m = openModal({
      title: `Stint #${n}${kind === 'active' ? ' · on track' : kind === 'done' ? ' · completed' : ''}`,
      body,
      footer: `${hasOverride ? '<button class="btn ghost left" data-reset>Reset to plan</button>' : ''}
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" data-apply>Apply</button>`,
    });
    const el = m.el;
    const inp = (k) => el.querySelector(`[data-in="${k}"]`);
    const err = el.querySelector('[data-err]');

    function patch() {
      const p = {};
      if (touched.has('driver')) p.driver = d.driver;
      const toFlag = r.isFinal && d.dur >= r.dur - 0.5; // still runs to the flag → keep it automatic
      if (kind === 'planned') {
        if (touched.has('dur')) p.dur = d.auto || toFlag ? null : d.dur;
        if (touched.has('start') || touched.has('pit')) p.pit = d.pit;
      } else if (kind === 'active') {
        if (touched.has('start')) p.start = d.start;
        if (touched.has('dur')) p.dur = d.auto || toFlag ? null : d.dur;
      } else {
        if (touched.has('start')) p.start = d.start;
        if (touched.has('dur') || touched.has('start')) p.end = d.start + d.dur;
      }
      return p;
    }

    function sync(except) {
      if (except !== 'start' && inp('start')) inp('start').value = t(d.start);
      if (except !== 'pit' && inp('pit')) inp('pit').value = mmss(d.pit);
      if (except !== 'dur') inp('dur').value = mmss(d.dur);
      if (except !== 'end') inp('end').value = t(d.start + d.dur);
      if (except !== 'used' && inp('used')) inp('used').value = mmss(Math.max(0, r.cap - d.dur));
      for (const b of el.querySelectorAll('[data-driver]')) b.classList.toggle('on', +b.dataset.driver === d.driver);
      impact();
    }

    function impact() {
      const p = patch();
      const msg = validateEdit(race, Date.now(), n, p);
      err.textContent = msg || '';
      const box = el.querySelector('[data-impact]');
      if (msg) {
        box.innerHTML = '';
        return;
      }
      const trial = clone(race);
      actEditStint(trial, Date.now(), n, p);
      const c2 = compute(trial, Date.now());
      const extra = c2.stintCount - c.stintCount;
      box.innerHTML = `
        <div class="row"><span>Buffer left</span><span><b>${mins(c.finalSlack)}</b><span class="arrow">→</span><b>${mins(c2.finalSlack)}</b></span></div>
        <div class="row"><span>Stints</span><span><b>${c.stintCount}</b><span class="arrow">→</span><b>${c2.stintCount}</b></span></div>
        ${extra > 0 ? `<div class="warn-line">${icon('warn')} Uses more than the buffer — adds ${extra} pit stop${extra > 1 ? 's' : ''}</div>` : ''}
        ${extra < 0 ? `<div class="warn-line" style="color:#7ee07e">${icon('check')} Saves ${-extra} pit stop${extra < -1 ? 's' : ''}</div>` : ''}`;
    }

    el.addEventListener('input', (e) => {
      const k = e.target.dataset.in;
      if (!k) return;
      const v = e.target.value;
      const nowW = Date.now();
      let ok = true;
      if (k === 'start') {
        const s = parseT(c, v, r.start, nowW);
        ok = Number.isFinite(s);
        if (ok) {
          const end = d.start + d.dur;
          d.start = s;
          if (kind === 'planned') d.pit = prev ? s - prev.end : 0;
          if (kind === 'done') d.dur = end - s; // keep the (possibly edited) pit-in
          touched.add('start');
        }
      } else if (k === 'pit') {
        const p = parseDuration(v);
        ok = Number.isFinite(p);
        if (ok) {
          d.pit = p;
          d.start = (prev ? prev.end : 0) + p;
          touched.add('pit');
        }
      } else if (k === 'dur' || k === 'used') {
        const x = parseDuration(v);
        ok = Number.isFinite(x);
        if (ok) {
          d.dur = k === 'dur' ? x : r.cap - x;
          d.auto = false;
          touched.add('dur');
        }
      } else if (k === 'end') {
        const e2 = parseT(c, v, r.end, nowW);
        ok = Number.isFinite(e2);
        if (ok) {
          d.dur = e2 - d.start;
          d.auto = false;
          touched.add('dur');
        }
      }
      e.target.classList.toggle('invalid', !ok);
      if (ok) sync(k);
    });

    el.addEventListener('click', (e) => {
      const drv = e.target.closest('[data-driver]');
      if (drv) {
        d.driver = +drv.dataset.driver;
        touched.add('driver');
        sync();
        return;
      }
      const q = e.target.closest('[data-q]');
      if (q) {
        if (q.dataset.q === 'max') {
          d.dur = r.cap;
          d.auto = true;
        } else {
          // quick buttons adjust the buffer used (shorter stint = more buffer used)
          d.dur = Math.min(r.cap, Math.max(60, d.dur - parseFloat(q.dataset.q) * 60));
          d.auto = false;
        }
        touched.add('dur');
        sync();
        return;
      }
      if (e.target.closest('[data-reset]')) {
        if (send('reset', { n })) m.close();
        return;
      }
      if (e.target.closest('[data-apply]')) apply();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input')) apply();
    });

    function apply() {
      const p = patch();
      if (!Object.keys(p).length) return m.close();
      const msg = validateEdit(race, Date.now(), n, p);
      if (msg) {
        err.textContent = msg;
        return;
      }
      if (!send('edit', { n, patch: p })) return;
      m.close();
      toast(`Stint ${n} updated`);
    }

    impact();
    const target = { start: 'start', dur: 'dur', end: 'end', buffer: 'used' }[focus];
    setTimeout(() => {
      const f = target && inp(target);
      if (f && !f.disabled) {
        f.focus();
        f.select();
      }
    }, 40);
  }

  // ---------------------------------------------------------------- clock sync

  function openClockSync() {
    const c = compute(race, Date.now());
    if (!['running', 'paused'].includes(race.state.status)) {
      toast(c.started ? 'The race is finished.' : 'Start the race first — the clock syncs once it runs.');
      return;
    }
    if (locked || !race.synced) {
      send('sync'); // explains why not
      return;
    }
    let offset = 0;
    const m = openModal({
      title: 'Adjust race clock',
      className: 'modal-sm',
      body: `
        <p class="modal-text" style="margin-bottom:16px">${
          c.autoFinished
            ? 'The race clock has reached the flag. If the official clock was stopped (red flag), type the real time left to carry on.'
            : 'Match the official timing screen. Nudge the clock or type the exact time left.'
        }</p>
        <div class="impact" style="margin-top:0">
          <div class="row"><span>Time elapsed</span><b data-v="el"></b></div>
          <div class="row"><span>Time left</span><b data-v="left"></b></div>
          <div class="row"><span>Adjustment</span><b data-v="off">0 s</b></div>
        </div>
        <div class="quick" style="margin:14px 0 18px">
          ${[-60, -10, -1, 1, 10, 60].map((s) => `<button type="button" data-nudge="${s}">${s > 0 ? '+' : '−'}${Math.abs(s) >= 60 ? `${Math.abs(s) / 60} min` : `${Math.abs(s)} s`}</button>`).join('')}
        </div>
        <label class="field"><span class="field-label">Or set time left exactly</span>
          <input class="input num" data-left placeholder="h:mm:ss" inputmode="numeric" autocomplete="off">
          <span class="hint">Applied at the moment you press Apply</span></label>
        <div class="form-error" data-err></div>`,
      footer: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-apply>Apply</button>',
      onClose: () => clearInterval(timer),
    });
    const el = m.el;
    const show = () => {
      const cc = compute(race, Date.now());
      const e = Math.min(cc.T, Math.max(0, cc.now + offset));
      el.querySelector('[data-v="el"]').textContent = hms(e);
      el.querySelector('[data-v="left"]').textContent = hms(cc.T - e);
      el.querySelector('[data-v="off"]').textContent = `${offset > 0 ? '+' : offset < 0 ? '−' : ''}${mmss(Math.abs(offset))}`;
    };
    const timer = setInterval(show, 250);
    show();
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nudge]');
      if (b) {
        offset += +b.dataset.nudge;
        show();
      }
      if (e.target.closest('[data-apply]')) {
        const nowW = Date.now();
        const cc = compute(race, nowW);
        const raw = el.querySelector('[data-left]').value.trim();
        let target = cc.now + offset;
        if (raw) {
          const left = parseHms(raw.split(':').length === 2 ? `0:${raw}` : raw);
          if (!Number.isFinite(left)) {
            el.querySelector('[data-err]').textContent = 'Use h:mm:ss, e.g. 4:35:10';
            return;
          }
          target = cc.T - left;
        }
        if (!send('sync', { elapsed: Math.min(cc.T, Math.max(0, Math.round(target))) })) return;
        m.close();
        toast('Race clock adjusted');
      }
    });
  }

  // ---------------------------------------------------------------- events

  view.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) return doAction(act);
    const mode = e.target.closest('[data-mode]')?.dataset.mode;
    if (mode) {
      timeMode = mode;
      store.setPref('timeMode', mode);
      return tick();
    }
    const td = e.target.closest('td[data-f]');
    if (td) {
      if (locked || !race.synced) return send('edit'); // explains why not
      return openEditor(+td.parentElement.dataset.n, td.dataset.f);
    }
    if (e.target.closest('[data-ref="time"]')) openClockSync();
  });
  bottom.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) doAction(act);
  });
  const onVisible = () => document.visibilityState === 'visible' && tick();
  document.addEventListener('visibilitychange', onVisible);

  const timer = setInterval(tick, 250);
  const unsub = store.subscribe(() => tick());
  tick();

  return {
    destroy() {
      destroyed = true;
      release();
      clearInterval(timer);
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
      keepAwake(false);
    },
  };
}
