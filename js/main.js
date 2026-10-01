// App shell: hash router, auth guard and the shared top bar.

import { currentUser, logout } from './auth.js';
import * as store from './store.js';
import { compute, actFinish } from './engine.js';
import { icon, logo } from './icons.js';
import { esc, toast, statusOf } from './ui.js';
import { LoginView } from './views/login.js';
import { RacesView } from './views/races.js';
import { SettingsView } from './views/settings.js';
import { MonitorView } from './views/monitor.js';
import { StatsView } from './views/stats.js';

const app = document.getElementById('app');
let active = null;
let shell = { route: null, raceId: null };

const routes = [
  { re: /^#\/login$/, view: LoginView, bare: true, public: true },
  { re: /^#\/races$/, view: RacesView, tab: 'races' },
  { re: /^#\/new$/, view: SettingsView, tab: 'settings', mode: 'new' },
  { re: /^#\/race\/([\w-]+)\/settings$/, view: SettingsView, tab: 'settings' },
  { re: /^#\/race\/([\w-]+)\/monitor$/, view: MonitorView, tab: 'monitor', fill: true },
  { re: /^#\/race\/([\w-]+)\/stats$/, view: StatsView, tab: 'races' },
];

export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  const hash = location.hash || '#/races';
  const user = currentUser();
  let route = null;
  let match = null;
  for (const r of routes) {
    match = hash.match(r.re);
    if (match) {
      route = r;
      break;
    }
  }
  if (!route) return go(user ? '#/races' : '#/login');
  if (!route.public && !user) return go('#/login');
  if (route.public && user) return go('#/races');

  const raceId = match[1] || null;
  if (raceId && !store.get(raceId)) {
    toast('That race no longer exists.', 'error');
    return go('#/races');
  }
  if (raceId) store.setPref('lastRace', raceId);
  shell = { route, raceId };

  active?.destroy?.();
  active = null;
  app.className = `app${route.bare ? ' bare' : ''}`;
  app.innerHTML = route.bare
    ? '<main class="view" id="view"></main>'
    : `${topbar(route, raceId, user)}
       <main class="view${route.fill ? ' fill' : ''}" id="view"></main>
       <footer class="bar bottombar" id="bottom"></footer>`;
  app.querySelector('[data-logout]')?.addEventListener('click', () => {
    logout();
    go('#/login');
  });
  active = route.view({
    view: app.querySelector('#view'),
    bottom: app.querySelector('#bottom'),
    raceId,
    mode: route.mode,
    go,
  });
}

function topbar(route, raceId, user) {
  const ctx = store.get(raceId) || store.get(store.prefs().lastRace);
  const rid = ctx?.id;
  const tab = (name, href, ic, label, disabled = false) => {
    const on = route.tab === name;
    return `<a href="${href}" class="${on ? 'active' : ''}${disabled ? ' disabled' : ''}"${on ? ' aria-current="page"' : ''}
      title="${label}"><span class="ic">${icon(ic)}</span><span class="txt">${label}</span></a>`;
  };
  return `<header class="bar topbar">
    <a class="brand" href="#/races" aria-label="AHK — all races">${logo()}</a>
    <nav class="nav" aria-label="Main">
      ${tab('races', '#/races', 'races', 'Races')}
      ${tab('settings', rid ? `#/race/${rid}/settings` : '#/new', 'settings', 'Settings')}
      ${tab('monitor', rid ? `#/race/${rid}/monitor` : '#/races', 'monitor', 'Monitor', !rid)}
    </nav>
    <div class="crumb">${crumbHTML(route, raceId)}</div>
    <div class="user">
      <span class="avatar" aria-hidden="true">${esc((user || '?')[0])}</span>
      <span class="name">${esc(user)}</span>
      <button class="btn-icon ghost sm" data-logout title="Log out" aria-label="Log out">${icon('logout')}</button>
    </div>
  </header>`;
}

function crumbHTML(route, raceId) {
  if (route.mode === 'new') return '<span>Races</span><span class="slash">/</span><b>New race</b>';
  const race = raceId && store.get(raceId);
  if (!race) return '';
  const st = statusOf(race);
  return `<span>Races</span><span class="slash">/</span><b>${esc(race.name)}</b><span class="chip ${st.cls}">${st.label}</span>`;
}

// Keep the race name / status chip in the top bar current.
store.subscribe(() => {
  const el = app.querySelector('.crumb');
  if (el && shell.route) {
    const html = crumbHTML(shell.route, shell.raceId);
    if (el.__html !== html) el.innerHTML = el.__html = html;
  }
});

window.addEventListener('hashchange', render);
render();

// Keep live races ticking toward an automatic finish even when another view is open.
setInterval(() => {
  for (const r of store.list()) {
    if (r.state.status !== 'running') continue;
    const c = compute(r, Date.now());
    if (c.now >= c.T && !location.hash.endsWith(`${r.id}/monitor`)) {
      store.silent(r.id, (x) => actFinish(x, Date.now(), c.T));
    }
  }
}, 5000);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
