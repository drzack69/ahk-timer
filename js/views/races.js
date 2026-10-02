// Race instances: create, open, rename, duplicate, delete, statistics, export/import.

import * as store from '../store.js';
import { compute } from '../engine.js';
import { icon } from '../icons.js';
import { esc, confirmDialog, promptDialog, toast, statusOf } from '../ui.js';
import { dateLabel, hoursLabel, mins } from '../format.js';
import { readLocalRaces } from '../sync/local.js';

const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : dateLabel(ms);
};

export function RacesView({ view, bottom, go }) {
  const team = store.mode() === 'cloud';

  // Races saved only on this device before team sync was switched on.
  function localOnly() {
    if (!team) return [];
    const done = new Set(store.prefs().uploaded || []);
    try {
      return readLocalRaces().filter((r) => !done.has(r.id));
    } catch {
      return [];
    }
  }

  function card(r) {
    const c = compute(r, Date.now());
    const s = r.settings;
    const st = statusOf(r);
    const live = c.started && !c.finished;
    const finished = c.finished;
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
        ${team && r.lastOp?.label ? `<div class="last-op">${icon('sync')}<span>${esc(r.lastOp.label)}${r.lastOp.by ? ` · ${esc(r.lastOp.by)}` : ''} · ${ago(r.lastOp.at)}</span></div>` : ''}
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
    const states = races.map((r) => statusOf(r).label);
    const live = states.filter((l) => l === 'Live' || l === 'Paused').length;
    const done = states.filter((l) => l === 'Finished').length;
    const local = localOnly();
    view.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div>
            <h1>Races</h1>
            <p>${races.length ? `${races.length} race${races.length > 1 ? 's' : ''} · ${live} live · ${done} finished` : 'Your season starts here'}${team ? ' · shared with your team' : ''}</p>
          </div>
          <div class="actions-row">
            <button class="btn sm outline" data-act="import">${icon('upload')} Import</button>
            <button class="btn sm outline" data-act="export"${races.length ? '' : ' disabled'}>${icon('download')} Export</button>
          </div>
        </div>
        ${
          local.length
            ? `<div class="panel upload-banner">
                 <div class="big-ic">${icon('upload')}</div>
                 <div class="grow"><b>${local.length} race${local.length > 1 ? 's are' : ' is'} saved only on this device</b>
                   <p class="muted">${local.map((r) => esc(r.name)).join(', ')}. Upload so the whole team can see ${local.length > 1 ? 'them' : 'it'}.</p></div>
                 <button class="btn primary sm" data-act="upload">${icon('upload')} Upload to team</button>
               </div>`
            : ''
        }
        ${
          races.length
            ? `<div class="race-grid">${races.map(safeCard).join('')}</div>`
            : !store.loaded()
              ? '<div class="panel empty"><div class="spinner"></div><p>Loading team races…</p></div>'
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
    <span class="status-line">${icon(team ? 'sync' : 'clock')} ${team ? 'Team sync — every signed-in device sees these races live.' : 'Data is saved in this browser — export to back up or move devices.'}</span>
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
      case 'upload': {
        const local = localOnly();
        const n = store.importRaces(local);
        store.setPref('uploaded', [...(store.prefs().uploaded || []), ...local.map((r) => r.id)]);
        toast(`Uploaded ${n} race${n === 1 ? '' : 's'} to the team`, 'ok');
        return render();
      }
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
