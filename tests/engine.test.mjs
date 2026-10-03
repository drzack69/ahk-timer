// Run with macOS JavaScriptCore (no install needed):
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/engine.test.mjs
// or open tests/index.html through a local web server.
import {
  compute, previewPlan, newState, raceNow, wallAt, raceAt,
  actStart, actPause, actResume, actPitIn, actPitOut, actSafetyCar, actFinish,
  actSyncClock, actEditStint, actResetStint, actSetRefuel, validateEdit, raceStats, normalizeState,
} from '../js/engine.js';
import { replay, opLabel } from '../js/ops.js';

const out = typeof print === 'function' ? print : (s) => console.log(s);
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
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
function near(actual, expected, msg = '', tol = 0.01) {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${msg} expected ≈${expected}, got ${actual}`);
}

const BASE = 1_700_000_000_000;
const at = (min) => BASE + min * 60_000;
const M = 60;
const SIX_HOURS = { raceLengthMin: 360, maxStintMin: 105, pitOpenFirstMin: 30, drivers: 3, pitStopMin: 5, scFactor: 0.5 };
const newRace = (settings = SIX_HOURS) => ({ settings: { ...settings }, state: newState() });
const spans = (c) => c.rows.map((r) => [r.start / M, r.end / M]);

out('engine');

test('6 h / 105 min / 5 min pit → 4 stints, 30 min final, 75 min buffer', () => {
  const c = previewPlan(SIX_HOURS);
  eq(spans(c), [[0, 105], [110, 215], [220, 325], [330, 360]]);
  eq(c.finalSlack / M, 75, 'buffer');
  eq(c.initialBuffer / M, 75, 'initial buffer');
  eq(c.rows.map((r) => r.bufferAfter / M), [75, 75, 75, 75]);
  eq(c.rows[3].isFinal, true);
  eq(c.pitIn / M, 105, 'pit in');
  eq(c.pitOpen / M, 30, 'pit open');
  eq(c.stopsLeft, 3);
});

test('without pit time the buffer is max stint minus the final stint (105 − 45)', () => {
  const c = previewPlan({ ...SIX_HOURS, pitStopMin: 0 });
  eq(c.rows.length, 4);
  eq(c.rows[3].dur / M, 45);
  eq(c.finalSlack / M, 60);
  eq(c.pitOpen / M, 45, 'buffer-limited pit window');
  eq(c.pitOpenBy, 'buffer');
});

test('shortening stint 3 by 35 min uses 35 min of buffer (whiteboard example)', () => {
  const race = newRace();
  actEditStint(race, at(0), 3, { dur: 70 * M });
  const c = compute(race, at(0));
  eq(spans(c), [[0, 105], [110, 215], [220, 290], [295, 360]]);
  eq(c.rows.map((r) => r.bufferAfter / M), [75, 75, 40, 40]);
  eq(c.rows[2].bufferUsed / M, 35);
  eq(c.initialBuffer / M, 75);
});

test('using more than the buffer adds a pit stop', () => {
  const race = newRace();
  actEditStint(race, at(0), 2, { dur: 20 * M });
  const c = compute(race, at(0));
  eq(c.rows.length, 5);
  eq(c.rows[4].dur / M, 5);
  eq(c.finalSlack / M, 100);
});

test('pit in early in stint 1 deducts the used buffer', () => {
  const race = newRace();
  actStart(race, at(0));
  actPitIn(race, at(90));
  actPitOut(race, at(95));
  const c = compute(race, at(96));
  eq(c.phase, 'stint');
  eq(spans(c), [[0, 90], [95, 200], [205, 310], [315, 360]]);
  eq(c.rows[0].bufferUsed / M, 15);
  eq(c.finalSlack / M, 60);
  eq(c.initialBuffer / M, 75, 'initial buffer is invariant');
  eq(c.rows[1].driver, 1, 'driver rotation');
});

test('safety car extends the current stint by (1 − k) per SC minute', () => {
  const race = newRace();
  actStart(race, at(0));
  actSafetyCar(race, at(30));
  let c = compute(race, at(40));
  eq(c.scActive, true);
  near(c.rows[0].cap / M, 110, 'cap during SC');
  actSafetyCar(race, at(50));
  c = compute(race, at(60));
  near(c.rows[0].cap / M, 115, 'cap after 20 min SC');
  eq(spans(c)[0], [0, 115]);
  near(c.finalSlack / M, 85, 'buffer +10');
  near(c.pitIn / M, 115);
  near(c.scTotal / M, 20);
});

test('SC across a pit stop counts only while driving', () => {
  const race = newRace();
  actStart(race, at(0));
  actSafetyCar(race, at(100));
  actPitIn(race, at(105));
  actPitOut(race, at(110));
  actSafetyCar(race, at(120));
  const c = compute(race, at(121));
  near(c.rows[0].sc / M, 5);
  near(c.rows[1].sc / M, 10);
});

test('a shortened stint keeps its planned end under SC and gains buffer instead', () => {
  const race = newRace();
  actStart(race, at(0));
  actEditStint(race, at(0), 1, { dur: 80 * M });
  actSafetyCar(race, at(10));
  actSafetyCar(race, at(30));
  const c = compute(race, at(31));
  near(c.rows[0].end / M, 80);
  near(c.rows[0].bufferUsed / M, 35, '115 range − 80 planned');
});

test('a long pit stop pushes the plan and grows the buffer', () => {
  const race = newRace();
  actStart(race, at(0));
  actPitIn(race, at(105));
  const c = compute(race, at(115));
  eq(c.phase, 'pit');
  near(c.pitElapsed / M, 10);
  eq(spans(c), [[0, 105], [115, 220], [225, 330], [335, 360]]);
  near(c.finalSlack / M, 80);
});

test('an overdue stint pushes the next stint start', () => {
  const race = newRace();
  actStart(race, at(0));
  const c = compute(race, at(110));
  eq(spans(c)[0], [0, 110]);
  eq(spans(c)[1], [115, 220]);
  near(c.rows[0].bufferUsed / M, -5);
  near(c.fuelLeft / M, -5);
});

test('final stint has no pit window', () => {
  const race = newRace();
  actStart(race, at(0));
  for (const [i, o] of [[105, 110], [215, 220], [325, 330]]) {
    actPitIn(race, at(i));
    actPitOut(race, at(o));
  }
  const c = compute(race, at(340));
  eq(c.cur.n, 4);
  eq(c.cur.isFinal, true);
  eq(c.pitIn, null);
  eq(c.pitOpen, null);
  eq(c.stopsLeft, 0);
});

test('race ending during a pit stop yields a zero-length final stint', () => {
  const c = previewPlan({ ...SIX_HOURS, raceLengthMin: 328 });
  eq(c.rows.length, 4);
  eq(c.rows[3].dur, 0);
  eq(c.finalSlack / M, 105);
});

test('pause stops the race clock and shifts wall times', () => {
  const race = newRace();
  actStart(race, at(0));
  actPause(race, at(10));
  eq(raceNow(race, at(12)) / M, 10);
  actResume(race, at(15));
  eq(raceNow(race, at(20)) / M, 15);
  eq(wallAt(race, 5 * M, at(20)), at(5));
  eq(wallAt(race, 12 * M, at(20)), at(17));
  eq(raceAt(race, at(17), at(20)) / M, 12);
  eq(raceAt(race, at(12), at(20)) / M, 10, 'inside the pause');
});

test('clock sync re-aligns elapsed time', () => {
  const race = newRace();
  actStart(race, at(0));
  actSyncClock(race, at(30), 32 * M);
  near(raceNow(race, at(30)) / M, 32);
  near(raceNow(race, at(40)) / M, 42);
});

test('finish closes the active stint and the safety car', () => {
  const race = newRace();
  actStart(race, at(0));
  actSafetyCar(race, at(50));
  actFinish(race, at(60));
  const c = compute(race, at(500));
  eq(c.phase, 'finished');
  eq(c.now / M, 60);
  eq(race.state.stints[0].end / M, 60);
  eq(race.state.sc[0].to / M, 60);
  eq(c.rows.length, 1);
  eq(c.rows[0].isFinal, true);
});

test('driver overrides continue the rotation', () => {
  const race = newRace();
  actEditStint(race, at(0), 2, { driver: 2 });
  eq(compute(race, at(0)).rows.map((r) => r.driver), [0, 2, 0, 1]);
});

test('planned pit-stop override moves the next stint', () => {
  const race = newRace();
  actEditStint(race, at(0), 2, { pit: 10 * M });
  const c = compute(race, at(0));
  eq(spans(c)[1], [115, 220]);
  near(c.finalSlack / M, 80);
});

test('edit validation', () => {
  const race = newRace();
  actStart(race, at(0));
  actPitIn(race, at(100));
  actPitOut(race, at(105));
  eq(validateEdit(race, at(110), 2, { start: 99 * M }) !== null, true, 'before previous pit-in');
  eq(validateEdit(race, at(110), 2, { start: 104 * M }), null);
  eq(validateEdit(race, at(110), 1, { end: 106 * M }) !== null, true, 'after next start');
  eq(validateEdit(race, at(110), 3, { dur: 10 }) !== null, true, 'too short');
});

test('stats summarise a finished race', () => {
  const race = newRace();
  actStart(race, at(0));
  actPitIn(race, at(100));
  actPitOut(race, at(106));
  actPitIn(race, at(200));
  actPitOut(race, at(204));
  actFinish(race, at(210));
  const s = raceStats(race);
  eq(s.stints.length, 3);
  eq(s.pits.map((p) => p.dur / M), [6, 4]);
  near(s.pitAvg / M, 5);
  eq(s.drivers.map((d) => d.stints), [1, 1, 1]);
  near(s.driveTotal / M, 200);
});

test('an overdue stop keeps PIT IN at the planned moment', () => {
  const race = newRace();
  actStart(race, at(0));
  actEditStint(race, at(0), 1, { dur: 80 * M });
  const c = compute(race, at(90));
  eq(c.pitIn / M, 80, 'pit in stays planned');
  eq(c.pitOpen <= c.pitIn, true, 'window not after pit in');
  eq(spans(c)[1], [95, 200], 'next stint planned from now');
});

test('pit window never opens after PIT IN', () => {
  const c = previewPlan({ ...SIX_HOURS, pitOpenFirstMin: 120 });
  eq(c.pitOpen <= c.pitIn, true);
});

test('planned duration recorded at stint start matches the sheet, also for the final stint', () => {
  const race = newRace();
  actStart(race, at(0));
  for (const [i, o] of [[105, 110], [215, 220], [325, 330]]) {
    actPitIn(race, at(i));
    actPitOut(race, at(o));
  }
  eq(race.state.stints[0].planDur / M, 105);
  eq(race.state.stints[3].planDur / M, 30);
});

test('durations longer than the fuel range are rejected', () => {
  const race = newRace();
  eq(validateEdit(race, at(0), 3, { dur: 120 * M }) !== null, true);
  eq(validateEdit(race, at(0), 3, { dur: 105 * M }), null);
});

test('clock sync keeps live-recorded stints at their real durations', () => {
  const race = newRace();
  actStart(race, at(0)); // START pressed 8 s after the real green flag
  actPitIn(race, at(105));
  actPitOut(race, at(110));
  actSyncClock(race, at(120), 120 * M + 8);
  const c = compute(race, at(120));
  eq(c.now, 120 * M + 8);
  eq(race.state.stints[0].end, 105 * M + 8, 'stint 1 really lasted 105:08');
  eq(race.state.stints[1].start, 110 * M + 8);
  eq(c.stintElapsed, 10 * M, 'current stint unchanged');
});

test('reset drops every override of a stint', () => {
  const race = newRace();
  actEditStint(race, at(0), 2, { dur: 60 * M, driver: 2 });
  actResetStint(race, 2);
  eq(race.state.plan[2], undefined);
});

test('live stats count the stint on track by time driven', () => {
  const race = newRace();
  actStart(race, at(0));
  const s = raceStats({ ...race, state: { ...race.state, startedAt: Date.now() - 10 * 60_000 } });
  near(s.driveTotal / M, 10, '', 0.05);
});

test('malformed state is normalised instead of breaking compute', () => {
  const st = normalizeState({ status: 'running', startedAt: 'x', stints: 'nope', plan: { a: 1, 2: { dur: 'x', pit: 60 } } });
  eq(st.status, 'draft');
  eq(st.stints, []);
  const st2 = normalizeState({ status: 'paused', startedAt: 5, pauses: [], plan: { 2: { dur: 'x', pit: 60 } } });
  eq(st2.status, 'running', 'paused without an open pause');
  eq(st2.stints.length, 1, 'started race gets stint 1');
  eq(st2.plan, { 2: { pit: 60 } });
  compute({ settings: SIX_HOURS, state: st2 }, Date.now());
});

test('a stop without refuel carries the fuel left into the next stint', () => {
  const race = newRace();
  actStart(race, at(0));
  actPitIn(race, at(105));
  actPitOut(race, at(110));
  actPitIn(race, at(168), { refuel: false }); // repair 58′ into stint 2
  actPitOut(race, at(172));
  const c = compute(race, at(173));
  eq(spans(c), [[0, 105], [110, 168], [172, 219], [224, 329], [334, 360]]);
  eq(c.rows[2].cap / M, 47, 'only the fuel left');
  eq(c.rows[1].noRefuel, true);
  eq(c.rows[1].bufferUsed, 0, 'carried fuel is not used buffer');
  eq(c.finalSlack / M, 79, 'buffer grows by the 4′ stop');
  eq(c.rows[2].driver, c.rows[1].driver, 'same driver carries on');
  eq(c.rows[3].driver, (c.rows[2].driver + 1) % 3, 'rotation resumes after the next refuel');
  eq(c.pitIn / M, 219);
});

test('while in the pit the plan already uses the fuel left, and the stop type can be switched', () => {
  const race = newRace();
  actStart(race, at(0));
  actPitIn(race, at(60), { refuel: false });
  let c = compute(race, at(62));
  eq([c.next.cap / M, c.next.driver], [45, 0]);
  actSetRefuel(race, 1, true);
  c = compute(race, at(62));
  eq([c.next.cap / M, c.next.driver], [105, 1]);
  eq(race.state.stints[0].noRefuel, undefined);
});

test('safety car range adds to the fuel carried over', () => {
  const race = newRace();
  actStart(race, at(0));
  actPitIn(race, at(60), { refuel: false });
  actPitOut(race, at(62));
  actSafetyCar(race, at(70), true);
  actSafetyCar(race, at(80), false);
  const c = compute(race, at(81));
  eq(c.rows[1].cap / M, 50, '45 left + 10 SC minutes × 0.5');
});

test('stats keep stops without refuel apart', () => {
  const race = newRace();
  actStart(race, at(0));
  actPitIn(race, at(50), { refuel: false });
  actPitOut(race, at(53));
  actPitIn(race, at(100));
  actPitOut(race, at(106));
  actFinish(race, at(120));
  const s = raceStats(race);
  eq([s.refuelStops, s.otherStops], [1, 1]);
  eq(s.pits.map((p) => p.refuel), [false, true]);
  near(s.pitAvg / M, 6, 'average of refuel stops only');
});

test('pit-in events carry the stop type through replay', () => {
  const ops = [
    { id: 'a', type: 'start', at: at(0), args: {} },
    { id: 'b', type: 'pitIn', at: at(40), args: { refuel: false } },
    { id: 'c', type: 'stopType', at: at(41), args: { n: 1, refuel: true } },
  ];
  const r = replay({ settings: SIX_HOURS, state: { status: 'draft' } }, ops);
  eq(r.state.stints[0].noRefuel, undefined, 'switched back to refuel');
  eq(replay({ settings: SIX_HOURS, state: { status: 'draft' } }, ops.slice(0, 2)).state.stints[0].noRefuel, true);
  eq([opLabel(ops[1]), opLabel(ops[2])], ['Pit in · no refuel', 'Refuel at stop 1']);
});

test('pit window reason: rule, buffer, or any time', () => {
  eq(previewPlan({ ...SIX_HOURS, pitStopMin: 0 }).pitOpenBy, 'buffer');
  eq(previewPlan({ ...SIX_HOURS, pitOpenFirstMin: 60 }).pitOpenBy, 'rule');
  const race = newRace();
  actStart(race, at(0));
  actPitIn(race, at(105));
  actPitOut(race, at(110));
  actEditStint(race, at(110), 2, { dur: 20 * M }); // 20′ stint, buffer > stint
  eq(compute(race, at(111)).pitOpenBy, 'any');
});

out(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`Failed: ${failures.join(', ')}`);
