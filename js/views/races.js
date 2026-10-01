// Race instances: create, open, rename, duplicate, delete, statistics, export/import.

import * as store from '../store.js';
import { compute } from '../engine.js';
import { icon } from '../icons.js';
import { esc, confirmDialog, promptDialog, toast, statusOf } from '../ui.js';
import { dateLabel, hoursLabel, mins } from '../format.js';

export function RacesView({ view, bottom, go }) {
  function card(r) {
    const c = compute(r, Date.now());
    const s = r.settings;
    const st = statusOf(r);
    const live = r.state.status === 'running' || r.state.status === 'paused';
    const finished = r.state.status === 'finished';
    const pct = c.started ? Math.min(100, Math.round((c.now / c.T) * 100)) : 0;
    const progress = c.started
      ? `<div class="prog-row"><div class="progress"><i style="width:${pct}%"></i></div><span class="num">${pct}%</span></div>`
      : `<div class="prog-row"><span>Buffer ${mins(c.finalSlack)} · ≈${s.pitStopMin}′ pit stops</span></div>`;
    const main = finished
      ? `<button class="btn sm primary" data-act="stats">${icon('stats')} Statistics</button>`
      : `<button class="btn sm${live ? ' primary' : ''}" data-act="open">${icon('monitor')} ${live ? 'Open monitor' : 'Open'}</button>`;
    return `
      <article class="panel race-card${live ? ' is-live' : ''}" data-id="${esc(r.id)}">
        <div class="top">
          <span class="chip ${st.cls}">${st.label}</span>
          <span class="muted">${dateLabel(r.createdAt)}</span>
        </div>
        <div class="title-row">
          <h3 data-act="${finished ? 'stats' : 'open'}">${esc(r.name)}</h3>
          <button class="btn-icon ghost sm" data-act="rename" title="Rename" aria-label="Rename">${icon('edit')}</button>
        </div>
        <div class="meta">
          <span><b>${hoursLabel(s.raceLengthMin)}</b> race</span>
          <span><b>${s.maxStintMin}′</b> max stint</span>
          <span><b>${c.stintCount}</b> stints</span>
          <span><b>${s.drivers}</b> driver${s.drivers > 1 ? 's' : ''}</span>
        </div>
        ${progress}
        <div class="card-actions">
          ${main}
          <button class="btn-icon sm" data-act="settings" title="Settings" aria-label="Settings">${icon('settings')}</button>
          <button class="btn-icon sm" data-act="duplicate" title="Duplicate" aria-label="Duplicate">${icon('copy')}</button>
          <button class="btn-icon sm danger" data-act="delete" title="Delete" aria-label="Delete">${icon('trash')}</button>
        </div>
      </article>`;
  }

  // One damaged race must never take the whole list down.
  function safeCard(r) {
    try {
      return card(r);
    } catch {
      return `<article class="panel race-card" data-id="${esc(r.id)}">
        <div class="top"><span class="chip crit">Unreadable</span></div>
        <h3>${esc(r.name)}</h3><p class="muted">This race's data is damaged.</p>
        <div class="card-actions"><span class="spacer"></span>
          <button class="btn-icon sm danger" data-act="delete" title="Delete" aria-label="Delete">${icon('trash')}</button></div>
      </article>`;
    }
  }

  function render() {
    const races = store.list();
    const live = races.filter((r) => r.state.status === 'running' || r.state.status === 'paused').length;
    const done = races.filter((r) => r.state.status === 'finished').length;
    view.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div>
            <h1>Races</h1>
            <p>${races.length ? `${races.length} race${races.length > 1 ? 's' : ''} · ${live} live · ${done} finished` : 'Your season starts here'}</p>
          </div>
          <div class="actions-row">
            <button class="btn sm outline" data-act="import">${icon('upload')} Import</button>
            <button class="btn sm outline" data-act="export"${races.length ? '' : ' disabled'}>${icon('download')} Export</button>
          </div>
        </div>
        ${
          races.length
            ? `<div class="race-grid">${races.map(safeCard).join('')}</div>`
            : `<div class="panel empty">
                 <div class="big-ic">${icon('flag')}</div>
                 <h2>No races yet</h2>
                 <p>Create a race, set its length, stint range and pit-stop time — the stint sheet is planned for you.</p>
                 <button class="btn primary" data-act="new">${icon('plus')} New race</button>
               </div>`
        }
      </div>`;
  }

  bottom.innerHTML = `
    <span class="status-line">${icon('clock')} Data is saved in this browser — export to back up or move devices.</span>
    <span class="spacer"></span>
    <button class="btn primary go" data-act="new">${icon('plus')} <span class="txt">New race</span></button>`;

  async function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const id = el.closest('[data-id]')?.dataset.id;
    const race = id ? store.get(id) : null;
    switch (act) {
      case 'new':
        return go('#/new');
      case 'open':
        return go(`#/race/${id}/monitor`);
      case 'stats':
        return go(`#/race/${id}/stats`);
      case 'settings':
        return go(`#/race/${id}/settings`);
      case 'rename': {
        const name = await promptDialog({ title: 'Rename race', label: 'Race name', value: race.name });
        if (name) store.rename(id, name);
        return;
      }
      case 'duplicate': {
        const copy = store.duplicate(id);
        if (copy) toast(`Duplicated as “${copy.name}”`, 'ok');
        return;
      }
      case 'delete': {
        const ok = await confirmDialog({
          title: 'Delete race?',
          message: `<b>${esc(race.name)}</b> and all its stint data will be removed from this browser. This can’t be undone.`,
          confirm: 'Delete',
          danger: true,
        });
        if (ok) {
          store.remove(id);
          toast('Race deleted');
        }
        return;
      }
      case 'export': {
        const blob = new Blob([store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ahk-races-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return;
      }
      case 'import': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = async () => {
          try {
            const n = store.importJSON(await input.files[0].text());
            toast(`Imported ${n} race${n === 1 ? '' : 's'}`, 'ok');
          } catch (err) {
            toast(err.message || 'Could not read that file.', 'error');
          }
        };
        input.click();
        return;
      }
    }
  }

  view.addEventListener('click', onClick);
  bottom.addEventListener('click', onClick);
  const unsub = store.subscribe(render);
  const timer = setInterval(render, 15000);
  render();
  return {
    destroy() {
      unsub();
      clearInterval(timer);
    },
  };
}
