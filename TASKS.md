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
| On the owner's Claude API credits (from 27 Nov 2026): senior | `anthropic/claude-sonnet-5-5` |
| On the owner's Claude API credits: small jobs, and the junior | `anthropic/claude-haiku-5-5` |

Then a Sonnet checker tests the result and takes pictures, and Claude makes the final call. Not
used: the `muse-spark-*-contributor` models, which train on the requests sent to them. DeepSeek models
need the OpenCode workspace's region set to Global.

## Tasks

### `task/time-panel`: the Time panel, simpler: one way back to now, and its speed in words

- **Status:** done 27 Nov 2026: run 45979620921 on Claude Sonnet 5.5 ($1.34), reviewed by Claude, who ran the
  whole touch suite it could not finish. Small.
- **Model:** `anthropic/claude-sonnet-5-5`
- **The problem:** the fix list's #4 ("make it simple"): the Time panel (`src/ui/Hud.ts`, the
  `.sheet.time` section near line 345) has a big "Back to today" button and, in its row of five, a
  "Now" button that do exactly the same (`App.act`: `case 'now': case 'today': this.realTime()`), and
  it gives the speed as "◀ 1 min/s".
- **What to do:** read `HANDOFF.md` "Design" first.
  - The row keeps four: Reverse, Slower, Pause/Play and Faster ("Now" goes from it).
  - The big button, "Back to now", shows whenever the clock is not at the present moment at real time
    (a day or more away, or any other rate, or reversed, or paused away from now); in live physics as
    today (hidden). It does what Now does.
  - Under the clock, the speed in words: "Real time", "1 minute a second", "3 hours a second",
    "2 days a second", "1 year a second", and ", backwards" when reversed (`App.rateText` is the short
    form the top chip keeps: leave the chip as it is).
  - Plain words, the `--sf-*` tokens, every target at least 44 px.
- **Done when:**
  - Unit tests for the speed in words (each unit, backwards, real time).
  - Browser checks (in `scripts/touch.mjs`, where the Time sheet is checked): the row has four buttons
    and no Now; "Back to now" shows after Faster and after Reverse, and brings real time back; the speed
    reads in words. They fail on the code before the change. Checks that pressed Now press "Back to
    now" instead; none is made weaker; list each changed check in the report.
  - Pictures, upright at 390x844 and sideways at 844x390, of the Time sheet at real time and at
    "2 days a second, backwards".
  - Run `scripts/touch.mjs` and `LIVE_ONLY=watch` of `scripts/live.mjs` (the Time sheet's buttons in
    live physics); Claude runs the rest. `npm run check` passes.
- **Don't touch:** the clock and its rates (`src/core/time.ts`), the top chip, the watch.

### `task/make-any-number`: make anything, with any numbers

- **Status:** open. Large.
- **Model:** `anthropic/claude-sonnet-5-5`
- **The problem:** the owner, 28 Nov 2026, after playing: "What's the point of making a planet like Earth or like
  Jupiter? It would be so much easier if you just added make a planet and you could put however many Earths it
  is" and "you're adding a slider between how big it can be"; "I still feel confined". Today Add round a star
  (`canAdd` in `src/app/WhatIf.ts`; the Add panel in `src/ui/Hud.ts`, reached from a card or from Create) lists
  copies of the Earth, Jupiter and the Sun, seven worlds of a generated look and a black hole, each with a mass
  slider held to a narrow range (`MADE_MASS`).
- **What to do:** (the owner approved this; read `HANDOFF.md` "Make anything", "A black hole of your own", "The
  big round" first)
  1. *Four choices.* Add round a star offers just: "A planet", "A star", "A black hole" (and round a planet or a
     dwarf planet: "A moon"), each a thumb high with a plain line. The rows "A planet like Earth", "A planet like
     Jupiter" and the seven worlds as rows of their own go.
  2. *Any number.* While it is put in place, its mass is a number to type, beside the slider: in Earths for a
     planet or a moon, in Suns for a star or a black hole; any from a millionth of an Earth (a planet, a moon)
     to 10,000 Earths, from 0.08 to 150 Suns for a star, from 1 Sun to 10 billion for a black hole. The slider
     runs over the whole range on a log scale, for quick changes; the number field takes exact ones (16 px
     text so an iPhone does not zoom; taken on Enter or when left; a plain line under it says why a number
     cannot be taken). Its words say what it is at that mass, by the rules there are (`madeSize`, Chen &
     Kipping 2017): a planet past 13 Jupiters' mass is a brown dwarf, and past about 0.08 Suns a star: it
     becomes one by itself, shines as a star of the main sequence (`mainSequence`), and says so.
  3. *Its kind is a look, not a preset.* A planet or a moon has a "Type" choice (rocky, ocean, desert, lava,
     icy, gas giant, ice giant: the generated looks of `PlanetLook.ts`), with New look, rings, Colour, Name and
     the card's picture as today; the type first chosen follows its mass (rocky up to about 2 Earths, an ice
     giant to about 50, a gas giant beyond) until the explorer picks one.
  4. *Size.* It follows the mass by the published rules, as now; "Set size" lets the explorer type its radius
     instead (in Earth radii; any from a thousandth to 30), and "Size from mass" puts the rule back.
  5. *Kept.* Saves and links keep all of it; links and saves written before (the kinds `earth`, `jupiter`,
     `sun` and the seven worlds) read and are made as ever.
- **Done when:**
  - Unit tests: the ranges and the log slider; a typed number (parsed, out of range refused with its line); a
    planet past 13 Jupiters a brown dwarf and past 0.08 Suns a star, with their words and size; the type
    following mass until picked; a size set by hand; the bytes of a save of each, and old records unchanged.
  - Browser checks in `scripts/live.mjs` (the `made`, `create`, `place` and `hole` blocks, phone and desk):
    the four choices; 1,000 Earths typed: its words and size; 30,000 Earths: it is a star and shines; a size
    set by hand; a save brings it back. Checks that pinned the old rows pin the new ones exactly (changed on
    purpose; none loosened). They fail on the code before the change.
  - Pictures, upright at 390x844: the Add panel, the placing panel with the number field, a planet turned star.
  - Run `LIVE_ONLY=made,create,place,hole` of `scripts/live.mjs` (phone and desk), `scripts/whatif.mjs` and
    `scripts/share.mjs`; Claude runs the whole set after. `npm run check` passes.
- **Don't touch:** the camera rig and the top chips, the round buttons, the card's layout outside its Add and
  placing panels, and `src/render` (Claude is reworking those at the same time); the comets' powers.

### `task/hole-of-your-own`: a black hole of your own

- **Status:** done 28 Nov 2026: run 46098223277 on Claude Sonnet 5.5 ($3.68), reviewed by Claude. Large.
- **Model:** `anthropic/claude-sonnet-5-5`
- **The problem:** the fix list's #9, step 2 (`docs/notes/ideas.md`, "God mode on more things"): "a black hole of
  your own (Add round the Sun, 1 to 20 Suns)". Today Add round a star (`canAdd` in `src/app/WhatIf.ts`; the Add
  panel and Create in `src/ui/Hud.ts`) makes copies of the Earth, Jupiter and the Sun and seven worlds of a
  generated look; live physics "does not take black holes yet" (`powersFor.ts`, `HOLE`).
- **How things work now:** a made world: `App.add` (a plan from `WhatIf.ts`, `LivePhysics.make`, placing with the
  mass slider until Done, `Mover.place`); saves and links: `MadeRecord` in `src/app/SceneWorld.ts`. Black holes:
  `BlackHole` (`src/universe/BlackHoles.ts`, the catalogue's, from RA, Dec and distance) drawn by
  `BlackHoleLayer` (`src/render/BlackHoleLayer.ts`), which lenses whatever holes are in `app.blackHoles` (the
  catalogue adds to that array while the app runs: `addBlackHole` in `App.ts`).
- **What to do,** in this order, each step whole before the next (if time runs short, stop after a whole one
  and say what is left):
  1. *Made and pulling.* Add round a star offers "A black hole" (and so does Create), a row like the others,
     its line "Heavier than the Sun, and no light: 1 to 20 Suns". It is put in place as a made world is
     (between you and the star, on a circle, time waiting until Done) with its mass slider from 1 to 20 Suns
     (10 to begin with). In live physics it is a body of that mass that gives no light: it pulls everything.
     Its card: "Black hole, made by you", its mass in Suns, the size of its event horizon (the Schwarzschild
     radius, 2GM/c², in km); Mass, Move and Remove work, Size and Add are off with a plain reason each.
  2. *Seen.* It is drawn as the catalogue's holes are: its shadow and the sky bent round it, with no disk
     and no jets (a dormant hole), wherever the simulation has it, every frame. Whatever a person would see
     of it is the existing renderer's; do not write a new one. On a phone it must stay usable: if the
     renderer's capture of the sky round it is heavy each frame there, say what it costs.
  3. *What it swallows.* A world that comes within its Roche limit of the hole (where tides tear it apart:
     d = R (2 M_hole / M_world)^(1/3), the rigid-body form; for the Earth and 10 Suns about 1.2 million km)
     is torn apart and swallowed: it is gone, the hole gains its mass, and the log and a toast say so in
     plain words ("Earth was torn apart and swallowed by the black hole"). Say in what live physics leaves
     out that tearing apart is not drawn.
  4. *Kept.* A save and a link keep it (a `MadeRecord` of a new kind; links written before read as ever).
- **Done when:**
  - Unit tests: the plan (mass range, place, circle), the Schwarzschild radius and the Roche limit (against
    worked numbers), what it swallows in the simulation, the bytes of a save with a hole (and form 1 links
    unchanged).
  - Browser checks in `scripts/live.mjs`, a new block `hole` (phone and desk): Add (and Create) at the Sun offer
    a black hole; made at 10 Suns it is simulated and its card says so; it is drawn (the renderer's view of it
    is active); a planet thrown close is swallowed and said; Undo brings it back; a save brings the hole back.
    They fail on the code before the change.
  - Pictures, upright at 390x844: the Add panel with the black hole, the hole made near the Sun, a planet
    being swallowed.
  - Run `LIVE_ONLY=hole,made,create` of `scripts/live.mjs` (phone and desk) and `scripts/share.mjs`; Claude
    runs the whole set after. `npm run check` passes.
- **Don't touch:** the catalogue's black holes and their data, the camera rig, the made worlds' looks
  (`PlanetLook.ts`, `PlanetPortrait.ts`), the comets' powers, the chips and the Time panel. Never make up
  numbers: the hole's own are worked out from its mass.

### `task/plain-physics`: the live-physics lines in plain words

- **Status:** done 28 Nov 2026: run 46084539168 on Claude Sonnet 5.5 ($1.66), reviewed by Claude. Medium.
- **Model:** `anthropic/claude-sonnet-5-5`
- **The problem:** the fix list's #4, "make it simple", lists the live-physics screens as still to redo. Their
  lines speak an astronomer's shorthand: "Now round the Sun: a circle 1.21 AU out · 486 d." (the Move
  panel, `Mover.ts` with `orbitWords` and `farWords` in `src/app/Powers.ts`), "New rocky world is new:
  1.21 AU from the Sun, once round in 486 d." (the toast of Add, `App.add`), the card's "Its orbit" line
  (`LivePhysics.ts`, the details). The chips at the top already say how far and how fast in plain words
  (`plainDistance`, `plainSpeedWords` in `src/app/plainWords.ts`; `clockChipWords` in `Powers.ts`).
- **What to do:** every line of live physics the card, its panels, the toasts and the watch show says a
  distance as `plainDistance` does (km; millions or billions of km; light years far out: never AU) and a
  time as `spanWords` does ("486 days", "11.9 years", "6.6 hours": never "d", "h", "yr" or "s"), with
  "once round in ..." for a period. For example "Now round the Sun: a circle 181 million km out, once
  round in 486 days." and "a slightly stretched circle, 365,709 to 382,840 km, once round in 26.2 days".
  The rows under "More science" keep their units (AU and the rest are science there). Keep the words
  short enough for a phone 390 px wide; keep the precision as it is (three figures).
- **Done when:**
  - The unit tests that pin these words (`tests/powers.test.ts` and others) pin the new words, each as
    exactly as before (no check loosened, none deleted); a new test that no line of `orbitWords` and of
    the Add toast contains "AU" or a bare unit letter.
  - The browser checks in `scripts/live.mjs` and `scripts/whatif.mjs` that read these lines read the new
    words, their patterns as strict as before. Run `LIVE_ONLY=place,throw,made,moon,watch` of
    `scripts/live.mjs` (phone and desk) and `scripts/whatif.mjs`; Claude runs the whole set after.
    `npm run check` passes.
  - Pictures, upright at 390x844: the Move panel while a new world is put in place, and the card's
    details of a moved moon.
- **Don't touch:** the chips at the top and the Time panel (done), the made worlds' looks
  (`src/render/PlanetLook.ts`, `src/render/PlanetPortrait.ts`), the comets' powers (task/comet-powers),
  the science rows.

### `task/comet-powers`: God mode on comets: throw one, move it, take it away

- **Status:** done 28 Nov 2026: step 1 (take it away) in run 46077593093 ($1.76), steps 2 (move and throw) and 3
  (kept in saves and links) in run 46091450578 ($3.24), both on Claude Sonnet 5.5, reviewed by Claude. Large.
- **Model:** `anthropic/claude-sonnet-5-5`
- **The problem:** the fix list's #9 and its Tier 3 row ("God mode does not work on everything yet ... black
  holes, comets, belt asteroids ..."). A comet's card says "Comets and belt asteroids stay on their recorded
  paths" (`src/app/powersFor.ts`, `SMALL`). The owner wants God mode on more things, comets first
  (`docs/notes/ideas.md`, "God mode on more things").
- **How comets work now:** `src/render/SmallBodies.ts` (`SmallBodiesLayer`, `Comet`): a worker
  (`src/workers/comets.worker.ts`) moves every catalogued comet on its own orbit round the Sun (two bodies,
  `keplerState`), and `syncCometObjects` puts each `Comet.upos` there; the points are one `Points` geometry.
  `src/render/CometTails.ts` draws the coma, tails and nucleus of the active ones from `Comet.upos`. While live
  physics has changed the Sun, `SmallBodiesLayer.present = false` hides them all. Live physics:
  `src/app/LivePhysics.ts` (`make` adds a body to the simulation; `checkpoint`/`restore` for Undo and Replay;
  `world`/`adoptWorld` for saves and links, `src/app/SceneWorld.ts`); the simulation (`src/sim/NBody.ts`) takes
  bodies of no mass (gm 0: pulled, pulling nothing). Moving and throwing a world: `src/app/Mover.ts`.
- **What to do:** read `HANDOFF.md` "God mode, wave 1" (the powers, Undo, Replay, Back to reality) first.
  Do these in this order, and if time runs short stop after a whole one and say what is left:
  1. *Take it away.* A comet's card offers Remove (Mass, Size and Add stay off, each with a plain reason:
     no measured mass). Removing it starts live physics as removing a world does, hides its point and its
     tail, and Undo, Replay and Back to reality bring it back.
  2. *Move it and throw it.* Move works on a comet as on a moon: put it somewhere, or flick it to throw it.
     From then on the simulation carries it, with no mass, from where its own orbit had it at that moment
     (place and speed from its elements), and its point, its card's distance and its tail follow the
     simulation (its tail still points away from the Sun from where it is). A comet thrown at the Earth hits
     it as other worlds do (the impact card).
  3. *Kept.* A save of the scene and a link keep the comets changed (taken away, or carried by the
     simulation, with their place and motion); links written before read as ever.
  The other comets, the belt asteroids and everything else are as before. No catalogue data changes: a
  comet's own elements are never rewritten.
- **Done when:**
  - Unit tests for whatever new rules there are (the powers table for a comet; a comet's place and speed
    from its elements matching the worker's; and, for step 3, the bytes keep it).
  - Browser checks in `scripts/live.mjs` (a new block `comet`, phone and desk): Halley (or the brightest
    comet now, as `tour:comet` picks it) can be removed and comes back with Undo; it can be thrown, and its
    point and tail move with the simulation; for step 3, a save brings it back changed. They fail on the
    code before the change.
  - Pictures, upright at 390x844: the comet's card with its powers, and a thrown comet with its tail.
  - Run `LIVE_ONLY=comet,made,throw` of `scripts/live.mjs` (phone and desk) and `scripts/share.mjs`; Claude
    runs the whole set after. `npm run check` passes.
- **Don't touch:** the camera rig, the watch (`src/app/Watch.ts`), the Time panel, the tab bar, the made
  worlds' looks (`src/render/PlanetLook.ts`). Keep `NBody`'s existing behaviour for bodies with mass exactly
  as it is.

### `task/name-it`: name a world you made

- **Status:** done 27 Nov 2026: run 45990265243 on Claude Sonnet 5.5 ($1.67), reviewed by Claude. Medium.
- **Model:** `anthropic/claude-sonnet-5-5`
- **The problem:** God mode as a sandbox (`docs/notes/ideas.md`; the owner, 27 Nov 2026: "adding whatever
  you want and creating infinite amount of different possibilities"). A made world is named by Add
  ("New gas giant", "Earth 2", "Mars's new moon", "Sun 2") and the name cannot be changed. A world of your
  own should be able to carry a name of your own.
- **What to do:** read `HANDOFF.md` "Design" first (plain words, the `--sf-*` tokens, every target at
  least 44 px) and "Make anything, step 1" (the placing panel: mass slider, New look, Add rings, Colour).
  - While a made world is put in place (any made world: a moon, a copy, a sun, a world of a generated
    look; `App.mover.placing`), the card's placing panel (`src/ui/Hud.ts`, `.placing`) offers its name in a
    text field labelled "Name", at least 44 px high, filled with the name it has. The new name is taken
    when the field is left or Enter is pressed (not at every key), and the field is let go of.
  - A name is taken only if it is plain (`plainName` in `src/app/SceneWorld.ts`: letters, digits, spaces
    and a few marks, at most `WORLD_LIMITS.name` characters; spaces at either end are trimmed first) and is
    no other thing's name (`App.findByName` finds nothing else by it, in any letter case: no "Earth", no
    "Sirius", no second "New gas giant"). Otherwise the old name stays and a short plain line under the
    field says why ("That name is taken", "Letters, digits and spaces only, 40 at most").
  - Keys typed in the field reach no shortcut of the app (Space is not "pause", W is not "forward").
  - The new name is the world's everywhere: its label in the view, the card, search, its details, the
    log's next lines, and a save and a link (`MadeRecord.name` keeps it already; a link's reader checks it
    with `plainName`).
- **Done when:**
  - Unit tests for the rule that takes a name (plain, trimmed, at most 40, not another's name in any case).
  - Browser checks in `scripts/live.mjs` (the `made` block, phone and desk): the field is offered, a thumb
    high, with the name; "Big Blue" typed and Enter: the card's title, the label and search say Big Blue; a
    save of the scene, opened again, brings back Big Blue; "earth" is refused with its line, and the name
    stays; a Space typed in the field does not pause or start time. They fail on the code before the change.
  - Pictures, upright at 390x844: the field with a name typed, and the label after.
  - Run `LIVE_ONLY=made,place` of `scripts/live.mjs` (phone and desk) and `scripts/share.mjs`; Claude runs the
    whole set after. `npm run check` passes.
- **Don't touch:** `src/app/LivePhysics.ts` and `src/sim/` (the physics), the camera rig, the watch
  (`src/app/Watch.ts`), the tab bar, the Time panel (task/time-panel works there). No catalogue name ever
  changes: only made worlds are renamed.

### `task/make-anything`: God mode's sandbox, step 1: made worlds of every kind, each with a look of its own

- **Status:** done 27 Nov 2026: run 45966214578 on Claude Sonnet 5.5 ($4.27; it ran out of its 80
  minutes while its last checks ran, all three steps done), reviewed by Claude, who added the
  HANDOFF.md note it was not allowed to write; Claude added rings and a Colour slider the same night. Left for later: the
  card's small picture (see HANDOFF.md, "Make anything, step 1"). Large.
- **Model:** `anthropic/claude-sonnet-5-5`
- **The problem:** the owner, 27 Nov 2026: "God mode feels more like you're editing something or adding
  some preset things instead of actually unlocking your full potential ... creating infinite amount of
  different possibilities." Today Add (the card's Add panel, `src/ui/Hud.ts` near line 320; the making,
  `src/app/WhatIf.ts`; the placing, `App` and `src/app/Mover.ts`) makes four things only: a moon round a
  planet, and round a star a copy of the Earth, a copy of Jupiter or a second sun. A copy wears the
  original's map (`Body.texture`, `src/render/Bodies.ts` `textureKey`). Meanwhile the app already draws
  the made-up planets of other stars with generated looks of ten types, each varied by a seed
  (`src/render/ExoPlanetLayer.ts`: `TYPE_ID`, the palette set from the type and the seed near line 235,
  the `EXO_FRAG` material near line 265, rings near line 277). The plan for the sandbox is in
  `docs/notes/ideas.md` ("God mode as a sandbox"); this is its first step.
- **What to do:** read `HANDOFF.md` "Design" first (plain words, the `--sf-*` tokens, every target at
  least 44 px), and "Part 1: watch it happen" (a change is offered its watch).
  - In the card's Add panel, round a star, after the rows there are, add rows for made worlds with a
    generated look: "A rocky world" (`terran`), "An ocean world" (`ocean`), "A desert world" (`desert`),
    "A lava world" (`lava`), "An icy world" (`ice`), "A gas giant" (`giant`), "An ice giant"
    (`icegiant`), each with a short plain line saying what it is. Keep the four rows there are (the live
    suite uses them).
  - Such a world is made, put in place and moved exactly as "A planet like Earth" is now (on a circle
    round the star, the mass slider while it is put in place, Done), with these differences: it has no
    map of its own; it is drawn with the generated look of its type and a random seed (share the code
    that builds the look with `ExoPlanetLayer`: move it into a function both use, rather than copying
    it), lit by its star as the other worlds are; and while it is put in place a "New look" button gives
    it another seed. Its mass range is its type's: rocky, ocean, desert and lava from a twentieth of the
    Earth to 10 Earths; icy from a thousandth of the Earth to 5 Earths; an ice giant from 5 to 50 Earths;
    a gas giant from 10 Earths to 13 Jupiters. Its size follows its mass by the rules `madeSize` already
    has (rock, ice, between, giant), and its facts say what it is and that it was made, as now.
  - Its type and seed are kept with it (`madeAs`), so that Undo, Replay, a save on the device and a
    shared link bring back the same world (`madeAgain`, `src/app/Saves.ts`, `src/app/SceneLink.ts`).
  - Do these in this order, and if time runs short stop after a whole one and say what is left: the
    rows and the generated look; New look; keeping it in saves and links.
- **Done when:**
  - Unit tests: each new kind's mass range and size rule; `madeAs` with a type and a seed survives a
    save and a link (the save's and the link's own tests).
  - Browser checks in `scripts/live.mjs` (the `made` block, phone and desk): round the Sun, "A gas
    giant" makes a world drawn with the generated look (its mesh's material is the generated look, not
    a map), and "New look" changes its seed and what it looks like; a save of the scene, opened again,
    brings it back with the same type and seed. They fail on the code before the change.
  - Pictures, upright at 390x844, of each of the seven kinds just made near the Earth's orbit (the card
    showing its name).
  - Run `LIVE_ONLY=made,place` of `scripts/live.mjs` (phone and desk) and `scripts/share.mjs`; Claude
    runs the whole set after. `npm run check` passes.
- **Don't touch:** `src/app/LivePhysics.ts` and `src/sim/` (the physics), the camera rig, the watch
  (`src/app/Watch.ts`), the tab bar. No catalogue data changes: a made world never changes a real one.

### `task/watch-button`: after a change, no surprise fast-forward; a "Watch" button that plays until stopped

- **Status:** done 27 Nov 2026 (1155e9b): run 45954923204 on Claude Sonnet 5.5 ($1.28), reviewed by Claude
  (HANDOFF.md brought up to date); full set 45962237797 passed but for a flake. On the developers'
  site; on the play testers' site at the next release. Medium.
- **Model:** `anthropic/claude-sonnet-5-5`
- **The problem:** the owner, 27 Nov 2026, testing God mode on a phone: "when you edit something, it
  creates live physics, which speeds everything up, and then ends after a random amount of time. Last
  time I tried it was 48 days." Today every change (mass, move, add, remove, a world put in place)
  starts a watch by itself (`App.endChange` -> `startWatch`, `src/app/App.ts`): time runs at a pace
  chosen to show the change (`planChange`, `src/app/Watch.ts`) for `WATCH_SECONDS` of real time, then
  the explorer's own rate comes back and the chip says "Watched: 48 days" with Replay. The More switch
  "Show me what happens" (`show-me`, on by default) turns the watch off altogether. The owner found
  both the sudden speed-up and the end that comes by itself confusing.
- **What to do:** read `HANDOFF.md` "Design" first (plain words, the `--sf-*` tokens, every target at
  least 44 px).
  - After a change, time stays exactly as the explorer had it (paused stays paused, and the rate is
    kept). The live physics switches on as today. If the change has a watch (`planWatch` returns a
    frame), the watch chip (`.hud-watch`, `src/ui/Hud.ts` `renderWatch`) offers it: a short line
    such as "See what it does" and a button "Watch" (a new `data-act`, for example `watch-start`),
    beside the Close button. Undo is offered as today.
  - Watch: from the moment just after the change (the checkpoint Replay uses today, `replayFrom`),
    time runs at the watch's pace and the camera eases to the frame, as a watch does today. The chip
    says "Watching: 3.2 days a second" with Stop, as today. It keeps going until the explorer stops
    it: Stop, Escape, a change of the rate of time by hand, or a new change. It has no end of its
    own: remove the end after `WATCH_SECONDS` (keep slowing down near a hit, and keep slowing down
    when the stepping cannot keep up).
  - Stop: the explorer's own rate comes back, and Replay is offered, as today ("Watched: 48 days").
    Replay watches again from just after the change, until stopped.
  - The More switch "Show me what happens" now means "start the watch by itself after a change". It
    is off by default (`recall('show-me') === '1'`), and its toast says so in plain words. On, a
    change starts its watch by itself, which then also runs until stopped.
  - A world put in place with Done (`placed`) is offered its watch the same way.
- **Done when:**
  - Unit tests for `Watch` (`tests/watch.test.ts`): a watch no longer ends by itself after
    `WATCH_SECONDS`; it still slows down when the stepping is behind.
  - `scripts/live.mjs`: new checks, on a phone and at a desk, that after a change time is as before
    (paused stays paused, the rate unchanged) and the chip offers Watch; that Watch runs the watch
    (the chip says "Watching: ...", time at the watch's pace); and that 30 seconds later it is still
    watching, until Stop. They fail on the code before the change. Update the checks that expected the
    watch to start or end by itself so that they tap Watch, or Stop, first (for example "after fifteen
    seconds the watch ends", "Done: time runs, and what follows is watched", "let go, Mars falls ...
    watched; time slows ..."); none is made weaker; list each one changed in the report. The check
    "with Show me what happens off in More, a change is made and nothing is watched" becomes: with it
    on, the watch starts by itself.
  - The suites run here are long: run `LIVE_ONLY=watch,throw,hit,place` of `scripts/live.mjs` (phone
    and desk), and `scripts/whatif.mjs`. Claude runs the whole set after.
  - Pictures, upright at 390x844: the chip offering Watch after a change, and watching.
  - `npm run check` passes.
- **Don't touch:** `src/app/LivePhysics.ts` and `src/sim/` (the physics itself), the camera rig, the
  tab bar.

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

### `task/simple-flight`: the ship's controls, simple by default

- **Status:** done 27 Nov 2026 (run 45906482372, reviewed by Claude, 030d8f8): on the developers' site; on the play
  testers' site from the next release. Medium.
- **Model:** `opencode-go/kimi-k3.1-pro`
- **The problem:** the owner, 26 Nov 2026, with a phone screenshot of the ship flying to Gacrux: "the
  flying controls still look a bit too advanced and not intuitive enough like the steering and side
  thrust". Upright on a phone the ship shows, besides its instruments: a drive row ("Main drive /
  Field drive", "-", "1,000,000 x gravity", "+"); a "Steering" chip that opens nine assist modes named
  as in spaceflight simulators (Off, Hold, Prograde, Retrograde, Normal, Anti-normal, Radial out,
  Radial in, Target); a "Side thrust" chip that opens a 3x3 pad of thruster buttons; the thrust lever,
  Stop and the view button. They are in `src/game/FlightHud.ts` (the chips' markup near line 290,
  the modes' names near line 196, the styles at its top).
- **What to do:** read `HANDOFF.md` "Design" and "The relativistic ship" first, and follow the
  design rules (the `--sf-*` tokens, flat, plain words, every target at least 44 px).
  - Add a setting "Pilot controls", off by default, in More with the other switches, kept on this
    device as the other settings are.
  - Pilot controls off (the default): the instruments, the thrust lever, Stop and the view button
    stay. The drive row gives way to one plain chip, "Engine", whose tap opens four choices:
    "Gentle", "Fast", "Very fast" and "Near light speed", from about 1 x gravity up to the field drive
    at its strongest. Each choice sets the drive and its strength as the drive row would. Choose the
    values from those the drive row offers, and give them in the report. The Steering and Side thrust
    chips are hidden; the steering assist stays at Hold, so the ship keeps steady, and a finger's
    drag still turns it.
  - Pilot controls on: everything exactly as it is today.
  - At a desk the keys work in both modes; with Pilot controls off only the on-screen chips hide.
  - No control or function is removed: Pilot controls brings every one back.
- **Done when:**
  - New checks in `scripts/flight.mjs` (phone part): by default there is no Steering or Side thrust
    chip and no drive row; each of the Engine chip's four choices sets the drive (read the ship's
    drive back); turning Pilot controls on in More brings back the chips and the drive row. They
    fail on the code before the change.
  - The `flight` (phone and desk), `touch`, `live` and `start` suites pass, but for the known flaky
    checks in `docs/notes/testing.md`. A check that uses the steering modes, the side thrusters or the
    drive row turns Pilot controls on first; none is made weaker. List each changed check in the
    report.
  - Pictures before and after, upright at 390x844 and on its side at 844x390, flying towards a star
    with the instruments showing.
  - `npm run check` passes.
- **Don't touch:** `src/game/Flight.ts` and `src/game/Autopilot.ts` (the flight itself), the tab bar,
  `src/app/powersFor.ts`.

### `task/tab-bar`: the bottom bar and the round buttons, in the new design

- **Status:** done, live 26 Nov 2026 (run 45705433565, reviewed by Claude; the browser suites found the row of keys over the world framed above an open card, upright, so it steps aside while the card is open, 486b85f). Medium. Design, Part 3 (`HANDOFF.md` "Design", "Next screens", item 2).
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

- **Status:** done 27 Nov 2026 (2dc1872): the first try (run 45720347631) and its second try with
  the review's seven fixes (run 45920621727, on Claude Sonnet 5.5 with the owner's Claude API
  credits: $1.33), reviewed by Claude with two small changes. The browser suites' jobs now check
  out `src/offline` too, which `vite.config.ts` imports. Checked in runs 45927284510 and
  45935774349: every suite passed (offline included), but for two documented flakes and two
  jobs whose setup failed. On the developers' site; on the play testers' site at the next
  release.
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
