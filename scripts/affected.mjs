#!/usr/bin/env node
// Which browser suites a change can affect, from the files it touches.
//
//   node scripts/affected.mjs <changed files...>        the suites, one line, space separated
//   node scripts/affected.mjs --base <ref>              the files changed since <ref> (merge base), then as above
//   node scripts/affected.mjs --all                     the full set
//   add --why to see which rule picked each suite
//   node scripts/affected.mjs --matrix <suites...>      the jobs for those suites, as JSON (the workflow's matrix; "none": [])
//
// The map is deliberately coarse and errs towards running more: everything the explorer does goes
// through src/app/App.ts, so a file not named below (and anything that boots the app, draws every
// frame or is shared by the scripts) picks the FULL set. Files that cannot change what the browser
// suites see (docs, unit tests, the data pipeline, the trailer) pick none. Before pushing a large
// change, or once per batch, run the full set anyway (docs/notes/testing.md).
import { execFileSync } from 'node:child_process';

/** Every browser suite of the deploy checklist (HANDOFF.md "Checks before every deploy"). */
export const FULL = ['start', 'touch', 'interact', 'verify', 'exposure', 'stars', 'whatif', 'live', 'vr', 'game', 'walk', 'places', 'terrain', 'flight', 'ship', 'share', 'everywhere', 'offline'];

/**
 * The suites that run in parts at once on GitHub's runners (one job each): the parts together are
 * the whole suite. walk's modes (argument 4), flight's FLIGHT_ONLY and everywhere's places (argument 4)
 * are the suites' own; `all` of walk is touch + desktop + vr. Only the longest suites are split:
 * the account runs about 20 jobs at once for all helpers, and a full set is then 23.
 */
export const PARTS = {
  walk: [{ part: 'touch', args: 'touch' }, { part: 'desktop', args: 'desktop' }, { part: 'vr', args: 'vr' }],
  flight: [{ part: 'desk', env: { FLIGHT_ONLY: 'desk' } }, { part: 'phone', env: { FLIGHT_ONLY: 'phone' } }],
  everywhere: [{ part: 'solar', args: 'solar' }, { part: 'stars', args: 'stars' }, { part: 'planets', args: 'planets' }, { part: 'deep', args: 'deep' }],
};

/** One job per suite, or per part of a split suite: { name, suite, args, env } (env: KEY=value words). */
export function matrix(suites) {
  return suites.flatMap((suite) => (PARTS[suite] ?? [{}]).map((p) => ({
    name: p.part ? `${suite}-${p.part}` : suite,
    suite,
    args: p.args ?? '',
    env: Object.entries(p.env ?? {}).map(([k, v]) => `${k}=${v}`).join(' '),
  })));
}

const HUD = ['start', 'touch', 'interact', 'live', 'whatif', 'flight', 'ship', 'walk', 'game', 'vr', 'share', 'everywhere', 'offline'];
const GROUND = ['walk', 'terrain', 'touch', 'flight', 'verify'];
const SHIP = ['flight', 'game', 'ship', 'vr', 'verify', 'walk'];
const OFFLINE = ['offline', 'start', 'touch', 'share'];

/**
 * [pattern, suites]: every rule that matches a file adds its suites. `null`: the full set.
 * A file that no rule names picks the full set if FALLBACK matches it, else none.
 */
const RULES = [
  // nothing a browser suite sees
  [/^(docs|tests|pipeline|trailer)\//, []],
  [/^[^/]+\.md$/, []],
  [/^LICENSE$/, []],
  [/^\.github\/workflows\/deploy-pages\.yml$/, []],
  [/^scripts\/(affected|remote-test|bench|bench-decode|exoterrain-gpu|og-image)\.mjs$/, []],
  [/^src\/perf\//, ['interact']],                       // the perf HUD and bench (bench.mjs is not in the set)
  // the scripts themselves
  [/^scripts\/lib\/browser\.mjs$/, null],
  [/^scripts\/lib\/touch\.mjs$/, ['flight', 'live', 'ship', 'stars', 'touch', 'walk', 'whatif', 'share', 'everywhere']],
  [/^scripts\/stereo\.mjs$/, ['vr']],
  [/^\.github\/workflows\/browser-tests\.yml$/, null],
  // the offline copy: its file list, service worker, platform code and panel in More
  [/^(src\/(offline\/|platform\/offline\.ts|ui\/(OfflinePanel\.ts|offline\.css))|public\/sw(-off)?\.js$|vite\.config\.ts$)/, OFFLINE],
  // the start: the loading screen and the title screen
  [/^src\/(app\/StartMenu\.ts|ui\/start\.css)$/, ['start', 'touch', 'vr', 'share']],
  // links to a scene, saves, and handing them on
  [/^src\/(app\/(SceneLink|SceneWorld|Saves)\.ts|platform\/(share|storage)\.ts)$/, ['share', 'start', 'everywhere']],
  [/^src\/(ui\/Splash\.ts|app\/Loading\.ts)$/, null],
  // the interface
  [/^src\/ui\/(Hud\.ts|styles\.css|icons\.ts)$/, HUD],
  [/^src\/app\/(Gestures|Input)\.ts$/, ['touch', 'interact', 'live', 'whatif', 'walk', 'flight', 'ship', 'start', 'everywhere']],
  [/^src\/app\/(destinations|Systems)\.ts$/, ['touch', 'interact', 'vr', 'verify', 'live', 'whatif', 'everywhere']],
  // the headset
  [/^src\/(app\/VR\.ts|vr\/|render\/XrGpu\.ts)/, ['vr', 'start', 'walk']],
  // the ground, walking, landing
  [/^src\/(app\/Walk\.ts|render\/(Rocks|PlanetTerrain|TerrainPatch|TileDetail|Materials)\.ts|universe\/(Elevation|Terrain|TerrainHeights|TerrainTiles|Landmarks|ExoTerrain)\.ts|workers\/terrainTiles\.worker\.ts)$/, GROUND],
  // live physics, the powers, what if
  [/^src\/(app\/(LivePhysics|Powers|History|Watch|Mover|WhatIf|Worked)\.ts|sim\/(NBody|SystemSim|KeplerDrift|Kepler)\.ts)$/, ['live', 'whatif', 'share', 'everywhere']],
  // the eye
  [/^src\/app\/(Exposure|Daylight|Awe)\.ts$/, ['exposure', 'stars', 'verify', 'ship', 'interact', 'places']],
  // stars up close
  [/^src\/render\/(StarLook|StarCorona|NearStars)\.ts$|^src\/render\/shaders\/star/, ['stars', 'exposure', 'verify', 'interact']],
  // black holes
  [/^src\/(render\/(BlackHoleLayer|Jets)\.ts|render\/shaders\/blackhole|universe\/BlackHoles\.ts)/, ['exposure', 'verify', 'flight', 'interact', 'vr', 'everywhere']],
  // the ship and flying it
  [/^src\/(game\/|sim\/(ShipPhysics|Relativity|Predict|Gravity|physics)\.ts|render\/ViewMask\.ts)/, SHIP],
  // special places
  [/^src\/render\/(RingParticles|CometTails|Atmospheres|CloudLayer)\.ts$/, ['places', 'verify', 'exposure', 'everywhere']],
];
/** Anything else that ends up in the page, or builds it, and that no rule above names: the full set. */
const FALLBACK = /^(src\/|index\.html$|public\/|package(-lock)?\.json$|vite\.config\.ts$|tsconfig\.json$)/;

/** The suites for `files`, and why (suite -> first file that picked it). */
export function affected(files) {
  const why = new Map();
  const add = (suites, file, rule) => { for (const s of suites) if (!why.has(s)) why.set(s, `${file} (${rule})`); };
  for (const f of files.map((x) => x.replace(/^\.\//, '')).filter(Boolean)) {
    const suite = /^scripts\/([a-z0-9-]+)\.mjs$/.exec(f)?.[1];
    if (suite && FULL.includes(suite)) { add([suite], f, 'the suite itself'); continue; }
    const hits = RULES.filter(([re]) => re.test(f));
    if (!hits.length) { if (FALLBACK.test(f)) add(FULL, f, 'not in the map: the full set'); continue; }
    for (const [re, suites] of hits) add(suites ?? FULL, f, suites ? String(re) : `${re}: the full set`);
  }
  return { suites: FULL.filter((s) => why.has(s)), why };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const showWhy = args.includes('--why');
  let files = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--all')) { console.log(FULL.join(' ')); process.exit(0); }
  if (args.includes('--matrix')) {
    // ("none": no jobs at all; a push with `Suites: none` only supersedes the run before it on its branch)
    const asked = files.flatMap((f) => f.split(/[\s,]+/)).filter((f) => f && f !== 'none');
    const unknown = asked.filter((s) => !FULL.includes(s));
    if (unknown.length) { console.error(`not a suite: ${unknown.join(' ')} (the suites: ${FULL.join(' ')})`); process.exit(2); }
    console.log(JSON.stringify(matrix([...new Set(asked)])));
    process.exit(0);
  }
  const b = args.indexOf('--base');
  if (b >= 0) {
    const ref = args[b + 1];
    files = files.filter((f) => f !== ref);
    files.push(...execFileSync('git', ['diff', '--name-only', `${ref}...HEAD`], { encoding: 'utf8' }).split('\n'));
    // (and what is not committed yet)
    files.push(...execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n'));
  }
  const { suites, why } = affected(files);
  console.log(suites.join(' '));
  if (showWhy) for (const s of suites) console.error(`  ${s}: ${why.get(s)}`);
}
