// App shell: start-up (this device only, or team sync via Firebase), hash
// router, auth guard and the shared top bar.

import { FIREBASE, USERNAME_DOMAIN } from '../config.js';
import { currentUser, logout } from './auth.js';
import * as store from './store.js';
import { createLocalAdapter } from './sync/local.js';
import { icon, logo } from './icons.js';
import { esc, toast, statusOf, closeAllModals } from './ui.js';
import { LoginView } from './views/login.js';
import { RacesView } from './views/races.js';
import { SettingsView } from './views/settings.js';
import { MonitorView } from './views/monitor.js';
import { StatsView } from './views/stats.js';

const app = document.getElementById('app');
let active = null;
let shell = { route: null, raceId: null };
let waitingForRaces = false;

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

function teardown() {
  closeAllModals();
  active?.destroy?.();
  active = null;
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
  waitingForRaces = false;
  if (raceId && !store.get(raceId)) {
    if (!store.loaded()) {
      screen('<div class="spinner"></div><p>Loading races…</p>');
      waitingForRaces = true;
      return;
    }
    toast('That race no longer exists.', 'error');
    return go('#/races');
  }
  if (raceId) store.setPref('lastRace', raceId);
  shell = { route, raceId };

  teardown();
  app.className = `app${route.bare ? ' bare' : ''}`;
  app.innerHTML = route.bare
    ? '<main class="view" id="view"></main>'
    : `${topbar(route, raceId, user)}
       <main class="view${route.fill ? ' fill' : ''}" id="view"></main>
       <footer class="bar bottombar" id="bottom"></footer>`;
  app.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await logout();
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

/** Full-screen message (loading, start-up errors). */
function screen(html) {
  teardown();
  shell = { route: null, raceId: null };
  app.className = 'app bare';
  app.innerHTML = `<main class="view"><div class="boot">${html}</div></main>`;
}

function syncChip() {
  const states = {
    local: ['local', 'This device', 'Races are saved on this device only'],
    online: ['online', 'Synced', 'Team sync is up to date'],
    syncing: ['syncing', 'Saving…', 'Sending changes to the team'],
    offline: ['offline', 'Offline', 'No connection — changes are kept here and sync when the connection is back'],
  };
  const [cls, text, title] = states[store.status()] ?? states.local;
  return `<span class="chip sync ${cls}" title="${title}" data-sync>${text}</span>`;
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
      ${syncChip()}
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

// Keep the top bar current, follow sign-in changes and surface sync failures.
let lastWarning = 0;
store.subscribe((evt) => {
  if (evt?.type === 'error') {
    if (Date.now() - lastWarning > 15000) {
      lastWarning = Date.now();
      toast(evt.message, 'error', 9000);
    }
    return;
  }
  if (evt?.type === 'auth') return render();
  if (waitingForRaces && store.loaded()) return render();
  const sync = app.querySelector('[data-sync]');
  if (sync) {
    const html = syncChip();
    if (sync.outerHTML !== html) sync.outerHTML = html;
  }
  const el = app.querySelector('.crumb');
  if (el && shell.route) {
    const html = crumbHTML(shell.route, shell.raceId);
    if (el.__html !== html) el.innerHTML = el.__html = html;
  }
});

async function boot() {
  let adapter;
  if (FIREBASE) {
    try {
      const { createFirebaseAdapter } = await import('./sync/firebase.js');
      adapter = await createFirebaseAdapter(FIREBASE, { usernameDomain: USERNAME_DOMAIN });
      await adapter.ready;
    } catch (e) {
      screen(`<h2>Team sync couldn’t start</h2>
        <p class="muted">${esc(e?.message || e)}</p>
        <p class="muted">The first visit on each device needs an internet connection. Check it and try again.</p>
        <button class="btn primary" data-reload>${icon('sync')} Try again</button>`);
      app.querySelector('[data-reload]').addEventListener('click', () => location.reload());
      return;
    }
  } else {
    adapter = createLocalAdapter();
  }
  store.init(adapter);
  window.addEventListener('hashchange', render);
  render();
}

boot();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
