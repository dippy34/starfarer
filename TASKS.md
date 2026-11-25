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

Claude starts it by saving a start note, `.github/opencode/start/<task>.txt`, on the live branch
(`.github/opencode/README.md` says how). The owner can also start one on GitHub: **Actions**, then
**OpenCode task**, then **Run workflow**, and type the task name, e.g. `everest-summit`.
`smoke-test` only checks that the sign-in works.
The run works on a read-only copy and pushes nothing. It has a browser, the same as the test runs',
so the AI can run the browser suites and look at its own work. Its changes come back as files
attached to the run (`result.patch`, `REPORT.md`, `check.log`, and its pictures in `pictures/`).
Claude reviews it as above. For a second try, Claude starts it again with its notes.
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

- **Status:** open. Medium. (Search changed on 25 Nov, task/search-names; "Sirius" ranks as before.
  The check still fails on the live app: run 45666623495, `arrived:false`, the selection Mount
  Everest.)
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

### `task/everywhere-sweep`: a permanent "works everywhere" browser test

- **Status:** done, live on 25 Nov 2026 ("Add the works-everywhere browser suite"); its known failures
  are listed in `docs/notes/testing.md`. Read `docs/notes/works-everywhere.md` first.
- **Model:** `opencode-go/kimi-k3.1-pro`
- **What to do:**
  - Add `scripts/everywhere.mjs`, built on `scripts/lib/browser.mjs` and `scripts/lib/touch.mjs`
    like `scripts/live.mjs`, on a 390x844 touch page.
  - It visits a fixed table of places: Earth, Moon, Sun, Jupiter, Ceres, Halley, Sirius,
    Betelgeuse, Alpha Centauri (typed as "Alpha Centauri"), Proxima Cen b, TRAPPIST-1 e and its
    star, 51 Peg b, a generated planet, deep space, Sagittarius A*, Cygnus X-1, inside the Orion
    Nebula, beside Andromeda, and the Milky Way.
  - At each place it checks:
    1. it is found by the name a person types;
    2. the card opens with a title;
    3. Go there arrives (waits counted in frames, with long bounds, as `docs/notes/testing.md`
       says);
    4. tapping the object on screen selects it;
    5. the powers offered equal a per-kind expectation table, recorded from today's app;
    6. Move and Mass work where offered, and Undo restores;
    7. the share link reopens the same selection and camera distance within 1%;
    8. there are no console errors.
  - Register it in `FULL`, `RULES` and `PARTS` in `scripts/affected.mjs`, as about four parts.
  - Some checks fail today: "Alpha Centauri" search, Milky Way and Andromeda picking, and
    exoplanet share links. Keep them, and list them in your report as the known failures, so they
    pass once the fixes land. Never weaken a check to make it pass.
- **Done when:** the suite runs, the known failures are the only failures, and `npm run check`
  passes.
- **Don't touch:** app code under `src/` (this task only adds the test).

### `task/search-names`: find things by the names people type

- **Status:** done, live on 25 Nov 2026 ("Search finds the names people type"): the outside AI's
  work, with the checker's fix of the constellation names (Velorum, and the seven two-word ones).
- **Model:** `opencode-go/glm-5.3-flash`
- **The problem:** search misses "Alpha Centauri", "Alpha Cen", "Tau Ceti", "Eta Carinae" and
  generated planets such as "Vega b". "Sol" finds Solaris instead of the Sun, and "ISS" finds
  Meissa instead of the International Space Station.
- **What to do:** in the search code (`src/universe/CatalogSearch.ts` and `Systems.search`; find
  them), add aliases that point to the real catalogue entries, such as Alpha Centauri to Rigil
  Kentaurus and Toliman, and Sun or Sol to the Sun first. Find Bayer-style names like "Tau Ceti"
  from the catalogue's own designations. Make generated planets findable as "<star> b", labelled
  generated. Never add a star or a name that isn't in the data.
- **Done when:** a unit test covers each of those names, and `npm run check` passes.
- **Don't touch:** `src/ui/Hud.ts`, `src/ui/styles.css` (the design work is changing them).

### `task/galaxy-picking`: tap a galaxy where you see it

- **Status:** done, live in 25 Nov 2026's "Pick galaxies over their whole drawn disc" (the outside AI's
  work, checked by Claude: the full browser set passed but for two known flaky checks).
- **Model:** `opencode-go/kimi-k3.1-pro`
- **The problem:** beside the Milky Way, tapping its centre selects nothing. Beside Andromeda,
  tapping its centre selects M32, a small galaxy in front of it.
- **What to do:** find how taps pick objects (search for the pick or raycast code used by tap
  selection). Make a galaxy pickable over its drawn disc. When a tap lands on both a big galaxy
  and a small one in front, choose the one the view is framed on, or the biggest on screen. Say
  in the report which rule you chose and why.
- **Done when:** a browser check taps the Milky Way's and Andromeda's centres and gets them, and
  fails on the code before the change. `npm run check` passes.
- **Don't touch:** `src/ui/Hud.ts`, `src/ui/styles.css`.

### `task/ship-instruments`: the ship's instruments on a phone, in the new design

- **Status:** done, live on 25 Nov 2026 ("Ship instruments on a phone: one slim strip in plain words"):
  the outside AI's work in two tries, with the checker's fixes to two labels. Left for a later pass:
  the drive's hint reads "Torch · 100 %" (fuel), and the top-left chip still says m/s.
- **Model:** `opencode-go/kimi-k3.1-pro`
- **The problem:** flying on an upright phone, the ship's instruments take most of the top half of
  the screen, and they speak in m/s, "km up" and g. The owner: "the UI is taking up most of the
  screen", "way too nerdy: you should be able to understand what it is if you took 1 year of high
  school". The instruments are in `src/game/FlightHud.ts`, with their CSS in the same file: the
  glance panel (`.fl-glance`, filled by `renderGlance`), the drive chip with its − and +
  (`.fl-touch`), the lever with Stop and the view button (`.fl-stick`), and the assist and
  side-thruster chips (`.fl-aids`, `renderAids`).
- **What to do:** read `HANDOFF.md` "Design" first and follow it: its tokens (`--sf-*` in
  `src/ui/styles.css`: use them, don't change them), plain words first with the science one tap
  away, and the list of what it rules out. Look at the two screens already done that way: the
  crash screen (`setEnd` in `FlightHud.ts`, `endReport` in `src/game/Flight.ts`) and the object card.
  - Folded, the instruments are one slim strip at the top: the speed in km/h (km/s when fast, and
    a share of light's speed near it), the height above the ground in km, and one more line only
    when it matters, such as "Hits the ground in 4 min" in the caution colour on a course into the
    ground.
  - One tap opens everything else, as it does today (the full read-out), with its numbers as they
    are now.
  - The drive, the lever, Stop, the view, assist and the side thrusters all stay, with plain names,
    in less room. Don't remove a control: make it smaller, or move it into the opened part.
  - While the end-of-flight panel shows (a crash and the like, `setEnd`), the instruments step aside
    too, as the lever and the chips already do: today the phone's strip still says "Impact in 4 min"
    and offers the drive's − and + under "You hit the Moon", and at a desk the read-out at the right
    still says "impact in 27 s" (the flight suite's picture `f4-crash.png`).
  - Every number comes from the read-out the ship already gives (`FlightReadout` in
    `src/game/Flight.ts`); only the units and the words change. Keep each number with its unit (a
    no-break space, as `endReport` does).
- **Done when:**
  - A new check in `scripts/flight.mjs` (its phone part) shows that the folded instruments are at
    most 80 px tall on an upright phone, clear of the chips, the card and the tab bar, and show
    km/h, not m/s. It fails on the code before the change.
  - The phone part of `flight`, and the `ship` and `touch` suites, pass. A check written for the
    old layout may be rewritten for the new one, never made weaker; the report lists each one and
    why.
  - Pictures before and after, at 390x844 upright and 844x390 on its side, flying near the Moon,
    are in the run's pictures.
  - `npm run check` passes.
- **Don't touch:** `src/ui/Hud.ts`, `src/ui/styles.css`, `src/app/App.ts`, and the physics
  (`src/sim/`).

### `task/look-button`: the round "Drag: orbit" button sometimes misses a tap

- **Status:** on hold. Two tries (25 Nov) could not reproduce the miss: 14 runs of the check alone
  passed. The check now prints what it saw (`mode`, `moved`, `turned`) when it fails; take this up
  again with that evidence.
- **Model:** `opencode-go/kimi-k3.1-pro`
- **The problem:** in `scripts/touch.mjs` (its section 2), the check `set to "Look", one finger looks
  around instead` failed in 2 of 4 runs since the card was redone (95946c0), and in none before. It
  reports `{"mode":"orbit",...}`: the tap on the round button (`.look-fab`) did not switch the drag to
  Look. Perhaps the button moves while the folded card's line changes height (it wraps "… km / away"
  as the distance changes), or something covers it for a moment after "Go there" arrives.
- **What to do:** reproduce it (`SLOW_FRAME_MS`, `docs/notes/testing.md`) and find why the tap misses.
  If a person's tap could miss too, fix the app (for instance, keep the button still while the card's
  line changes); if only the check's timing is wrong, fix the check. Never loosen it.
- **Done when:** the report explains the cause with evidence; this check, run by a small loop of your
  own (not committed), passes 10 times in a row on your runner, and fails the old way before the fix
  if the cause was in the app; the touch suite passes; `npm run check` passes.
- **Don't touch:** `src/game/` and `scripts/flight.mjs` (task/ship-instruments works there).

### `task/powers-everywhere`: the same powers on every kind of object, with a reason where one can't work yet

- **Status:** done, live on 25 Nov 2026 (the outside AI's work, with the checker's update of whatif's
  two "not offered" checks). Read `docs/notes/works-everywhere.md` (plan step 2) and `HANDOFF.md`
  "Design" first.
- **Model:** `opencode-go/kimi-k3.1-pro`
- **The problem:** the powers (Mass, Size, Move, Add, Remove) are offered only when the selection is
  a Solar System body: the gate is `if (sel instanceof Body && sel.valid)` in `src/app/App.ts`, Add
  is `canAdd(Body)`, and the card hides its whole powers row (`powers.hidden = !sel.mass &&
  !sel.removable` in `src/ui/Hud.ts`). On a star, a planet of another star, a black hole or a galaxy
  the card shows no powers at all, so a person can't tell that god mode exists there, or why it
  doesn't work. The owner: "I want God mode to work everywhere."
- **What to do:**
  - Add `src/app/powersFor.ts`: one table, `powersFor(obj)`, that gives for every power either
    "works" or one short sentence in plain words saying why not, for every kind of object: a Solar
    System body (as today), the Sun (as today), a planet of another star (real or generated),
    another star, a black hole, a comet or belt asteroid, a galaxy or nebula, a spacecraft, a place.
  - Every sentence must be true today and at most 60 characters, for example "Live physics runs in
    our Solar System only, so far" or "No measured mass for galaxies in our data". No promises of
    dates, and no invented numbers.
  - The opened card always shows the powers row. A power that can't work is shown dimmed (still a
    44 px target), and a tap on it shows its sentence. One that works does exactly what it does
    today. Don't change what any power does.
  - App.ts's gate and Hud.ts's row read the table, so nothing else decides it.
- **Done when:**
  - A unit test covers `powersFor` for every kind above.
  - `scripts/everywhere.mjs` checks the new table: at each place, which powers work and which show
    a reason. Its old "powers offered" check is rewritten for that, never made weaker; the report
    says how.
  - The `live`, `touch` and `everywhere` suites pass (but for `everywhere`'s known failures in
    `docs/notes/testing.md`), and `npm run check` passes.
  - Pictures of the opened card, before and after, on a phone (390x844): the Moon, Sirius, TRAPPIST-1
    e, Cygnus X-1 and the Andromeda Galaxy.
- **Don't touch:** `src/game/` and `scripts/flight.mjs` (task/ship-instruments), and
  `src/universe/CatalogSearch.ts`, `src/app/Systems.ts` and App.ts's search code (task/search-names).

### `task/tab-bar`: the bottom bar and the round buttons, in the new design

- **Status:** open. Medium. Design, Part 3 (`HANDOFF.md` "Design", "Next screens", item 2).
- **Model:** `opencode-go/kimi-k3.1-pro`
- **The problem:** at the foot of a phone the interface stacks a tab bar (Search, Explore, Time,
  More: `.hud-tabs`, 60 px with rounded "pill" styling the design rules out) and, above it, round
  buttons whose words don't say what they do: "Drag: orbit" / "Drag: look" (`.look-fab`, what one
  finger's drag does) and "Your ship" / "Fly there in your ship" (`.ship-fab`), sometimes "Land and
  walk" (`.walk-fab`). With the card's bar, the foot of the screen is about 200 px of interface. The
  owner: "the UI is taking up most of the screen", "not very user intuitive", "the navigation
  sucks". They are in `src/ui/Hud.ts` (the markup near line 240, the words near line 820) and
  `src/ui/styles.css` (`.hud-tabs`, `.fab`).
- **What to do:** read `HANDOFF.md` "Design" first and follow it (its `--sf-*` tokens, flat and
  opaque, squared keys, plain words, what it rules out). Look at the screens already done that way:
  the object card and the ship's instruments.
  - The tab bar: one slim, flat row in the design, icons with short labels, at most 52 px tall above
    the phone's safe area. On its side and at a desk, the same parts in the same order.
  - The round buttons: smaller and flat, with plain words that say what a tap does. For example, the
    drag button could say "Turning around it" / "Looking around", and the ship button "Fly my ship
    there" / "My ship". Choose the words; keep every function.
  - Don't remove a control or a function; every target stays at least 44 px.
- **Done when:**
  - A new check in `scripts/touch.mjs` shows the tab bar at most 52 px tall upright, and the round
    buttons' words free of "Drag:". It fails on the code before the change.
  - The `touch`, `live`, `share`, `start`, `interact` and `flight` (phone part) suites pass, but for
    the known flaky checks in `docs/notes/testing.md`. A check written for the old layout may be
    rewritten for the new one, never made weaker; list each in the report.
  - Pictures before and after, at 390x844 upright and 844x390 on its side, with Earth selected.
  - `npm run check` passes.
- **Don't touch:** `src/game/` (the ship's instruments), `src/app/powersFor.ts` and the card's powers
  row (task/powers-everywhere, in review).

### `task/offline`: a copy of everything on the phone, for use with no internet

- **Status:** open. Medium.
- **Model:** `opencode-go/kimi-k3.1-pro`
- **The problem:** the owner: "would it be possible to create an offline version that has everything
  downloaded". The app loads nothing from other sites: everything is on its own site, the app and
  `public/data` (about 920 MB in about 13,000 files). It can already be added to the Home Screen
  (`public/manifest.webmanifest`, the apple-mobile-web-app tags in `index.html`), but it needs the
  internet for every file.
- **What to do:**
  - **The list of files.** The build writes a list of every file of the built site, with its size
    and a hash of its content (a small Vite plugin in `vite.config.ts`, or a step after the build).
  - **The service worker** (`public/sw.js`, registered with scope `./`, since the site lives under
    `/starfarer/`). It serves the app and its data from a cache when they are there, and the network
    otherwise.
    - Register it **only when the person asks for the offline copy**, and unregister it and empty
      its cache on "Remove the offline copy". Someone who never asks gets exactly today's site.
    - It must never serve an old app with new data, or the other way round. On a new version, it
      fetches only the files whose hash changed, then switches over together.
  - **In More (settings), a small "Use offline" part:**
    - "Download everything for offline use (about N MB)", where N comes from the list, with a
      progress bar, a line saying to use Wi-Fi, and the space it will take
      (`navigator.storage.estimate()`).
    - Ask for persistent storage (`navigator.storage.persist()`) and say plainly if the phone
      refuses.
    - When done: "Starfarer works offline". Also "Remove the offline copy".
    - Words in the plain style of `HANDOFF.md` "Design".
    - The browser APIs go in `src/platform/` (for example `src/platform/offline.ts`). The panel's
      own code goes in a file of its own; in `src/ui/Hud.ts`, only mount it in the More sheet
      (task/tab-bar is changing Hud.ts's tab bar and round buttons at the same time).
- **Done when:**
  - Unit tests cover the file list and the "what changed between two lists" logic.
  - A browser check, a new `scripts/offline.mjs` registered in `scripts/affected.mjs`:
    - it downloads a small part (a test-only option limiting the list to what showing the Earth and
      flying to the Moon need), sets the page offline (Playwright's `context.setOffline(true)`) and
      reloads;
    - the app starts, the Earth is drawn with its map, a flight to the Moon arrives, and no request
      fails;
    - and "Remove the offline copy" leaves no service worker and no cache.
  - The `start`, `touch` and `share` suites pass. `npm run check` passes.
- **Don't touch:** `src/game/`, the tab bar and round buttons (task/tab-bar), `src/app/powersFor.ts`.

## Adding a task

Copy a section: a branch name starting `task/`, a status, the problem, what to do, when it is
done, and what not to touch. Keep each task to one feature or one fix, so branches don't collide.
Two tasks must never list the same files.
