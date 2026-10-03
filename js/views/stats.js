// Post-race statistics: KPI tiles, race timeline, stint and pit-stop charts,
// driving time per driver and the full stint log (the table view of the charts).

import * as store from '../store.js';
import { raceStats, wallAt } from '../engine.js';
import { icon } from '../icons.js';
import { esc, statusOf } from '../ui.js';
import { hms, mins, clock, raceRel, dateLabel, hoursLabel } from '../format.js';
import { timelineHTML } from '../timeline.js';

/** Clean axis ticks in seconds, on minute steps. */
function niceTicks(maxSec) {
  const steps = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  const step = steps.find((s) => maxSec / s <= 5) ?? 14400;
  const top = Math.max(step, Math.ceil(maxSec / step) * step);
  const ticks = [];
  for (let v = 0; v <= top + 0.1; v += step) ticks.push(v);
  return { ticks, top };
}

const tickLabel = (sec, top) => (top > 3 * 3600 ? `${Math.round((sec / 3600) * 10) / 10}h` : `${Math.round(sec / 60)}′`);

function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}

/**
 * Column chart, one series. Optional per-column `plan` tick and a reference line.
 * items: [{ label, value, plan?, tip }]
 */
function columnChart({ items, ref, refLabel, height = 230 }) {
  if (!items.length) return '<p class="muted">No data yet.</p>';
  const W = 640;
  const H = height;
  const padL = 40;
  const padR = 10;
  const padT = 14;
  const padB = 26;
  const maxV = Math.max(ref || 0, ...items.map((i) => Math.max(i.value, i.plan || 0)), 60);
  const { ticks, top } = niceTicks(maxV * 1.08);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const band = (W - padL - padR) / items.length;
  const bw = Math.max(4, Math.min(24, band * 0.56));
  const grid = ticks
    .map((t) => `<line class="${t === 0 ? 'axis' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>
      <text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${tickLabel(t, top)}</text>`)
    .join('');
  const marks = items
    .map((it, i) => {
      const cx = padL + band * i + band / 2;
      const top0 = y(it.value);
      const h = y(0) - top0;
      const plan = it.plan != null ? `<line class="plan" x1="${cx - bw / 2 - 4}" x2="${cx + bw / 2 + 4}" y1="${y(it.plan)}" y2="${y(it.plan)}"/>` : '';
      const showLabel = items.length <= 14;
      return `<g class="mark" data-tip="${esc(it.tip)}">
        <rect class="hit" x="${padL + band * i}" y="${padT}" width="${band}" height="${H - padT - padB}"/>
        <path class="bar${it.alt ? ' alt' : ''}" d="${barPath(cx - bw / 2, top0, bw, h)}"/>
        ${plan}
        ${showLabel ? `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>` : ''}
      </g>`;
    })
    .join('');
  const refLine = ref
    ? `<line class="ref" x1="${padL}" x2="${W - padR}" y1="${y(ref)}" y2="${y(ref)}"/>
       <text class="val" x="${W - padR}" y="${y(ref) - 6}" text-anchor="end">${esc(refLabel)}</text>`
    : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Column chart">${grid}${refLine}${marks}</svg>`;
}

function driverBars(drivers) {
  const max = Math.max(...drivers.map((d) => d.time), 1);
  return `<div style="display:grid;gap:14px">${drivers
    .map(
      (d) => `<div class="mark" data-tip="${esc(`${d.name} · ${hms(d.time)} · ${d.stints} stint${d.stints === 1 ? '' : 's'}`)}">
        <div style="display:flex;justify-content:space-between;gap:12px;font-weight:700;font-size:14px;margin-bottom:6px">
          <span>${esc(d.name)}</span><span class="muted num">${hms(d.time)} · ${d.stints} stint${d.stints === 1 ? '' : 's'}</span>
        </div>
        <div style="height:14px;border-radius:4px;background:rgba(255,255,255,.05)">
          <div style="height:100%;width:${((d.time / max) * 100).toFixed(1)}%;min-width:${d.time ? 4 : 0}px;border-radius:0 4px 4px 0;background:var(--accent)"></div>
        </div>
      </div>`,
    )
    .join('')}</div>`;
}

export function StatsView({ view, bottom, raceId, go }) {
  const release = store.open(raceId); // full event log for exact numbers
  let lastHTML = '';

  function render() {
    const race = store.get(raceId);
    if (!race) return go('#/races');
    const s = raceStats(race);
    const c = s.c;
    const st = statusOf(race);
    const started = race.state.startedAt != null;
    const timeMode = store.prefs().timeMode === 'race' ? 'race' : 'clock';
    const t = (sec) => (timeMode === 'clock' && started ? clock(wallAt(race, sec, Date.now())) : raceRel(sec));
    const name = (i) => s.settings.driverNames[i] ?? `Driver ${i + 1}`;

    const kpis = [
      ['Race time', hms(c.now), race.state.status === 'finished' ? `of ${hoursLabel(s.settings.raceLengthMin)}` : 'so far'],
      ['Stints', String(s.stints.length), `${s.baseline.stintCount} planned before start`],
      [
        'Pit stops',
        String(s.pits.length),
        s.otherStops
          ? `${s.refuelStops} refuel · ${s.otherStops} without fuel`
          : s.pits.length
            ? `avg ${mins(s.pitAvg)} · best ${mins(s.pitMin)}`
            : '—',
      ],
      ['Time in pits', mins(s.pitTotal), `planned ≈${mins(s.settings.pitStopMin * 60)} per stop`],
      ['Safety car', mins(s.scTotal), `${s.scCount} period${s.scCount === 1 ? '' : 's'}`],
      ['Buffer', `${mins(s.baseline.finalSlack)} → ${mins(c.finalSlack)}`, 'planned → unused at the flag'],
    ];

    const stintItems = s.stints.map((r) => ({
      label: `S${r.n}`,
      value: r.dur,
      plan: r.planDurAtStart,
      tip: `Stint ${r.n} · ${name(r.driver)} · ${mins(r.dur)}${r.planDurAtStart ? ` (planned ${mins(r.planDurAtStart)})` : ''}`,
    }));
    const pitItems = s.pits.map((p) => ({
      label: `P${p.after}`,
      value: p.dur,
      alt: !p.refuel,
      tip: `Pit stop ${p.after}${p.refuel ? '' : ' (no refuel)'} · ${mins(p.dur)}`,
    }));

    const log = s.stints
      .map((r, i) => {
        const pit = s.pits[i];
        const delta = r.planDurAtStart != null ? r.dur - r.planDurAtStart : null;
        return `<tr>
          <td>${r.n}</td>
          <td>${esc(name(r.driver))}</td>
          <td>${t(r.start)}</td>
          <td>${t(r.end)}</td>
          <td class="r">${mins(r.dur)}</td>
          <td class="r">${r.planDurAtStart != null ? mins(r.planDurAtStart) : '—'}</td>
          <td class="r">${delta == null ? '—' : `${delta >= 0 ? '+' : '−'}${mins(Math.abs(delta))}`}</td>
          <td class="r">${r.sc > 1 ? mins(r.sc) : '—'}</td>
          <td class="r">${pit ? `${mins(pit.dur)}${pit.refuel ? '' : ' · no refuel'}` : '—'}</td>
        </tr>`;
      })
      .join('');

    const html = `
      <div class="page">
        <div class="page-head">
          <div>
            <div class="stats-head"><h1>${esc(race.name)}</h1><span class="chip ${st.cls}">${st.label}</span></div>
            <p>${dateLabel(race.state.startedAt || race.createdAt)} · ${hoursLabel(s.settings.raceLengthMin)} · ${s.settings.maxStintMin}′ max stint · ${s.settings.drivers} drivers</p>
          </div>
        </div>
        ${!started ? '<div class="panel empty"><h2>No data yet</h2><p>Statistics appear once the race has started.</p></div>' : `
        <div class="kpis">${kpis
          .map(([l, v, d]) => `<div class="panel kpi"><div class="lbl">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`)
          .join('')}</div>
        <div class="stats-grid">
          <section class="panel chart-card wide">
            <div class="chart-head"><div><h3>Race timeline</h3><p class="sub">Stints, pit stops and safety-car periods</p></div>
              <div class="legend"><span><i class="sw"></i>Stint</span><span><i class="sw sc"></i>Safety car</span></div></div>
            ${timelineHTML(c, { sc: race.state.sc, head: race.state.status === 'finished' ? null : c.now })}
          </section>
          <section class="panel chart-card">
            <div class="chart-head"><div><h3>Stint durations</h3><p class="sub">Actual time on track per stint</p></div>
              <div class="legend"><span><i class="sw"></i>Actual</span><span><i class="sw plan"></i>Planned at start</span></div></div>
            ${columnChart({ items: stintItems, ref: s.settings.maxStintMin * 60, refLabel: `Max ${s.settings.maxStintMin}′` })}
          </section>
          <section class="panel chart-card">
            <div class="chart-head"><div><h3>Pit stops</h3><p class="sub">Time from pit in to pit out</p></div>
              ${s.otherStops ? '<div class="legend"><span><i class="sw"></i>Refuel</span><span><i class="sw alt"></i>No refuel</span></div>' : ''}</div>
            ${columnChart({ items: pitItems, ref: s.settings.pitStopMin * 60, refLabel: `Planned ${mins(s.settings.pitStopMin * 60)}` })}
          </section>
          <section class="panel chart-card">
            <div class="chart-head"><div><h3>Driving time</h3><p class="sub">Total time on track per driver</p></div></div>
            ${driverBars(s.drivers)}
          </section>
          <section class="panel chart-card">
            <div class="chart-head"><div><h3>Summary</h3><p class="sub">Strategy against the plan</p></div></div>
            <div class="impact" style="margin-top:0">
              <div class="row"><span>Total driving time</span><b>${hms(s.driveTotal)}</b></div>
              <div class="row"><span>Average stint</span><b>${s.stints.length ? mins(s.driveTotal / s.stints.length) : '—'}</b></div>
              <div class="row"><span>Longest stint</span><b>${s.stints.length ? mins(Math.max(...s.stints.map((r) => r.dur))) : '—'}</b></div>
              <div class="row"><span>Slowest pit stop</span><b>${s.pits.length ? mins(s.pitMax) : '—'}</b></div>
              <div class="row"><span>Refuel stops vs plan</span><b>${s.refuelStops} / ${Math.max(0, s.baseline.stintCount - 1)}</b></div>
              <div class="row"><span>Safety-car range gained</span><b>${mins(s.scTotal * (1 - s.settings.scFactor))}</b></div>
            </div>
          </section>
          <section class="panel chart-card wide">
            <div class="chart-head"><div><h3>Stint log</h3><p class="sub">Every stint as recorded${timeMode === 'clock' ? ' · clock times' : ' · race time'}</p></div></div>
            <div class="table-scroll"><table class="log">
              <thead><tr><th>#</th><th>Driver</th><th>Start</th><th>End</th><th class="r">Duration</th><th class="r">Planned</th><th class="r">Δ plan</th><th class="r">SC</th><th class="r">Pit after</th></tr></thead>
              <tbody>${log}</tbody>
            </table></div>
          </section>
        </div>`}
      </div>`;
    if (html !== lastHTML) {
      const y = view.scrollTop;
      view.innerHTML = lastHTML = html;
      view.scrollTop = y;
    }
  }
  render();
  const unsub = store.subscribe((evt) => evt?.type === 'change' && render());

  bottom.innerHTML = `
    <button class="btn-icon" data-act="back" title="Back to races" aria-label="Back to races">${icon('chevronLeft')}</button>
    <span class="status-line">${icon('stats')} Statistics</span>
    <span class="spacer"></span>
    <button class="btn" data-act="monitor">${icon('monitor')} <span class="txt">Open monitor</span></button>`;
  bottom.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') go('#/races');
    if (act === 'monitor') go(`#/race/${raceId}/monitor`);
  });

  // shared hover tooltip (values are also in the stint log, so it never gates)
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  document.body.appendChild(tip);
  const onMove = (e) => {
    const m = e.target.closest?.('[data-tip]');
    if (!m) {
      tip.classList.remove('show');
      return;
    }
    const [head, ...rest] = m.dataset.tip.split(' · ');
    tip.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = rest.length ? rest.join(' · ') : head;
    tip.append(b, document.createTextNode(rest.length ? head : ''));
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14)}px`;
    tip.style.top = `${e.clientY + 16}px`;
    tip.classList.add('show');
  };
  view.addEventListener('pointermove', onMove);
  view.addEventListener('pointerleave', () => tip.classList.remove('show'));

  return {
    destroy() {
      release();
      unsub();
      tip.remove();
    },
  };
}
