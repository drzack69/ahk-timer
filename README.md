# AHK Timer

Stint planning and a live pit-wall monitor for endurance races. It's a static web
app with no build step, so it runs straight from GitHub Pages and keeps working
offline at the track. With **team sync** switched on, every signed-in device
(pit-wall laptop, tablet in the pit lane, drivers' phones) shows the same race live.

## Screens

| Screen | What it does |
|---|---|
| **Login** | Username + password. |
| **Races** | All races of the season: create, rename, duplicate, delete, open, statistics. Export / import a JSON backup. |
| **Settings** | Race length, max stint, pit open (stint 1), number of drivers (+ names), ≈ pit-stop duration, safety-car coefficient. A live preview shows stints, stops and the buffer while you type. |
| **Monitor** | Time elapsed / left, race timeline, current stint timer, PIT IN and PIT OPEN times, the **PIT IN / SAFETY CAR / PIT OUT** buttons, the stint sheet, undo, pause/resume, finish and a view-only lock. |
| **Statistics** | After the race: KPIs, timeline, stint durations vs plan, pit stops, driving time per driver, full stint log. |

## Team sync — several devices, one race

Without setup, races are saved on each device separately. Connect a free
[Firebase](https://firebase.google.com) project and the whole team shares them:

- **Live on every device.** Press PIT IN on the pit-lane tablet and the pit-wall laptop updates within a second. Other people's actions pop up as a note, e.g. *Pit out · pepa*.
- **Works through signal drops.** A device without connection keeps working and catches up when it's back. The top bar shows *Synced*, *Saving…* or *Offline*.
- **No overwriting.** Each button press is stored as a separate event, such as PIT IN at 10:45:12 by pepa. Every device replays the same events in time order, so two people tapping at once, or a device that was offline, merge cleanly. Undo cancels the latest change, whoever made it.
- **Real accounts.** Only logins you create can read or change races.
- **View only.** The lock button in the monitor's bottom bar disables the controls on that device. Use it for the TV screen or drivers' phones.

### Setup (one time, about 10 minutes)

1. Go to <https://console.firebase.google.com> and click **Create a project**, e.g. `ahk-timer`. Google Analytics isn't needed. The free *Spark* plan is plenty.
2. **Security → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
3. **Security → Authentication → Users → Add user**, once per person, or one shared team login. Use your usernames with the domain from `config.js`: `pepa@ahk-timer.app`, `team@ahk-timer.app` … Each person then signs in with just `pepa` and their password.
4. **Security → Authentication → Settings → Authorized domains → Add domain:** `drzack69.github.io`
5. **Databases & Storage → Firestore → Create database →** *Standard* edition if asked, a European location such as `eur3 (europe)` → *Start in production mode* → **Create**.
6. **Firestore → Rules:** paste the contents of [`firestore.rules`](firestore.rules). Replace the email list in `teamEmails()` with the logins from step 3, then **Publish**.
7. **Project settings (⚙) → General → Your apps → Web (`</>`)**, register an app called "AHK Timer" (no Firebase Hosting needed). Copy the `firebaseConfig` values into `config.js`. You can find them again later under *Project settings → General → Your apps → SDK setup and configuration → Config*.

   ```js
   export const FIREBASE = {
     apiKey: 'AIza…',
     authDomain: 'ahk-timer.firebaseapp.com',
     projectId: 'ahk-timer',
     appId: '1:…:web:…',
   };
   ```

8. Commit and push. Every device now signs in with its username and password.

The Firebase config is not a secret: access is controlled by the accounts and the
rules. To add someone later, create the user (step 3), add their email to the
rules (step 6) and publish.

**Already have races on a device?** After switching sync on, the race list on that
device offers **Upload to team** for races that were saved there before.

**Tips**

- Keep every device on automatic date & time. Events are stamped with the device's clock.
- Sign in once on each device while online. After that it also starts offline.
- Usage stays far below the free limits. A 24-hour race with several devices is a few thousand reads and writes.

## How the strategy maths works

**Stints and buffer.** Every stint is planned at its full fuel range (max stint). The
last stint only has to reach the flag, so it is usually shorter. Its unused range is
the **buffer**: the total time you can still pit early, summed over all stints,
without needing an extra stop.

Example: 6 h race, 105 min max stint, 5 min pit stops →

| Stint | Start | Duration | End |
|---|---|---|---|
| 1 | 0:00 | 105′ | 1:45 |
| 2 | 1:50 | 105′ | 3:35 |
| 3 | 3:40 | 105′ | 5:25 |
| 4 | 5:30 | 30′ (to the flag) | 6:00 |

The buffer is **75′** (105′ − 30′). Why not the 45′ you get from 360 / 105 = 3 rem 45?
That 45′ is the length of a short final stint *if pit stops took no time*, and even then
the buffer would be 105′ − 45′ = 60′. Because the race clock keeps running during
the three 5′ stops, 15 fewer minutes need driving, so the final stint is only 30′ and
the buffer is 75′. Set the pit stop to 0 and you'll see 60′.

- **Shortening a stint uses buffer.** Make stint 3 70′ instead of 105′ and the buffer drops by 35′. The sheet tags the stint `−35′`, and the *Buffer left* column counts down after it.
- **Use more than the buffer and the plan adds a pit stop.** The edit dialog warns you before you apply it.
- **PIT OPEN** is the earliest moment the current stint can stop without adding a stop (planned end − buffer). In stint 1 it is never earlier than the *pit open* setting.
- **Safety car.** The coefficient is fuel burn under SC compared to green (0.5 = half). Each SC minute adds (1 − coefficient) minutes of range to the stint it happens in, so the current stint's PIT IN moves later. SC time while the car is in the pits doesn't count.
- **Pit stops.** The ≈ pit-stop setting plans future stints. Real stops are timed from PIT IN to PIT OUT. A longer stop *adds* buffer, because less driving is left, and a quicker one uses some.
- **Overdue stint.** PIT IN keeps the planned time and turns red with *Box now +mm:ss*. The rest of the plan shifts later.

## Using the monitor

1. **START** at the green flag. Every timer is calculated from timestamps, so reloading the page, locking the tablet or switching tabs never loses time.
2. **PIT IN** when the car enters the pit lane. This closes the stint and updates the buffer.
3. **PIT OUT** when it leaves. The next stint starts and every upcoming time adjusts.
   - **PIT IN · no refuel** (the smaller grey button) is for stops without fuel, such as a repair or a stop-and-go penalty. The next stint keeps the fuel that was left, plus any safety-car range, and the same driver carries on. A stop like this uses no buffer: the plan shifts by the stop's length, and the buffer grows by the same amount. While the car is in the pit you can still switch the stop between *Refuel* and *No refuel*. Afterwards, change it in the stint editor.
4. **SAFETY CAR** toggles the SC period on and off.
5. Tap any cell of the stint sheet to edit it: driver, start (moves the pit stop before it), duration, end, or buffer used. The dialog previews the effect before you apply it.
6. Tap the time bar to **sync the race clock** with the official timing screen.
7. **Undo** cancels the latest change. **Pause** stops the race clock for a red flag. The **lock** makes this device view-only.
8. The race finishes by itself when the clock reaches zero, or early with **Finish**. If it finished because someone forgot to pause during a red flag, open the clock sync and enter the real time left; the race carries on. Statistics open from the bottom bar or the race list.

*Clock / Race time* above the sheet switches between wall-clock times and race-relative times.

## Run locally

ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Deploy to GitHub Pages

The site is published from the `main` branch of this repository (**Settings → Pages
→ Deploy from a branch → `main` / (root)**), at `https://drzack69.github.io/ahk-timer/`.
Push to `main` and it updates within a minute.

On a tablet, use **Add to Home Screen** to get a full-screen app that also opens offline.
The screen stays awake while a race is running, where the browser supports it.

## Login

**With team sync**, accounts are the Firebase users from setup step 3. Manage them
in the Firebase console, where you can also reset passwords and disable accounts.

**Without team sync**, accounts are listed in `config.js` (`USERS`). Default:
username **`ahk`**, password **`boxbox`**. Change it:

1. Hash your new password:

   ```bash
   printf '%s' 'your-new-password' | shasum -a 256
   ```

2. Paste the hash into `config.js`.

Without team sync the login only keeps casual visitors out of the UI, because GitHub
Pages serves static files and anyone can read them, including the hash. Race data
then stays in each browser.

## Data

- **Team sync:** races live in your Firestore database. Every signed-in device has a copy for offline use.
- **This device only:** races are saved in the browser's local storage. Clearing site data deletes them.
- **Export** on the Races screen downloads a JSON backup. **Import** adds the races from such a file. Use it as a backup after each race, or to move races between devices.

## Project structure

```
index.html            app shell
config.js             team sync (Firebase) settings and local login accounts
firestore.rules       Firestore security rules for team sync
css/app.css           all styles (colour tokens at the top)
js/engine.js          strategy engine: plan, buffer, pit window, actions (pure, tested)
js/ops.js             race events: apply, replay, undo (pure, tested)
js/store.js           races + events, optimistic updates, export/import
js/sync/local.js      storage on this device (localStorage)
js/sync/firebase.js   team sync (Firebase Auth + Cloud Firestore)
js/views/*.js         login, races, settings, monitor, stats
js/timeline.js        race timeline strip
js/format.js          time formatting / parsing
js/icons.js           SVG icons + AHK logo
sw.js                 offline cache (bump CACHE when adding files)
tests/                engine and multi-device sync tests
```

## Tests

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/engine.test.mjs
```

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/sync.test.mjs
```

Both run on any Mac without installing anything. The sync tests simulate several
devices sharing one server, including going offline and reconnecting.
