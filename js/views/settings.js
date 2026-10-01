// Race settings: create a new race or edit an existing one, with a live strategy preview.

import * as store from '../store.js';
import { DEFAULT_SETTINGS, normalizeSettings, previewPlan, compute } from '../engine.js';
import { icon } from '../icons.js';
import { esc, toast, confirmDialog } from '../ui.js';
import { hoursLabel, mins, raceRel } from '../format.js';
import { timelineHTML } from '../timeline.js';

const FIELDS = [
  { key: 'raceLengthMin', label: 'Race length', unit: 'min', step: 15, min: 10, max: 2880 },
  { key: 'maxStintMin', label: 'Max. stint', unit: 'min', step: 5, min: 5, max: 1440 },
  { key: 'pitOpenFirstMin', label: 'Pit open', unit: 'min', step: 5, min: 0, max: 1440 },
  { key: 'drivers', label: 'Nr. of drivers', unit: 'drivers', step: 1, min: 1, max: 12 },
  { key: 'pitStopMin', label: '≈ Pit stop duration', unit: 'min', step: 0.5, min: 0, max: 60 },
];

const fmtNum = (v) => String(Math.round(v * 100) / 100);

function hintFor(key, s) {
  switch (key) {
    case 'raceLengthMin':
      return `= ${hoursLabel(s.raceLengthMin)}`;
    case 'maxStintMin':
      return 'Fuel range at race pace';
    case 'pitOpenFirstMin':
      return s.pitOpenFirstMin ? `Stint 1 can’t pit before ${raceRel(s.pitOpenFirstMin * 60)}` : 'No minimum for stint 1';
    case 'drivers':
      return 'Rotated through the stints';
    case 'pitStopMin': {
      const sec = Math.round(s.pitStopMin * 60);
      return `= ${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s · real stops are timed live`;
    }
    default:
      return '';
  }
}

export function SettingsView({ view, bottom, raceId, go }) {
  const race = raceId ? store.get(raceId) : null;
  const isNew = !race;
  let s = normalizeSettings(race ? race.settings : DEFAULT_SETTINGS);
  const initial = JSON.stringify({ s, name: race?.name ?? '' });
  const defaultName = `Race ${store.list().length + 1}`;
  let dirty = false;

  const numField = (f) => `
    <div class="field">
      <label class="field-label" for="f-${f.key}">${f.label}</label>
      <div class="numfield">
        <button type="button" class="step" data-step="${-f.step}" data-key="${f.key}" aria-label="Decrease">−</button>
        <input id="f-${f.key}" data-key="${f.key}" inputmode="decimal" autocomplete="off" value="${fmtNum(s[f.key])}">
        <span class="unit">${f.unit}</span>
        <button type="button" class="step" data-step="${f.step}" data-key="${f.key}" aria-label="Increase">+</button>
      </div>
      <span class="hint" data-hint="${f.key}">${hintFor(f.key, s)}</span>
    </div>`;

  const status = race?.state.status ?? 'draft';
  const note =
    status === 'running' || status === 'paused'
      ? `<div class="locked-note">${icon('warn')}<span>This race is live. Saving recalculates the remaining stint plan immediately (you can undo it from the monitor).</span></div>`
      : status === 'finished'
        ? `<div class="locked-note">${icon('flag')}<span>This race is finished. Changes only affect the statistics.</span></div>`
        : '';

  view.innerHTML = `
    <div class="settings">
      <section class="panel">
        <input class="name-input" id="race-name" maxlength="80" placeholder="${esc(defaultName)}" value="${esc(race?.name ?? '')}" aria-label="Race name">
        <div class="form-grid">
          ${FIELDS.slice(0, 3).map(numField).join('')}
          ${FIELDS.slice(3).map(numField).join('')}
          <div class="field">
            <label class="field-label" for="f-sc">Safety car coefficient</label>
            <div class="range-row">
              <input type="range" id="f-sc" min="0.1" max="1" step="0.05" value="${s.scFactor}">
              <span class="range-val num" data-scval>${s.scFactor.toFixed(2)}</span>
            </div>
            <span class="hint" data-schint></span>
          </div>
        </div>
        <div class="field" style="margin-top:26px">
          <span class="field-label">Driver names</span>
          <div class="drivers-names" data-names></div>
        </div>
        ${note}
      </section>
      <aside class="panel preview" data-preview></aside>
    </div>`;

  bottom.innerHTML = `
    <button class="btn-icon" data-act="close" title="Close" aria-label="Close">${icon('close')}</button>
    <span class="status-line" data-dirty></span>
    <span class="spacer"></span>
    <button class="btn primary go" data-act="save">${icon(isNew ? 'plus' : 'check')} <span class="txt">${isNew ? 'Create race' : 'Save changes'}</span></button>`;

  const nameInput = view.querySelector('#race-name');
  const namesBox = view.querySelector('[data-names]');
  const preview = view.querySelector('[data-preview]');
  const scRange = view.querySelector('#f-sc');

  function readNames() {
    return [...namesBox.querySelectorAll('input')].map((i) => i.value);
  }

  function renderNames() {
    const typed = readNames();
    const names = s.driverNames;
    namesBox.innerHTML = Array.from({ length: s.drivers }, (_, i) => {
      const v = typed[i] ?? (names[i] && names[i] !== `Driver ${i + 1}` ? names[i] : '');
      return `<input class="input" data-name="${i}" maxlength="24" placeholder="Driver ${i + 1}" value="${esc(v)}" aria-label="Driver ${i + 1} name">`;
    }).join('');
  }

  function renderSc() {
    const k = s.scFactor;
    scRange.style.setProperty('--p', `${((k - 0.1) / 0.9) * 100}%`);
    view.querySelector('[data-scval]').textContent = k.toFixed(2);
    const gain = Math.round((1 - k) * 60);
    view.querySelector('[data-schint]').textContent =
      `Fuel burn under SC vs green · each SC minute adds ${gain} s of stint range`;
  }

  function renderPreview() {
    const c = previewPlan({ ...s, driverNames: readNames() });
    const fin = c.rows[c.rows.length - 1];
    preview.innerHTML = `
      <h3 class="lbl">Strategy preview</h3>
      <div class="preview-figs">
        <div class="fig hero"><div class="v">${mins(c.finalSlack)}</div><div class="l">Buffer — total time you can pit early without adding a stop</div></div>
        <div class="fig"><div class="v">${c.stintCount}</div><div class="l">Stints</div></div>
        <div class="fig"><div class="v">${Math.max(0, c.stintCount - 1)}</div><div class="l">Pit stops</div></div>
        <div class="fig"><div class="v">${mins(fin?.dur ?? 0)}</div><div class="l">Final stint</div></div>
        <div class="fig"><div class="v">${c.pitOpen != null ? raceRel(c.pitOpen) : '—'}</div><div class="l">Stint 1 pit window opens</div></div>
      </div>
      ${timelineHTML(c, { win: c.pitOpen != null ? [c.pitOpen, c.pitIn] : null })}
      <p class="explain">Every stint runs its full <b>${mins(s.maxStintMin * 60)}</b> fuel range; the last one only has to reach the flag.
      Its unused range is the <b>buffer</b>. Pitting a stint early uses buffer; a safety car adds some back.
      Use more than the buffer and the plan gains a pit stop.</p>`;
  }

  function markDirty() {
    dirty = JSON.stringify({ s: { ...s, driverNames: s.driverNames }, name: nameInput.value }) !== initial || isNew;
    const el = bottom.querySelector('[data-dirty]');
    el.textContent = !isNew && dirty ? 'Unsaved changes' : '';
  }

  function setValue(key, raw, { reformat = false } = {}) {
    const f = FIELDS.find((x) => x.key === key);
    let v = parseFloat(String(raw).replace(',', '.'));
    if (!Number.isFinite(v)) return;
    v = Math.min(f.max, Math.max(f.min, v));
    if (key === 'drivers') v = Math.round(v);
    s = normalizeSettings({ ...s, [key]: v, driverNames: readNames() });
    if (reformat) view.querySelector(`#f-${key}`).value = fmtNum(s[key]);
    view.querySelector(`[data-hint="${key}"]`).textContent = hintFor(key, s);
    if (key === 'drivers') renderNames();
    renderPreview();
    markDirty();
  }

  view.addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (key) setValue(key, e.target.value);
    if (e.target === scRange) {
      s = normalizeSettings({ ...s, scFactor: parseFloat(scRange.value), driverNames: readNames() });
      renderSc();
      markDirty();
    }
    if (e.target.dataset.name != null) {
      s = normalizeSettings({ ...s, driverNames: readNames() });
      markDirty();
    }
    if (e.target === nameInput) markDirty();
  });
  view.addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (key) setValue(key, e.target.value, { reformat: true });
  });
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const key = b.dataset.key;
    setValue(key, s[key] + parseFloat(b.dataset.step), { reformat: true });
  });
  view.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
  });

  async function save() {
    const name = nameInput.value.trim() || defaultName;
    const settings = normalizeSettings({ ...s, driverNames: readNames() });
    if (isNew) {
      const r = store.create(name, settings);
      toast(`“${r.name}” created`, 'ok');
      go(`#/race/${r.id}/monitor`);
      return;
    }
    const c = compute({ ...race, settings }, Date.now());
    if (c.started && !c.finished && c.now >= c.T) {
      const ok = await confirmDialog({
        title: 'Race length already reached',
        message: 'The new race length is shorter than the time already elapsed, so the race will finish immediately.',
        confirm: 'Save anyway',
      });
      if (!ok) return;
    }
    store.mutate(race.id, 'Settings', (r) => {
      r.name = name;
      r.settings = settings;
    });
    toast('Settings saved', 'ok');
    go(`#/race/${race.id}/monitor`);
  }

  bottom.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'save') save();
    if (act === 'close') {
      if (!isNew && dirty) {
        const ok = await confirmDialog({ title: 'Discard changes?', message: 'Your edits to these settings will be lost.', confirm: 'Discard' });
        if (!ok) return;
      }
      go(race ? `#/race/${race.id}/monitor` : '#/races');
    }
  });

  renderNames();
  renderSc();
  renderPreview();
  markDirty();
  if (isNew) setTimeout(() => nameInput.focus(), 60);
}
