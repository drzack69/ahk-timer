# AHK Timer

Stint planning and a live pit-wall monitor for endurance races. It's a static web
app with no server and no build step, so it runs straight from GitHub Pages and
keeps working offline at the track.

## Screens

| Screen | What it does |
|---|---|
| **Login** | Username + password gate (accounts in `config.js`). |
| **Races** | All races of the season: create, rename, duplicate, delete, open, statistics. Export / import a JSON backup. |
| **Settings** | Race length, max stint, pit open (stint 1), number of drivers (+ names), ≈ pit-stop duration, safety-car coefficient. A live preview shows stints, stops and the buffer while you type. |
| **Monitor** | Time elapsed / left, race timeline, current stint timer, PIT IN and PIT OPEN times, the **PIT IN / SAFETY CAR / PIT OUT** buttons, the stint sheet, undo, pause/resume and finish. |
| **Statistics** | After the race: KPIs, timeline, stint durations vs plan, pit stops, driving time per driver, full stint log. |

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
- **Overdue stint.** If the car stays out past its planned end, the rest of the plan shifts later and the stint shows `OVER` once it passes its fuel range.

## Using the monitor

1. **START** at the green flag. Every timer is calculated from timestamps, so reloading the page, locking the tablet or switching tabs never loses time.
2. **PIT IN** when the car enters the pit lane. This closes the stint and updates the buffer.
3. **PIT OUT** when it leaves. The next stint starts and every upcoming time adjusts.
4. **SAFETY CAR** toggles the SC period on and off.
5. Tap any cell of the stint sheet to edit it: driver, start (moves the pit stop before it), duration, end, or buffer used. The dialog previews the effect before you apply it.
6. Tap the time bar to **sync the race clock** with the official timing screen.
7. **Undo** reverts the last change, up to 40 steps per race. **Pause** stops the race clock (red flag).
8. The race finishes automatically at zero, or with **Finish**. Statistics open from the bottom bar or the race list.

*Clock / Race time* above the sheet switches between wall-clock times and race-relative times.

## Run locally

ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Deploy to GitHub Pages

1. Create a GitHub repository, e.g. `ahk-timer`, and push these files:

   ```bash
   git init
   git add .
   git commit -m "AHK Timer"
   git branch -M main
   git remote add origin https://github.com/<your-user>/ahk-timer.git
   git push -u origin main
   ```

2. In the repository, open **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After about a minute the app is live at `https://<your-user>.github.io/ahk-timer/`.

On a tablet, use **Add to Home Screen** to get a full-screen app that also opens offline.
The screen stays awake while a race is running, where the browser supports it.

## Login

Default account: username **`ahk`**, password **`boxbox`**. Change it before you publish.

1. Hash your new password:

   ```bash
   printf '%s' 'your-new-password' | shasum -a 256
   ```

2. Paste the hash into `config.js`. Add more `{ username, passwordSha256 }` entries for more users.

GitHub Pages only serves static files, so the login keeps casual visitors out of the
UI but isn't server-side security. Anyone who can open the site can read its files,
including the password hash, so use a long password. Race data never leaves the
browser. For real access control, put the site behind something like Cloudflare Access.

## Data

- Races are saved in the browser's local storage, separately on each device and browser.
- **Export** on the Races screen downloads a JSON backup. **Import** loads it on another device, for example laptop → pit-wall tablet.
- Clearing site data in the browser deletes the races, so export after each race.

## Project structure

```
index.html            app shell
config.js             login accounts (SHA-256 password hashes)
css/app.css           all styles (colour tokens at the top)
js/engine.js          strategy engine: plan, buffer, pit window, actions (pure, tested)
js/store.js           local storage, undo history, export/import
js/views/*.js         login, races, settings, monitor, stats
js/timeline.js        race timeline strip
js/format.js          time formatting / parsing
js/icons.js           SVG icons + AHK logo
sw.js                 offline cache (bump CACHE when adding files)
tests/                engine unit tests
```

## Tests

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/engine.test.mjs
```

That runs on any Mac without installing anything. You can also open `tests/index.html` through the local server.
