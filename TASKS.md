# Starfarer task board

This board is for any AI coding assistant working on Starfarer, whether Claude or another tool.
You will be given **one branch name**. Find the section below with that name and do that task
only, on that branch. When it is done, the owner hands the branch to Claude, who reviews it,
tests it, and puts it live if it is good.

The app is live at https://dippy34.github.io/starfarer/. It is a real-scale 3D space app (Vite,
TypeScript strict, three.js). Its promise is **real data and real physics**.

## Rules for every task (read all of them before you start)

1. **Start from the live branch.** Run `git fetch origin claude/friendly-hypatia-up418z`, then
   `git checkout -b <your branch> origin/claude/friendly-hypatia-up418z`. If your branch already
   exists, check it out and merge the latest live branch into it.
2. **Push only to your own branch.** Never push to `claude/friendly-hypatia-up418z`, because every
   push there goes live to visitors. Never push to `main`, and never force-push.
3. **Do only your task.** Don't edit this file, `HANDOFF.md`, or files another task lists. If you
   believe you must, write that in your report instead of doing it.
4. **Real data only.** Never invent, guess or "fill in" star, planet or other catalogue numbers.
   If something is unknown, leave it out and say so. Every data source is listed in `CREDITS.md`.
5. **Browser-only APIs** (`window`, `document`, `localStorage`, `navigator`, ...) belong only in
   `src/platform/`.
6. **Tests are never loosened.** Never skip, weaken or delete a check to make it pass. Add a check
   that fails before your change and passes after it.
7. **Before every push**, run `npm ci` (the first time only), then `npm run check`, which is the
   type check, the unit tests and the build. It must pass.
8. **Read first:** `HANDOFF.md` (how everything works; search it for your area) and
   `docs/notes/testing.md` (the browser test suites in `scripts/*.mjs`, and `SLOW_FRAME_MS`, which
   makes your machine behave like GitHub's slow test machines).
9. **No new dependencies and no downloads** unless your task says so.
10. **Report in your last commit message:** what you changed, how you checked it, and what is
    left. Before handing over, merge the latest live branch into yours and run `npm run check`
    again.

## How a task is finished

The owner tells Claude the branch name. Claude reads the whole change, runs `npm run check` and
the browser suites on GitHub's runners, looks at the pictures and checks the numbers, then merges
it into the live branch. If something is wrong, it comes back with notes. Only one batch of
branches is reviewed at a time.

## Running a task on GitHub's computers (OpenCode)

The owner starts it on GitHub: **Actions**, then **OpenCode task**, then **Run workflow**, and types
the task name, e.g. `everest-summit`. Use `smoke-test` once first, to check that the sign-in works.
The run works on a read-only copy and pushes nothing. Its changes come back as a file attached to
the run (`result.patch`, `REPORT.md`, `check.log`). Give Claude the run's link, and Claude reviews
it as above. For a second try, run it again with Claude's notes in the **notes** box.
(`.github/workflows/opencode-task.yml`)

## Which model does what

From the model research of 25 Nov 2026 (mostly the makers' own benchmark figures; adjusted as real
results come in). Each task below names its model, and the workflow uses it unless told otherwise.

| Job | Model |
|---|---|
| Senior: plans, does the hard parts, reviews | `opencode-go/kimi-k3.1-pro` |
| Junior: small, well-specified pieces | `opencode-go/glm-5.3-flash` |
| UI screens following the design | `opencode-go/kimi-k3.1-pro` |
| Small TypeScript bug fixes | `opencode-go/glm-5.3-flash` or `opencode-go/deepseek-v4.1-flash` |
| Flaky browser tests | `opencode-go/kimi-k3.1-pro`, or `opencode-go/mimo-v2.6-pro` |
| Plain, friendly wording | `opencode-go/claude-haiku-5-5` |
| Fast boilerplate | `opencode-go/gpt-6-luna` |

Then a Sonnet checker tests the result and takes pictures, and Claude makes the final call. Not
used: the `muse-spark-*-contributor` models, which train on the requests sent to them. DeepSeek models
need the OpenCode workspace's region set to Global.

## Tasks

### `task/everest-summit`: the Everest walking spot sits below the summit

- **Status:** on hold. The owner wants general space and reliability first, not Earth-only polish.
- **Model:** `opencode-go/kimi-k3.1-pro`
- **The problem:** walking at "Mount Everest" puts the walker a little below the highest point of
  the elevation data the app ships. The landmark is in `src/universe/Landmarks.ts` (lat 27.988,
  lon 86.925, `h: 8.8e3`), and the walking place is offered from `src/app/App.ts` and
  `src/app/destinations.ts`.
- **What to do:** find how the walker's start point is chosen. Put it on the highest
  elevation-data sample near the landmark, worked out from the data the app loads (the terrain
  code: search `HANDOFF.md` for "terrain" and "elevation"), not from a typed-in height. Keep the
  result true to the data: the real summit is 8,849 m, but use what the data says.
- **Done when:** a browser check (in `scripts/terrain.mjs` or `scripts/walk*.mjs`) shows the
  walker starts within a few metres of the highest sample within 200 m of the landmark, and fails
  on the code before the change. `npm run check` passes.
- **Don't touch:** the ship and flight code (`src/app/Flight.ts`, `src/sim/ShipPhysics.ts`).

### `task/sirius-test`: "search and go to Sirius" fails on GitHub's runners

- **Status:** open. Medium.
- **Model:** `opencode-go/kimi-k3.1-pro`
- **The problem:** in `scripts/interact.mjs`, the check "search + goto Sirius" fails on GitHub's
  slow runners and passes on fast machines. Its failure says
  `{"arrived":false,"autopilot":false,"near":[],"sel":"Mount Everest"}`. So the search never
  selected Sirius, the selection stayed on the previous step's Mount Everest, and the flight never
  started.
- **What to do:** reproduce it locally with `SLOW_FRAME_MS=1000` (see `docs/notes/testing.md`),
  find the cause, and fix it. The cause might be the previous step's state not being left, or the
  search input's timing. Fix the test if it is the test's fault, or the app if a slow phone would
  hit it too. Never loosen the check.
- **Done when:** the check passes at `SLOW_FRAME_MS=1000`, the report explains the cause, and
  `npm run check` passes.
- **Don't touch:** the other suites' checks.

## Adding a task

Copy a section: a branch name starting `task/`, a status, the problem, what to do, when it is
done, and what not to touch. Keep each task to one feature or one fix, so branches don't collide.
Two tasks must never list the same files.
