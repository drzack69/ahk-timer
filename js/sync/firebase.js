// Firebase adapter: races are shared through Cloud Firestore, so every signed-in
// device sees the same live race. Firestore keeps a local cache, so a device
// that loses signal at the track keeps working and catches up when it's back.
//
// Data layout
//   races/{raceId}            name, base (starting state), snap (latest state,
//                              for the race list), opCount, lastOp, timestamps
//   races/{raceId}/ops/{id}   one document per operation (immutable)

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

function authMessage(e) {
  const code = String(e?.code || '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|missing-password/.test(code)) {
    return 'Wrong username or password.';
  }
  if (code.includes('network-request-failed')) return 'No connection — signing in needs internet once per device.';
  if (code.includes('too-many-requests')) return 'Too many attempts — wait a minute and try again.';
  if (code.includes('user-disabled')) return 'This account has been disabled.';
  // Setup mistakes (see README → Team sync)
  if (code.includes('api-key-not-valid')) return 'The Firebase config in config.js is wrong (API key) — copy it again from the Firebase console.';
  if (/operation-not-allowed|configuration-not-found/.test(code)) {
    return 'Email/Password sign-in is not enabled — Firebase console → Authentication → Sign-in method.';
  }
  if (code.includes('unauthorized-domain')) return 'This site’s domain is not authorised — add it in Firebase → Authentication → Settings.';
  return `Sign-in failed (${code || e?.message || 'unknown error'}).`;
}

function dataMessage(e) {
  const code = String(e?.code || '');
  if (code.includes('permission-denied')) {
    return 'No access to team races — ask your admin to add your login to the Firestore rules.';
  }
  if (code.includes('unavailable')) return 'Sync is offline — changes are kept on this device until it reconnects.';
  return `Sync error (${code || e?.message || 'unknown'}).`;
}

export async function createFirebaseAdapter(config, { usernameDomain = 'ahk-timer.app' } = {}) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);

  const app = initializeApp(config);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch {
    // Private browsing or no IndexedDB: fall back to an in-memory cache.
    db = F.initializeFirestore(app, { localCache: F.memoryLocalCache() });
  }

  // "pepa" signs in as pepa@<usernameDomain>; a full email is used as typed.
  const toEmail = (name) => {
    const n = String(name || '').trim();
    return n.includes('@') ? n : `${n.toLowerCase()}@${usernameDomain}`;
  };
  const label = (u) => {
    if (!u) return null;
    const email = u.email || '';
    return email.endsWith(`@${usernameDomain}`) ? email.slice(0, -(usernameDomain.length + 1)) : email || u.uid;
  };

  const authCbs = new Set();
  const ready = new Promise((resolve) => {
    let first = true;
    A.onAuthStateChanged(auth, (u) => {
      if (first) {
        first = false;
        resolve();
      } else authCbs.forEach((cb) => cb(label(u)));
    });
  });

  // Sync status for the top bar: offline / saving / synced.
  let pending = 0;
  const statusCbs = new Set();
  const status = () => (!navigator.onLine ? 'offline' : pending > 0 ? 'syncing' : 'online');
  const emitStatus = () => statusCbs.forEach((cb) => cb(status()));
  window.addEventListener('online', emitStatus);
  window.addEventListener('offline', emitStatus);
  const track = (promise) => {
    pending++;
    emitStatus();
    return promise.finally(() => {
      pending--;
      emitStatus();
    });
  };

  const raceRef = (id) => F.doc(db, 'races', id);
  const opsCol = (id) => F.collection(db, 'races', id, 'ops');
  const wrap = (p) => track(p).catch((e) => Promise.reject(new Error(dataMessage(e))));

  return {
    mode: 'cloud',
    ready,
    user: () => label(auth.currentUser), // set as soon as sign-in completes
    onAuth(cb) {
      authCbs.add(cb);
      return () => authCbs.delete(cb);
    },
    async signIn(username, password) {
      try {
        await A.signInWithEmailAndPassword(auth, toEmail(username), String(password || ''));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: authMessage(e) };
      }
    },
    signOut: () => A.signOut(auth),
    watchRaces(cb, onError) {
      return F.onSnapshot(
        F.collection(db, 'races'),
        (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
        (e) => onError?.(new Error(dataMessage(e))),
      );
    },
    watchOps(id, cb, onError) {
      return F.onSnapshot(
        opsCol(id),
        (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
        (e) => onError?.(new Error(dataMessage(e))),
      );
    },
    addOp(id, op, patch) {
      const batch = F.writeBatch(db);
      batch.set(F.doc(db, 'races', id, 'ops', op.id), { ...op, savedAt: F.serverTimestamp() });
      batch.update(raceRef(id), patch);
      return wrap(batch.commit());
    },
    createRace(doc) {
      return wrap(F.setDoc(raceRef(doc.id), doc));
    },
    updateRace(id, patch) {
      return wrap(F.updateDoc(raceRef(id), patch));
    },
    async deleteRace(id) {
      // The race document goes first so it disappears everywhere at once;
      // its operations follow in batches (Firestore has no cascading delete).
      let opDocs = [];
      try {
        opDocs = (await F.getDocs(opsCol(id))).docs;
      } catch {
        /* offline without cache: delete what we can */
      }
      const first = F.writeBatch(db);
      first.delete(raceRef(id));
      opDocs.slice(0, 450).forEach((d) => first.delete(d.ref));
      const commits = [wrap(first.commit())];
      for (let i = 450; i < opDocs.length; i += 450) {
        const b = F.writeBatch(db);
        opDocs.slice(i, i + 450).forEach((d) => b.delete(d.ref));
        commits.push(wrap(b.commit()));
      }
      await Promise.all(commits);
    },
    onStatus(cb) {
      statusCbs.add(cb);
      cb(status());
      return () => statusCbs.delete(cb);
    },
  };
}
