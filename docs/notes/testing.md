# Testing: which browser suites to run, and where

The checks are the same everywhere; what this note decides is how many of the browser suites a
change needs and on which machine they run. Nothing here removes or loosens a check: the full set
(every suite in `FULL` of `scripts/affected.mjs`, the list in HANDOFF.md "Checks before every
deploy") stays the gate before a large push.

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
  helpers *and by the live site's deploys* (deploy-pages.yml): a full set is 18 jobs. Start a
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

**The same browser as here.** The runner uses this container's browser build, Chrome for Testing
153.0.8010.12 (`CHROME_VERSION` in the workflow; `/opt/pw-browsers/chromium --version` here),
driven by the pinned `@playwright/test`, with the same SwiftShader flags, on Ubuntu 24.04
(Playwright 1.56 cannot install its system libraries on 26.04, today's `ubuntu-latest`). With
Playwright's own Chromium 141 the touch and scrolling checks of walk (t2, t3) and flight ("More:
How to move first") failed there and passed here. If the container's browser changes, change
`CHROME_VERSION` with it. (`CHROMIUM_PATH` unset, the scripts fall back to Playwright's own
Chromium: that works too, it is just not this browser.)

**No pixel baselines.** No suite compares with pictures stored from an earlier run: every
measurement is made within the run (a frame against the frame before, a picture against the same
scene drawn another way). So nothing has to be kept per machine; and a picture taken there is not
to be diffed against one taken here.

**Not the same machine.** A runner's 4 cores are its own, but frames are not uniformly faster
there: verify's scenes draw 3-4x faster, walk and flight ran 2.4x slower than here under load.
Checks that wait for wall-clock time or race the frame rate (interact's time acceleration and
autopilot arrivals, game's landing) have failed there once and passed the next run; read a failure
there the way you would a failure under load here, and run it again before believing it.

## 3. Run them here

    npm run build && npx vite preview --port <your port> --strictPort &
    CHROMIUM_PATH=/opt/pw-browsers/chromium nice -n 10 node scripts/<suite>.mjs http://127.0.0.1:<port>/ <outdir>

A build, not the dev server (an edit reloads the page under a running suite).

**The machine-wide cap: at most 3 browser suites at once**, counted with

    pgrep -fa '^node (scripts|trailer)/[a-z0-9-]+\.mjs' | grep -vc 'scripts/remote-test\.mjs'

Start one only when that count is under 3 and `free -g` shows at least 3 GB available. Drivers that
start no browser (`scripts/remote-test.mjs`, `scripts/affected.mjs`) are left out of the count;
a new driver like them must be added to that `grep -v` and named here.
