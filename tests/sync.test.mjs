// Multi-device sync tests: several stores share an in-memory "server".
// Run with: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/sync.test.mjs
import { createStore } from '../js/store.js';
import { compute } from '../js/engine.js';
import { replay } from '../js/ops.js';
import { createServer, createMemoryAdapter } from './memory-adapter.mjs';

const out = typeof print === 'function' ? print : (s) => console.log(s);
let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    out(`  ok  ${name}`);
  } catch (e) {
    failures.push(name);
    out(`  FAIL ${name}\n       ${e.message}`);
  }
}
function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

const M = 60;
let clock = 1_700_000_000_000;
const advance = (min) => {
  clock += Math.round(min * 60_000);
};
const SIX = { raceLengthMin: 360, maxStintMin: 105, pitOpenFirstMin: 30, drivers: 3, pitStopMin: 5, scFactor: 0.5 };

function team(n) {
  const server = createServer();
  return Array.from({ length: n }, (_, i) => {
    const adapter = createMemoryAdapter(server, `driver${i + 1}`);
    const store = createStore({ device: `dev${i + 1}`, now: () => clock });
    store.init(adapter);
    return { store, adapter };
  });
}
const stateOf = (d, id) => JSON.stringify(d.store.get(id).state);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

out('sync');

await test('a race created on one device appears on the others', () => {
  const [a, b, c] = team(3);
  const r = a.store.create('6h Brno', SIX);
  eq(b.store.list().map((x) => x.name), ['6h Brno']);
  eq(c.store.get(r.id).settings.maxStintMin, 105);
});

await test('operations from any device replay identically everywhere', () => {
  const [a, b] = team(2);
  const r = a.store.create('Race', SIX);
  a.store.open(r.id);
  b.store.open(r.id);
  a.store.dispatch(r.id, 'start');
  advance(100);
  b.store.dispatch(r.id, 'pitIn');
  advance(5);
  a.store.dispatch(r.id, 'pitOut');
  eq(stateOf(a, r.id), stateOf(b, r.id), 'same state');
  const c = compute(b.store.get(r.id), clock);
  eq([c.phase, c.cur.n, c.cur.driver], ['stint', 2, 1]);
  eq(b.store.lastStep(r.id), 'Pit out');
});

await test('two devices pressing PIT IN together record one stop', () => {
  const [a, b] = team(2);
  const r = a.store.create('Race', SIX);
  a.store.open(r.id);
  b.store.open(r.id);
  a.store.dispatch(r.id, 'start');
  advance(90);
  a.store.dispatch(r.id, 'pitIn');
  b.store.dispatch(r.id, 'pitIn');
  const st = a.store.get(r.id).state;
  eq(st.stints.length, 1);
  eq(st.stints[0].end, 90 * M);
  eq(stateOf(a, r.id), stateOf(b, r.id));
});

await test('an offline device merges its events when it reconnects', () => {
  const [a, b] = team(2);
  const r = a.store.create('Race', SIX);
  a.store.open(r.id);
  b.store.open(r.id);
  a.store.dispatch(r.id, 'start');
  advance(60);
  b.adapter.goOffline();
  b.store.dispatch(r.id, 'scOn'); // pit wall tablet loses signal
  advance(10);
  a.store.dispatch(r.id, 'pitIn'); // laptop still online
  eq(a.store.get(r.id).state.sc.length, 0, 'laptop has not seen the SC yet');
  eq(b.store.get(r.id).state.stints[0].end, null, 'tablet has not seen the pit in yet');
  b.adapter.goOnline();
  eq(stateOf(a, r.id), stateOf(b, r.id), 'converged');
  const st = a.store.get(r.id).state;
  eq([st.sc[0].from, st.stints[0].end], [60 * M, 70 * M]);
});

await test('undo on one device cancels the latest change for everyone', () => {
  const [a, b] = team(2);
  const r = a.store.create('Race', SIX);
  a.store.open(r.id);
  b.store.open(r.id);
  a.store.dispatch(r.id, 'start');
  advance(100);
  a.store.dispatch(r.id, 'pitIn');
  eq(b.store.undo(r.id), 'Pit in');
  eq(a.store.get(r.id).state.stints[0].end, null);
  eq(a.store.lastStep(r.id), 'Start');
  eq(stateOf(a, r.id), stateOf(b, r.id));
});

await test('settings changes sync and can be undone', () => {
  const [a, b] = team(2);
  const r = a.store.create('Race', SIX);
  a.store.open(r.id);
  b.store.open(r.id);
  a.store.dispatch(r.id, 'settings', { settings: { ...SIX, maxStintMin: 90 } });
  eq(b.store.get(r.id).settings.maxStintMin, 90);
  b.store.undo(r.id);
  eq(a.store.get(r.id).settings.maxStintMin, 105);
});

await test('the race list shows live state without loading the event log', () => {
  const [a, b] = team(2);
  const r = a.store.create('Race', SIX);
  a.store.open(r.id);
  a.store.dispatch(r.id, 'start');
  const seen = b.store.get(r.id);
  eq(seen.synced, false);
  eq(seen.state.status, 'running');
});

await test('the flag finishes the race on every device without anyone recording it', () => {
  const [a, b] = team(2);
  const r = a.store.create('Race', { ...SIX, raceLengthMin: 60 });
  a.store.open(r.id);
  b.store.open(r.id);
  a.store.dispatch(r.id, 'start');
  advance(61);
  const ca = compute(a.store.get(r.id), clock);
  const cb = compute(b.store.get(r.id), clock);
  eq([ca.finished, ca.autoFinished, cb.finished], [true, true, true]);
  b.store.dispatch(r.id, 'pitIn'); // after the flag: ignored
  eq(a.store.get(r.id).state.stints[0].end, null, 'stored state untouched');
  eq(compute(a.store.get(r.id), clock).stintCount, 1);
});

await test('a clock sync brings an auto-finished race back', () => {
  const [a] = team(1);
  const r = a.store.create('Race', { ...SIX, raceLengthMin: 60 });
  a.store.open(r.id);
  a.store.dispatch(r.id, 'start');
  advance(70); // forgot to pause during a 20 min red flag
  eq(compute(a.store.get(r.id), clock).finished, true);
  a.store.dispatch(r.id, 'sync', { elapsed: 50 * M });
  const c = compute(a.store.get(r.id), clock);
  eq([c.finished, c.now], [false, 50 * M]);
});

await test('deleting a race removes it everywhere', () => {
  const [a, b] = team(2);
  const r = a.store.create('Race', SIX);
  b.store.remove(r.id);
  eq(a.store.list().length, 0);
  eq(a.store.get(r.id), null);
});

await test('replay order does not depend on arrival order', () => {
  const [a] = team(1);
  const r = a.store.create('Race', SIX);
  a.store.open(r.id);
  a.store.dispatch(r.id, 'start');
  advance(30);
  a.store.dispatch(r.id, 'scOn');
  advance(10);
  a.store.dispatch(r.id, 'scOff');
  advance(70);
  a.store.dispatch(r.id, 'pitIn');
  const base = { settings: SIX, state: { status: 'draft' } };
  let ops = [];
  a.adapter.watchOps(r.id, (l) => (ops = l))();
  const forward = replay(base, ops);
  const backward = replay(base, [...ops].reverse());
  eq(JSON.stringify(forward), JSON.stringify(backward));
  eq(forward.state.stints[0].end, 110 * M);
});

await test('importing races adds them with their state as the starting point', () => {
  const [a, b] = team(2);
  const n = a.store.importRaces([
    { name: 'Old race', settings: SIX, state: { status: 'finished', startedAt: 1, finishedAt: 600, stints: [{ start: 0, end: 600, driver: 0 }] } },
    { nope: true },
  ]);
  eq(n, 1);
  const r = b.store.list()[0];
  eq([r.name, r.state.status, r.state.stints.length], ['Old race', 'finished', 1]);
});

await test('a stale race-list snapshot is repaired after concurrent writes', async () => {
  const [a, b] = team(2);
  const r = a.store.create('Race', SIX);
  a.store.open(r.id);
  b.store.open(r.id);
  a.store.dispatch(r.id, 'start');
  advance(30);
  b.adapter.goOffline();
  b.store.dispatch(r.id, 'scOn');
  advance(5);
  a.store.dispatch(r.id, 'pitIn');
  b.adapter.goOnline(); // b's snapshot (without the pit in) lands last
  const fresh = createStore({ device: 'viewer', now: () => clock });
  fresh.init(b.adapter);
  await wait(3300);
  const listed = fresh.get(r.id);
  eq(listed.synced, false);
  eq(JSON.stringify(listed.state), stateOf(a, r.id), 'snapshot matches the full replay');
});

out(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`Failed: ${failures.join(', ')}`);
