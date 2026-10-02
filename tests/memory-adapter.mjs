// In-memory stand-in for the Firebase adapter, for tests: several "devices"
// share one server object. A device can go offline; its writes then only show
// up locally (like Firestore's cache) until it comes back online.

const copy = (v) => JSON.parse(JSON.stringify(v));

export function createServer() {
  return { races: new Map(), ops: new Map(), devices: new Set() };
}

export function createMemoryAdapter(server, userName = 'tester') {
  let online = true;
  let frozen = null; // what the server looked like when this device lost signal
  const queue = [];
  const raceCbs = new Set();
  const opCbs = new Map();
  const statusCbs = new Set();

  // What this device sees: the server plus its own unsent writes.
  function view() {
    const src = frozen ?? server;
    const races = new Map([...src.races].map(([k, v]) => [k, copy(v)]));
    const ops = new Map([...src.ops].map(([k, v]) => [k, new Map([...v].map(([a, b]) => [a, copy(b)]))]));
    for (const w of queue) w(races, ops);
    return { races, ops };
  }
  function notify() {
    const v = view();
    const races = [...v.races.values()];
    raceCbs.forEach((cb) => cb(copy(races)));
    opCbs.forEach((set, id) => {
      const list = copy([...(v.ops.get(id)?.values() ?? [])]);
      set.forEach((cb) => cb(list));
    });
  }
  server.devices.add({ notify });
  const broadcast = () => server.devices.forEach((d) => d.notify());
  function apply(w) {
    if (online) {
      w(server.races, server.ops);
      broadcast();
    } else {
      queue.push(w);
      notify();
    }
    return Promise.resolve();
  }

  return {
    mode: 'cloud',
    ready: Promise.resolve(),
    user: () => userName,
    onAuth: () => () => {},
    signIn: async () => ({ ok: true }),
    signOut: async () => {},
    watchRaces(cb) {
      raceCbs.add(cb);
      cb(copy([...view().races.values()]));
      return () => raceCbs.delete(cb);
    },
    watchOps(id, cb) {
      if (!opCbs.has(id)) opCbs.set(id, new Set());
      opCbs.get(id).add(cb);
      cb(copy([...(view().ops.get(id)?.values() ?? [])]));
      return () => opCbs.get(id).delete(cb);
    },
    addOp(id, op, patch) {
      return apply((races, ops) => {
        if (!ops.has(id)) ops.set(id, new Map());
        ops.get(id).set(op.id, copy(op));
        const d = races.get(id);
        if (d) races.set(id, { ...d, ...copy(patch) });
      });
    },
    createRace(doc) {
      return apply((races) => races.set(doc.id, copy(doc)));
    },
    updateRace(id, patch) {
      return apply((races) => {
        const d = races.get(id);
        if (d) races.set(id, { ...d, ...copy(patch) });
      });
    },
    deleteRace(id) {
      return apply((races, ops) => {
        races.delete(id);
        ops.delete(id);
      });
    },
    onStatus(cb) {
      statusCbs.add(cb);
      cb(online ? 'online' : 'offline');
      return () => statusCbs.delete(cb);
    },
    goOffline() {
      online = false;
      frozen = view();
      statusCbs.forEach((cb) => cb('offline'));
    },
    goOnline() {
      online = true;
      frozen = null;
      for (const w of queue.splice(0)) w(server.races, server.ops);
      statusCbs.forEach((cb) => cb('online'));
      broadcast();
    },
  };
}
