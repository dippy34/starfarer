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

It pushes HEAD (committed work only; with `--suites` a commit on top with a `Suites:` trailer, your
branch does not move) to a throwaway branch `claude/test-<you>-<sha>-<stamp>`, which runs
`.github/workflows/browser-tests.yml` (build once, then one job per suite), waits, downloads each
suite's log and pictures to `out/remote-<sha>/<suite>/` (or `--out <dir>`), prints pass/fail per
suite with the failing checks, and exits 0 only if every suite passed. It takes about as long as
the slowest chosen suite plus ~3 minutes (build, browser install). Run it in the background.

- The workflow runs only on `claude/test-**` branches. It cannot deploy (deploy-pages.yml runs on
  `main` and `claude/friendly-hypatia-up418z` only) and has read-only permissions and no secrets.
- A `Suites: all` or `Suites: flight walk` trailer line in the pushed commit's message overrides the
  map; `--suites` writes it for you.
- The branch is left behind: the git proxy in this container refuses branch deletion (HTTP 403).
  `--delete` tries anyway where that is allowed. The artifacts expire after 3 days.
- **Share the runners.** The account runs about 20 jobs at once across all helpers; a full set is
  15 of them. Use the affected suites for everyday changes, and `Suites: all` once per batch, so
  two helpers' full sets do not queue behind each other.
- `remote-test.mjs` is not a browser suite and does not count towards the local cap (below). It
  also renames its process to `remote-test`.

**Differences from this container.** The runner uses the Chromium that the pinned
`@playwright/test` installs (Chromium 141 headless shell, `CHROMIUM_PATH` unset; the container has
Chrome for Testing 153), with the same SwiftShader flags, on Ubuntu 24.04 (Playwright 1.56 cannot
install its browser on 26.04, today's `ubuntu-latest`). No suite compares against pictures stored
from an earlier run: every measurement is made within the run, so there are no pixel baselines to
keep per environment. Checks that measure wall-clock time (live physics speed, timed flights) are
run on a quieter machine there, which is the fairer of the two.

## 3. Run them here

    npm run build && npx vite preview --port <your port> --strictPort &
    CHROMIUM_PATH=/opt/pw-browsers/chromium nice -n 10 node scripts/<suite>.mjs http://127.0.0.1:<port>/ <outdir>

A build, not the dev server (an edit reloads the page under a running suite).

**The machine-wide cap: at most 3 browser suites at once**, counted with

    pgrep -fa '^node (scripts|trailer)/[a-z0-9-]+\.mjs' | grep -vc 'scripts/remote-test\.mjs'

Start one only when that count is under 3 and `free -g` shows at least 3 GB available. Drivers that
start no browser (`scripts/remote-test.mjs`, `scripts/affected.mjs`) are left out of the count;
a new driver like them must be added to that `grep -v` and named here.
