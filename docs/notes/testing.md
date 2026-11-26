# Testing: which browser suites to run, and where

The checks are the same everywhere; what this note decides is how many of the browser suites a
change needs and on which machine they run. Nothing here removes or loosens a check: the full set
(every suite in `FULL` of `scripts/affected.mjs`, the list in HANDOFF.md "Checks before every
deploy") stays the gate before a large push.

## In short

1. `node scripts/affected.mjs --base origin/claude/friendly-hypatia-up418z --why`: the suites your
   change can affect.
2. `node scripts/remote-test.mjs --name <you>` (in the background): those suites on GitHub, a runner
   each, results and pictures in `out/remote-<sha>/`. Add `--suites all` once per batch, when no
   other full run is in flight.
3. Locally, only when you need to watch a suite or GitHub is busy: the 3-suite cap below.

## 1. Choose the suites

    node scripts/affected.mjs --base origin/claude/friendly-hypatia-up418z --why

prints the suites the change since that branch can affect (committed and uncommitted files), and
with `--why` which file picked each. `node scripts/affected.mjs <files...>` does the same for a
list of files; `--all` prints the full set.

The map is coarse on purpose and errs towards running more:

- a file it does not name under `src/`, `public/`, `index.html`, `package*.json`, `vite.config.ts`
  or `tsconfig.json` picks the **full set** (everything goes through `src/app/App.ts`);
- the loading screen, `scripts/lib/browser.mjs` and the workflow file pick the full set too;
- a suite's own script picks that suite; `scripts/lib/touch.mjs` the suites that use fingers;
- areas with a clear owner pick their suites: the ship (`src/game/`, the ship's physics) picks
  flight, game, ship, vr, verify, walk; the ground picks walk, terrain, touch, flight, verify; live
  physics and the powers pick live, whatif; the interface (`src/ui/Hud.ts`, `styles.css`) picks
  every suite that taps or clicks it; and so on (the rules are at the top of the script);
- docs, unit tests (`tests/`), the data pipeline and the trailer pick none.

When you add a suite, add it to `FULL`; when you add a file that clearly belongs to an area, add
it to that area's rule (or leave it: unnamed files run everything).

**Run the affected suites** for each change while you work. **Run the full set** (`Suites: all`
below, or every suite locally) once per batch: before pushing a large change, before a deploy you
care about, and whenever the map's answer surprises you.

## 2. Run them on GitHub (preferred)

Every suite gets its own 4-core runner, all at once, instead of sharing this machine's 4 cores:

    node scripts/remote-test.mjs --name <you>                 # the affected suites of HEAD
    node scripts/remote-test.mjs --name <you> --suites all    # the full set
    node scripts/remote-test.mjs --name <you> --suites "flight walk"

It pushes a commit with the files of HEAD (committed work only; your branch does not move) to your
test branch `claude/test-<you>`, which runs `.github/workflows/browser-tests.yml` (build once, then
one job per suite), waits, downloads each job's log and pictures to `out/remote-<sha>/<job>/` (or
`--out <dir>`), prints pass/fail per job with the failing checks, and exits 0 only if every job
passed. It takes about as long as the slowest chosen job plus ~3 minutes (build, browser setup).
Run it in the background.

- **One full run at a time, for everyone.** The account runs about 20 jobs at once, shared by all
  helpers *and by the live site's deploys* (deploy-pages.yml): a full set is 19 jobs. Start a
  `--suites all` run only when no other full run is in flight (look at
  https://github.com/dippy34/starfarer/actions or `mcp__github__actions_list` `list_workflow_runs`),
  once per batch before a large push. Small runs (the affected suites, `--suites "a b"`) are fine
  alongside one full run.
- **Cancel what you supersede.** A push to your test branch cancels the run still going on it (the
  workflow's `concurrency`), so a new trial replaces the last one by itself. To stop a run without
  starting another: `node scripts/remote-test.mjs --name <you> --cancel` (it pushes a `Suites: none`
  commit). Neither the GitHub API's cancel nor deleting a branch works from this container (both
  HTTP 403), which is why each helper keeps one test branch instead of a new one per run. For a
  second small run alongside your first, give it its own branch with `--lane <x>`.
- The longest suites run in parts, one job each (`PARTS` in `scripts/affected.mjs`): walk as
  `walk-touch`, `walk-desktop`, `walk-vr` (its own modes; `all` is the three), flight as
  `flight-desk` (1-12) and `flight-phone` (13-16, `FLIGHT_ONLY=desk|phone`). The parts together are
  the whole suite.
- `--suites` writes a `Suites:` trailer into the pushed commit (`all`, `none` or suite names); without
  it a `Suites:` trailer in HEAD's own message counts, else the map's choice for the change against
  `claude/friendly-hypatia-up418z`.
- To show that a new check fails on the app as it was before its fix:
  `node scripts/remote-test.mjs --name <you> --suites interact --old <commit before the fix>` runs
  today's scripts against the files of that commit.
- The workflow runs only on `claude/test-**` branches. It cannot deploy (deploy-pages.yml runs on
  `main` and `claude/friendly-hypatia-up418z` only) and has read-only permissions and no secrets.
  Artifacts are kept 3 days.
- `remote-test.mjs` is not a browser suite and does not count towards the local cap (below); it
  also renames its process to `remote-test`.

**The same browser and fonts as here.** The runner uses this container's browser build, Chrome for
Testing 153.0.8010.12 (`CHROME_VERSION` in the workflow; `/opt/pw-browsers/chromium --version`
here), driven by the pinned `@playwright/test`, with the same SwiftShader flags, on Ubuntu 24.04 like
this container (Playwright 1.56 cannot install its system libraries on 26.04, today's
`ubuntu-latest`), and with this container's fonts: Inter, and the fontconfig rule that makes Inter
the system-ui and sans-serif font (the interface asks for Inter; without it the text is DejaVu,
wider, and layouts and taps land elsewhere). With Playwright's own Chromium 141 and without those
fonts, walk's t2 and t3 failed there and passed here; with both, they pass there too. If the
container's browser or fonts change, change the workflow with them. (`CHROMIUM_PATH` unset, the
scripts fall back to Playwright's own Chromium: that works, it is just not this browser.)

**No pixel baselines.** No suite compares with pictures stored from an earlier run: every
measurement is made within the run (a frame against the frame before, a picture against the same
scene drawn another way). So nothing has to be kept per machine; and a picture taken there is not
to be diffed against one taken here.

**Not the same machine.** A runner's 4 cores are its own, but its frames are not uniformly faster:
verify's scenes draw 3-4x faster there than here under load, while walk, terrain and flight's deep
space ran 1.5-3x slower (a frame a second or two is usual there for flight, the Moon's ground and
the walks), and runners differ from one job to the next (Intel and AMD parts).

**Count frames, not seconds.** Most of the runner-only failures found so far came from one thing: the app
counts its time in frames, and a check that waits seconds for what takes frames passes at sixty
frames a second and fails at one. A frame is at most 0.1 s of the camera's and the ship's controls
(its easing, the flip of an autopilot, an ending's 45 frames), at most a second of the clock's and the
live-physics watch's, and the autopilot's warp is a share of the time to go a frame. So: wait for the
state, with a long bound (ten minutes; a suite's own steps are the measure), never for a number of
seconds; and where a check needs a state to *last* (a watch that is on, a toast, a ship that has not
yet fallen), hold it, or count from when it began.

**SLOW_FRAME_MS=n** (scripts/lib/browser.mjs) holds every animation frame of every page for n ms before
the app's frame runs: `SLOW_FRAME_MS=1000 node scripts/<suite>.mjs ...` is a runner at a frame a
second, here. It reproduced the live, interact and touch rows below before their fixes and shows them
passing after (the sections that are long at that rate can be run alone: `LIVE_ONLY=watch
LIVE_KINDS=desk`). A flake that does not show at 1000 may at 300 to 600: try several.

Checks that were the test's and are fixed (from the test-health pass of 23 November, against this
container; none loosened). The numbers are GitHub runner runs, github.com/dippy34/starfarer/actions/runs/<number>.

| check | was | cause | fix and the run after |
|---|---|---|---|
| ship: sideways "orbit lines, the path and its tags never draw over the ship" and "the ship is lit by the Sun" | fail here and there (n 90 and 85 against floors of 100; the answers were right) | since 0fce693 the Earth's card has a Size row and a temperature line: sideways the ship is framed in the strip over the card, which got shorter, so the ship is smaller and has fewer pixels to sample (n 131 and 122 up to 35fc045; 45206153137, 45211759470). Not the three "sideways" checks of ce1fa02, which 485b327 and 94f9dae fixed | measured with the card put away, as the bracket check beside them is (n 692 and 429, floors as they were); "on the screen, under nothing" and "no name over the ship" still with the card on. 45243068805: 33/33. The ship is about 100 px wide there with the card open: a known trade-off, HANDOFF.md |
| live: "the Moon's month" (phone and desk) | fail there and on the base (45206153137, 45216536036), pass here | the card said "a circle 738,670 km out" only where the orbit's two ends agree to the kilometre, else "nearly a circle, 738,670 to 738,671 km": the Sun pulls the Moon about 7e-7 off its circle in seconds, so the wording came by a rounding | app: an orbit under the stretch the details call 0 (e < 0.0005) is a circle in words (`orbitWords`); unit test. 45240361435: live 184/184 |
| flight-phone: the sky names "more than 50 names looked at" | 50, 51 or 52 from run to run, here and there (45230593811) | from the ship's first view, mostly Earth and dark, 1 to 6 names a screen: the floor sat on the edge of what there was | the eye is turned to Orion's belt first: 129 names, floor as it was (45242874244) |
| flight: "arrives at the star" (Rigil Kentaurus) | pass here (538 s under load), fail there: 7.3e9, 5.1e9, 4.5e12 m short with the autopilot braking (45206153137, 45230593811, 45211759470) | still the runner's pace, now measured: the flight is about 1,150 frames (a flip at x1 in steps of 0.1 s, a warp of a twentieth of the time to go a frame) and the loop gave it 900 s | waits for the arrival: up to 4,600 frames and an hour. 45248014161: arrived after about 1,017 s, flight-desk 26/26 |
| flight and game: a gentle drop is a landing (the Moon) | CRASHED there one run in three, 25.2 and 15.8 m/s in two of six probed (45206153137, 45242874244) | the ship is set 12 m over the coarse ground seen from 5 km up; the terrain is built finer under it, and the ground moved by +14 to +33 m and by -65 and -184 m while it fell, several frames of 2 to 3 s there (HANDOFF.md "Ground and level of detail") | the checks hold the ship at 12 m, time paused, until the terrain's jobs are done and the ground steady for 8 frames. And the app: a ship low over refined ground rides with it (`GroundRide`), flight.mjs 7b. 45248014161: flight-desk 26/26, game 21/21 |
| flight: after the crash, respawn in a safe orbit | fail once there ("pe -1,735 km", still the crash; 45211759470, 45242874244) | the ending counts 45 frames: about 120 s over the Moon there, in a wait of 120 s | the wait is ten minutes |
| flight-phone: with the drive too weak to climb, Go there says so (two checks) | fail there (45242874244) | the ship is boarded 2 km over the Earth and falls; a frame there is up to a second of flight, so it had hit the ground (59 m/s) before the notice was read | time held while the check is made. 45252506409: both pass |
| flight-phone: the instruments say so while it climbs | fail once there (45252506409) | read once, at the first frame of the climb, they still said "Autopilot: turning" | read through the climb until they say it; 45262156702: 66/66 |
| flight: More, How to move (scrolls to the help) | fail there (before ce1fa02's notes) | a fixed 800 ms for a smooth scroll that, at a frame a second, had not begun | waits for the scroll (a3a8655); "How to move" is first in More again (68982f7) |
| live: desk, Stop ends the watch | "crash" under load here (ce1fa02), pass there lately | the watch counts its 15 s in frames of a second at most, the camera eases in steps of a tenth: at a frame a second the watch is over after 15 frames, before the camera has finished easing out, and the Stop button is gone: Playwright waits "element is not visible" and the suite ends. Reproduced at SLOW_FRAME_MS=1000 (twice, also with a Replay before it) | Stop is pressed on a watch held on (its countdown set high; Replay if it is over already). At 1000: passes. 45262156702: passes |
| interact: time acceleration "Δ 1.00 d"; the flights to Mars, Sirius and the space station | fail now and then there (45216536036: Δ 1.00 d; the 60 s and 120 s waits) | the clock advances a second of its rate at most a frame: two seconds are one frame there, one day; the camera's flights are 60 frames and more, a minute and more there. Reproduced at 1000: the suite ended at the first wait | the day-a-second check waits for the two days; the flights' waits are bounds of ten minutes. At 1000: goto Mars passes, Δ 3.00 d. 45262156702: goto Mars, Δ 2.48 d, the camera's co-move pass |
| touch: photo mode "the centre is the middle of the screen" | fail once there (45263636238; the two other runs and every other check passed) | waited for the centre within a pixel of the middle, then three frames, and asked it to be exactly the middle: it is set there within 0.05 px after some frames, three at a frame a second and many at sixty | waits for it to be exactly 0. touch 99/99 on the runner after (45272797197, with the Save a picture fix) |
| touch: Save a picture says where it went, "still to be read three seconds on" | fail at SLOW_FRAME_MS=800 here (toast: null) | three seconds counted from the download, which is a frame, a second or more, after the toast went up (a wall-clock toast) | counts from when the toast went up |
| touch: sideways "a sheet fits the height and scrolls inside" | its foot at 398 of 390 px, twice there (45647209362, 25 Nov; 45725502491, the tab bar at 1bb042e) | an open sheet slides up 18 px as it comes (`sheet-in`, styles.css): 398 is its resting foot, 380, plus those 18 px. The box was read two frames after the tap, before the slide had run. At rest it fits (top 62, foot 380, here) | read once the sheet's opening animation has ended (at most 2 s), the bounds as they were |

Still seen, not explained (these are listed so that a failure of one is not a surprise; none has been
a failure of the app that we know of):

| check | where seen | what is known |
|---|---|---|
| touch: pinching the other way lifts off | one runner run at ce1fa02 (1.6 m both times), and 45725502491 at 1bb042e (26 Nov, 1.6 m both times again; that change, the tab bar's look, touches no gesture) | 3 runner runs of touch since (99/99, 99/99, 98/99: altitudes 152.8, 38.0, 50.3 m, different each time) and one run at SLOW_FRAME_MS=800 (70.2 m) pass it. Not reproduced; the old failure left the camera at the ground's eye height as if the zoom were not applied |
| live: phone, a sun made, its mass changed later with Mass (and, at SLOW_FRAME_MS=450 here, once in five, the red dwarf one before it) | 45262156702 (2.000 Suns where 0.8 was asked, the radius a step behind) | a drag on the card's mass slider that did not land where asked; 8 runs here at 150 to 1000 ms pass it but one. Not reproduced; the next place to look is the slider's box read while the card is still settling |
| interact: search and go to Sirius, after the walks | 45262156702 (the 600 s wait ended the suite; the walks before it took 12 to 17 minutes each there) | passes here alone at SLOW_FRAME_MS=1000 and in the whole suite at a normal frame rate (21 checks, 40 minutes under load). Not reproduced; the wait now ends in a failed check that names what it saw, so the suite goes on to the space station |
| touch: 'set to "Look", one finger looks around instead' | 45606060317 and 45617640388 (25 Nov), since the card was redone (95946c0); passed in 45599710134, 45611808107 and 45639256519 | the tap on the round button did not switch the drag to Look (`{"mode":"orbit"}`). Being worked on: TASKS.md task/look-button |
| touch: a double-tap on the world you are at "comes six times closer" (upright 3.97, on its side 5.36) | 45647209362 (25 Nov), once, with three checkers' runs sharing the runners; the same app passed touch 108/108 in 45639256519 | not reproduced; both are measured while the camera is still moving, so a slow frame is the first suspect (that run's third failure, the sideways sheet, is explained above) |
| live: desk, "let go, Mars falls at the Earth … time slows … the last of the fall takes about three seconds" | 45639256519 (25 Nov): the chip read "Watching: 20.1 hours a second", not "Slowed", and the hit came 8.6 s after, not about 6; the phone run passed (6.1 s) | not reproduced; a timing check on a slow runner |
| everywhere: deep, "beside Andromeda: the whole place check runs without a driver exception" (Go there's button: `scrollIntoViewIfNeeded` 30 s timeout) | the run of 4521a5e (25 Nov), once | the rerun on the same app passed deep 39/39; not reproduced |

Read a runner-only failure the way you would a failure under load here: run that suite again
(there or here) before believing it, and never loosen a check to make either side green.

### The "everywhere" suite's known failures

`scripts/everywhere.mjs` (parts solar, stars, planets and deep) visits 20 places across space and
checks the same things at each. Some checks fail on purpose until their fixes land, never loosened
(25 Nov 2026, run 45647148783: 144 checks, 141 passed):

- stars: "Alpha Centauri: found by the typed name" and planets: "Vega b (generated): found by the
  typed name": the search does not know those names yet (TASKS.md task/search-names, in review).
  Later the same day a star people know (seen by eye, or within 10 parsecs) lost its made-up planets,
  Vega among them: the made-up planet visited is now Gl 9848 b, of a faint star 56 parsecs off.
- deep: "Milky Way: tapping the object on screen selects it": fixed by galaxy picking (live since the
  run above), so it should pass from now on.

## 3. Run them here

    npm run build && npx vite preview --port <your port> --strictPort &
    CHROMIUM_PATH=/opt/pw-browsers/chromium nice -n 10 node scripts/<suite>.mjs http://127.0.0.1:<port>/ <outdir>

A build, not the dev server (an edit reloads the page under a running suite).

**The machine-wide cap: at most 3 browser suites at once**, counted with

    pgrep -fa '^node (scripts|trailer)/[a-z0-9-]+\.mjs' | grep -vc 'scripts/remote-test\.mjs'

Start one only when that count is under 3 and `free -g` shows at least 3 GB available, and run it
with `nice -n 10`. `scripts/remote-test.mjs` starts no browser and is left out of the count
(`scripts/affected.mjs` is done in under a second); a new long-running driver like it must be added
to that `grep -v` and named here.
