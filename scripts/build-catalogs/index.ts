/**
 * Starfarer catalog pipeline — `npm run build:catalogs`
 *
 *   1. download   raw catalogues from their official sources into .raw/ (cached)
 *   2. clean      parse, cross-match, de-duplicate, derive 3D positions
 *   3. tile       quantise into brightness-ordered octree tiles (DEFLATE-compressed)
 *   4. manifest   public/data/manifest.json + BUILD_REPORT.json
 *
 * Flags:
 *   --skip-download   build from the cached raw files only
 *   --download-only   stop after step 1
 *
 * The pipeline never invents data: a source that cannot be fetched aborts the
 * build (or, for optional sources, is reported as missing in BUILD_REPORT.json).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Manifest, qStarDec, qStarDist, qStarRa } from '../../src/data/format/schema';
import { GAIA_G_LIMIT, downloadAll } from './download';
import { OUT_DIR } from './lib/http';
import { NameRegistry } from './lib/names';
import { buildDso, loadNotable } from './steps/dso';
import { buildExoplanets } from './steps/exoplanets';
import { buildGalaxies } from './steps/galaxies';
import { MASK_H, MASK_W, SDSS_R_LIMIT, TWOMRS_K_LIMIT, buildConstellations, buildLss, buildSolarElements } from './steps/misc';
import { NEAR_RADIUS_PC, loadStars, writeStars } from './steps/stars';
import { measureFirstLaunch } from './steps/firstLaunch';

function dirSize(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const started = Date.now();
  const report: Record<string, unknown> = { built: new Date().toISOString() };

  if (!args.has('--skip-download')) {
    const failures = await downloadAll();
    report.downloadFailures = failures;
    if (failures.length) {
      console.error(`\n${failures.length} download step(s) failed. Fix connectivity and re-run (downloads resume), or see DECISIONS.md for fallbacks.`);
      process.exit(1);
    }
  }
  if (args.has('--download-only')) return;

  // Start from a clean output folder so stale tiles never survive a rebuild.
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const names = new NameRegistry();
  const notable = loadNotable();

  console.info('\nStars…');
  const { store, stats: starStats } = loadStars(names);
  report.stars = starStats;

  // Curated companions of real stars (e.g. the Cygnus X-1 black hole orbiting HD 226868).
  const companions: Array<{ key: [number, number, number]; aliases: string[]; companion: Record<string, string | number>; ref: string }> = [];
  for (const c of notable.starCompanions) {
    const hip = /^HIP (\d+)$/.exec(c.star);
    const gaia = /^Gaia DR3 (\d+)$/.exec(c.star);
    const idx = hip ? store.byHip.get(Number(hip[1])) : gaia ? store.bySource.get(BigInt(gaia[1]!)) : undefined;
    if (idx === undefined) {
      console.warn(`  ! curated companion host ${c.star} is not in the star sample — skipped`);
      continue;
    }
    const key: [number, number, number] = [qStarRa(store.ra[idx]!), qStarDec(store.dec[idx]!), qStarDist(store.dist[idx]!)];
    if (store.nameHandle[idx]! >= 0) {
      const e = names.get(store.nameHandle[idx]!);
      e.names = [...c.aliases, ...e.names];
      e.priority = 0;
    } else {
      store.nameHandle[idx] = names.add({ kind: 's', ds: 'stars', names: [...c.aliases, c.star], a: key[0], b: key[1], c: key[2], priority: 0 });
    }
    companions.push({ key, aliases: c.aliases, companion: c.companion, ref: c.ref });
  }

  console.info('Exoplanets…');
  const exo = buildExoplanets(store, names);
  report.exoplanets = exo.stats;

  console.info('Deep-sky objects…');
  const dso = buildDso(names);
  report.dso = dso.stats;

  console.info('Constellations…');
  const cons = buildConstellations(store);

  console.info('Galaxies & quasars…');
  const gal = buildGalaxies(names, notable, () => names.finalize());
  report.galaxies = gal.stats;

  console.info('Star tiles…');
  const starManifest = writeStars(store, names);
  const nameChunks = names.write();

  console.info('Large-scale structure…');
  const lss = buildLss(gal.sdss);
  Object.assign(report, { lss: lss.stats });

  console.info('Solar System…');
  buildSolarElements();

  const notableOut = JSON.stringify({ starCompanions: companions, galaxyNotes: gal.notes });
  writeFileSync(join(OUT_DIR, 'notable.json'), notableOut);

  const datasets = [starManifest, ...gal.manifests];
  const totals: Record<string, number> = {
    stars: starManifest.count,
    galaxies: gal.manifests.filter((m) => m.kind === 'galaxies').reduce((s, m) => s + m.count, 0),
    quasars: gal.manifests.filter((m) => m.kind === 'quasars').reduce((s, m) => s + m.count, 0),
    exoplanets: exo.file.count,
    deepSky: dso.file.count,
    constellations: cons.file.count,
  };
  totals.all = totals.stars! + totals.galaxies! + totals.quasars! + totals.exoplanets! + totals.deepSky!;

  const manifest: Manifest = {
    version: 1,
    built: String(report.built),
    datasets,
    totals,
    names: nameChunks,
    files: {
      dso: dso.file,
      exoplanets: exo.file,
      constellations: cons.file,
      lss: lss.file,
      notable: { file: 'notable.json', bytes: notableOut.length },
    },
    params: {
      gaiaGLimit: GAIA_G_LIMIT,
      nearRadiusPc: NEAR_RADIUS_PC,
      twoMrsKLimit: TWOMRS_K_LIMIT,
      sdssRLimit: SDSS_R_LIMIT,
      maskW: MASK_W,
      maskH: MASK_H,
    },
    initial: [nameChunks[0]!.file, dso.file.file, exo.file.file, cons.file.file, 'notable.json'],
    totalBytes: 0,
  };
  // Two passes so the manifest can state the true total (its own size barely changes).
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));
  manifest.totalBytes = dirSize(OUT_DIR);
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));

  const first = measureFirstLaunch(manifest);
  report.totals = totals;
  report.totalBytes = manifest.totalBytes;
  report.firstLaunch = first;
  report.seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(join(OUT_DIR, 'BUILD_REPORT.json'), JSON.stringify(report, null, 1));

  console.info(`\nDone in ${report.seconds}s.`);
  console.info(`  real objects : ${totals.all!.toLocaleString('en-US')}  (stars ${totals.stars!.toLocaleString('en-US')}, galaxies ${totals.galaxies!.toLocaleString('en-US')}, quasars ${totals.quasars!.toLocaleString('en-US')}, exoplanets ${totals.exoplanets}, deep-sky ${totals.deepSky})`);
  console.info(`  total data   : ${(manifest.totalBytes / 1e6).toFixed(1)} MB (budget 100 MB)`);
  console.info(`  first launch : ${(first.bytes / 1e6).toFixed(2)} MB in ${first.files} files (budget 10 MB)`);
  if (manifest.totalBytes > 100e6) console.warn('  ! total data exceeds the 100 MB budget');
  if (first.bytes > 10e6) console.warn('  ! first-launch download exceeds the 10 MB budget');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
