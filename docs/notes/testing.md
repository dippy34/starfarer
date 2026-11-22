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
space ran 1.5-3x slower, and runners differ from one job to the next (Intel and AMD parts). A check
that races the frame rate or the wall clock can therefore fail on one side only. Seen so far
(full set at ce1fa02, run 45075450821, against this container):

| check | here | runner | why |
|---|---|---|---|
| ship: the three "sideways" checks | fail | fail | the same failure (not a runner matter) |
| live: desk, Stop ends the watch | crash (under load) | pass | likely the 15 s watch ending by itself before Stop is pressed: the Stop button was not visible |
| flight: arrives at the star (Rigil Kentaurus) | pass | fail | the flight takes longer than the loop's 900 s of wall time there |
| touch: pinching the other way lifts off | pass | fail | not yet explained (the pinch did not lift off: 1.6 m both times) |
| flight: More, How to move (scrolls to the help) | pass | fail, now fixed | a fixed 800 ms for a smooth scroll that, at a frame a second, had not begun; it now waits for the scroll |

Read a runner-only failure the way you would a failure under load here: run that suite again
(there or here) before believing it, and never loosen a check to make either side green.

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
