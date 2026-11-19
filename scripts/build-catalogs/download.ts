/**
 * Step 1 of the catalog pipeline: download every raw catalog from its official
 * source into scripts/build-catalogs/.raw/ (cached, resumable).
 *
 * Sources (see README "Data sources & licenses" for attributions):
 *   - ESA Gaia archive (TAP)           : Gaia DR3 bright stars, GCNS 100 pc sample,
 *                                        Bailer-Jones distances, Hipparcos cross-match
 *   - VizieR (CDS mirror at CfA)       : Hipparcos, HD/Bayer cross index, 2MRS,
 *                                        SDSS DR16Q, Harris globulars, Hunt & Reffert
 *                                        open clusters, ATNF pulsars, UNGC galaxies
 *   - SDSS SkyServer (DR17 SQL)        : spectroscopic galaxies
 *   - NASA Exoplanet Archive (TAP)     : confirmed planets (pscomppars)
 *   - OpenNGC (GitHub)                 : NGC/IC/Messier deep-sky objects
 *   - IAU WGSN                         : official star names
 *   - Stellarium "modern" sky culture  : constellation line figures
 *   - JPL Horizons                     : Solar System orbital elements
 *
 * Nothing in this file invents data: if a source cannot be reached the step
 * throws, and the orchestrator records the failure (see DECISIONS.md).
 */
import { download, pool } from './lib/http';
import { TapTimeLimitError, tapAsync, tapSync } from './lib/tap';
import { writeFileSync } from 'node:fs';
import { rawPath } from './lib/http';

const GAIA_TAP = 'https://gea.esac.esa.int/tap-server/tap';
const EXO_TAP = 'https://exoplanetarchive.ipac.caltech.edu/TAP';
// The main CDS host (vizier.cds.unistra.fr) is the canonical service; the CfA
// mirror serves identical catalogues and is used because it was the reachable
// host when this pipeline was written. Override with VIZIER_HOST if needed.
const VIZIER = `https://${process.env.VIZIER_HOST ?? 'vizier.cfa.harvard.edu'}/viz-bin/asu-tsv`;
const SKYSERVER = 'https://skyserver.sdss.org/dr17/SkyServerWS/SearchTools/SqlSearch';

/** Faint limit of the all-sky Gaia DR3 bright sample (G magnitude). */
export const GAIA_G_LIMIT = Number(process.env.GAIA_G_LIMIT ?? 11.5);

/**
 * The Gaia archive aborts anonymous jobs after 60 s, which is roughly 40k rows
 * of this query. The bright sample is therefore fetched in narrow G-magnitude
 * slices sized from the cumulative star-count law N(<G) ∝ 10^(0.43·G); any
 * slice that still hits the time limit is bisected automatically.
 */
export function gaiaSlices(limit = GAIA_G_LIMIT, rowsPerSlice = 32_000): Array<[number, number]> {
  const total = 1.97e6 * 10 ** (0.43 * (limit - 11.5));
  const edges = [-5];
  for (let k = 1; k * rowsPerSlice < total; k++) {
    edges.push(Math.round((limit + Math.log10((k * rowsPerSlice) / total) / 0.43) * 1e4) / 1e4);
  }
  edges.push(limit);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < edges.length; i++) out.push([edges[i]!, edges[i + 1]!]);
  return out;
}

export const GAIA_DIR = 'gaia';
export const gaiaSliceFile = (lo: number, hi: number): string => `${GAIA_DIR}/g_${lo.toFixed(4)}_${hi.toFixed(4)}.csv`;

async function gaiaSlice(lo: number, hi: number, done: string[]): Promise<void> {
  const adql = `SELECT source_id, ra, dec, parallax, parallax_error, pmra, pmdec, phot_g_mean_mag, bp_rp
    FROM gaiadr3.gaia_source WHERE phot_g_mean_mag >= ${lo} AND phot_g_mean_mag < ${hi}`;
  try {
    await tapAsync(GAIA_TAP, gaiaSliceFile(lo, hi), adql, { minBytes: 100 });
    done.push(gaiaSliceFile(lo, hi));
  } catch (err) {
    if (!(err instanceof TapTimeLimitError) || hi - lo < 2e-4) throw err;
    const mid = Math.round(((lo + hi) / 2) * 1e4) / 1e4;
    console.info(`  ↯ slice ${lo}–${hi} hit the 60 s limit, splitting at ${mid}`);
    await gaiaSlice(lo, mid, done);
    await gaiaSlice(mid, hi, done);
  }
}

export async function downloadGaia(): Promise<void> {
  console.info('Gaia DR3 (ESA Gaia archive TAP)…');
  // Row count straight from the archive: the build step checks the slices add up to it.
  const countCsv = await tapSync(GAIA_TAP, `SELECT COUNT(*) AS n FROM gaiadr3.gaia_source WHERE phot_g_mean_mag < ${GAIA_G_LIMIT}`);
  const expectedRows = Number(countCsv.trim().split('\n')[1]);
  if (!Number.isFinite(expectedRows) || expectedRows < 1000) throw new Error(`Unexpected Gaia count response: ${countCsv.slice(0, 200)}`);

  const files: string[] = [];
  await pool(gaiaSlices(), 3, ([lo, hi]) => gaiaSlice(lo, hi, files));

  // Volume-complete nearby sample: Gaia Catalogue of Nearby Stars (Gaia Collaboration, Smart et al. 2021).
  // 331k rows; fetched in parallax slices for the same 60 s reason.
  const gcns: string[] = [];
  const plxEdges = [0, 10.4, 10.9, 11.5, 12.2, 13, 14, 15.2, 16.8, 19, 22.5, 28, 40, 1000];
  await pool(plxEdges.slice(0, -1).map((lo, i) => [lo, plxEdges[i + 1]!] as const), 2, async ([lo, hi]) => {
    const name = `${GAIA_DIR}/gcns_${lo}_${hi}.csv`;
    await tapAsync(
      GAIA_TAP,
      name,
      `SELECT source_id, ra, dec, parallax, parallax_error, pmra, pmdec, phot_g_mean_mag, phot_bp_mean_mag,
        phot_rp_mean_mag, dist_50, wd_prob FROM external.gaiaedr3_gcns_main_1 WHERE parallax >= ${lo} AND parallax < ${hi}`,
      { minBytes: 100 },
    );
    gcns.push(name);
  });
  const gcnsCount = Number((await tapSync(GAIA_TAP, 'SELECT COUNT(*) AS n FROM external.gaiaedr3_gcns_main_1')).trim().split('\n')[1]);

  // Official Gaia DR3 <-> Hipparcos-2 cross-match (99.5k rows).
  const hipFiles: string[] = [];
  const hipEdges = [0, 30000, 60000, 90000, 130000];
  await pool(hipEdges.slice(0, -1).map((lo, i) => [lo, hipEdges[i + 1]!] as const), 2, async ([lo, hi]) => {
    const name = `${GAIA_DIR}/hipx_${lo}_${hi}.csv`;
    await tapAsync(
      GAIA_TAP,
      name,
      `SELECT source_id, original_ext_source_id, angular_distance FROM gaiadr3.hipparcos2_best_neighbour
        WHERE original_ext_source_id >= ${lo} AND original_ext_source_id < ${hi}`,
      { minBytes: 100 },
    );
    hipFiles.push(name);
  });

  writeFileSync(
    rawPath(`${GAIA_DIR}/COMPLETE.json`),
    JSON.stringify({ gLimit: GAIA_G_LIMIT, expectedRows, bright: files.sort(), gcns: gcns.sort(), gcnsCount, hip: hipFiles.sort() }, null, 1),
  );
  console.info(`  ✓ Gaia download complete: ${files.length} bright slices, expecting ${expectedRows} rows`);
}

/** Fetch a whole VizieR table as TSV. */
function vizier(name: string, source: string, columns: string[], extra = ''): Promise<string> {
  const out = columns.map((c) => `-out=${encodeURIComponent(c)}`).join('&');
  return download(name, `${VIZIER}?-source=${encodeURIComponent(source)}&${out}&-out.max=unlimited${extra}`, { minBytes: 2000, timeoutMs: 1_800_000 });
}

export async function downloadVizier(): Promise<void> {
  console.info('VizieR catalogues…');
  await vizier('hip/hip_main.tsv', 'I/239/hip_main', ['HIP', 'Vmag', 'RAICRS', 'DEICRS', 'Plx', 'e_Plx', 'pmRA', 'pmDE', 'B-V', 'SpType', 'HD']);
  await vizier('hip/hip2.tsv', 'I/311/hip2', ['HIP', 'RArad', 'DErad', 'Plx', 'e_Plx', 'pmRA', 'pmDE', 'Hpmag', 'B-V']);
  await vizier('hip/crossindex.tsv', 'IV/27A/catalog', ['HD', 'HIP', 'Vmag', 'Fl', 'Bayer', 'Cst']);
  await vizier('gal/2mrs.tsv', 'J/ApJS/199/26/table3', ['ID', 'RAJ2000', 'DEJ2000', 'Ktmag', 'Jtmag', 'Rext', 'b/a', 'type', 'cz', 'CAT']);
  await vizier('dso/harris_gc.tsv', 'VII/202/catalog', ['ID', 'Name', 'RAJ2000', 'DEJ2000', 'Rsun', 'Vt', '[Fe/H]', 'Rh', 'c'], '&-out.add=_RAJ,_DEJ');
  // Hunt & Reffert (2023) Gaia DR3 cluster catalogue, with the quality columns needed for their reliable-sample cut.
  await vizier('dso/hunt_clusters_v2.tsv', 'J/A+A/673/A114/clusters', ['Name', 'AllNames', 'Type', 'CST', 'CMDCl50', 'RA_ICRS', 'DE_ICRS', 'dist50', 'r50', 'r50pc', 'rtpc', 'N', 'logAge50', 'AV50']);
  // Planetary nebulae with Gaia EDR3 central-star distances (González-Santamaría et al. 2021).
  await vizier('dso/pn_main.tsv', 'J/A+A/656/A51/tablea1', ['PNG', 'OName', 'RA_ICRS', 'DE_ICRS', 'Gmag']);
  await vizier('dso/pn_dist.tsv', 'J/A+A/656/A51/tablea2', ['PNG', 'Plx', 'e_Plx', 'Dist', 'Radang', 'Radphys', 'Morph', 'SpType']);
  await vizier('dso/pulsars.tsv', 'B/psr/psr', ['PSRJ', 'PSRB', 'RAJ2000', 'DEJ2000', 'P0', 'Dist', 'Age', 'Bsurf', 'Type', 'Assoc'], '&-out.add=_RAJ,_DEJ');
  // Updated Nearby Galaxy Catalog (Karachentsev+ 2013): redshift-independent distances within ~11 Mpc.
  await vizier('gal/ungc.tsv', 'J/AJ/145/101/catalog', ['Name', 'RAJ2000', 'DEJ2000', 'a26', 'b/a', 'Bmag', 'Kmag', 'TT', 'Mcl', 'HRV', 'Dist', 'f_Dist', 'BMag'], '&-out.add=_RAJ,_DEJ');
  // SDSS DR16 quasar catalogue (Lyke et al. 2020): 750k rows, fetched in RA strips.
  const strips = Array.from({ length: 12 }, (_, i) => [i * 30, (i + 1) * 30] as const);
  await pool(strips, 2, ([a, b]) =>
    vizier(`qso/dr16q_${a}_${b}.tsv`, 'VII/289/dr16q', ['SDSS', 'RAJ2000', 'DEJ2000', 'z', 'imag', 'iMAG'], `&RAJ2000=${a}..${b === 360 ? 360.0001 : b - 1e-9}`),
  );
}

/** SDSS spectroscopic galaxies (DR17 SpecPhoto view), chunked by plate so each query is < 500k rows. */
export const SDSS_PLATE_STEP = 150;
export const SDSS_PLATE_MAX = 12900;
export const sdssChunkFile = (p0: number): string => `gal/sdss_${String(p0).padStart(5, '0')}.csv`;

export async function downloadSdss(): Promise<void> {
  console.info('SDSS DR17 spectroscopic galaxies (SkyServer SQL)…');
  const starts: number[] = [];
  for (let p = 250; p < SDSS_PLATE_MAX; p += SDSS_PLATE_STEP) starts.push(p);
  await pool(starts, 2, async (p0) => {
    // specObjID packs the plate number into its top bits (plate << 50), so a plate
    // range is a primary-key range scan.
    const lo = (BigInt(p0) << 50n).toString();
    const hi = (BigInt(p0 + SDSS_PLATE_STEP) << 50n).toString();
    const sql = `SELECT specObjID, ra, dec, z, modelMag_g, modelMag_r, petroMag_r, extinction_r, subClass
      FROM SpecPhoto WHERE specObjID >= ${lo} AND specObjID < ${hi}
      AND class = 'GALAXY' AND zWarning = 0 AND z > 0.0005 AND z < 1.6`;
    await download(sdssChunkFile(p0), `${SKYSERVER}?cmd=${encodeURIComponent(sql.replace(/\s+/g, ' '))}&format=csv`, { minBytes: 20, timeoutMs: 900_000, attempts: 6 });
  });
}

export async function downloadExoplanets(): Promise<void> {
  console.info('NASA Exoplanet Archive (pscomppars)…');
  const cols = [
    'pl_name', 'hostname', 'pl_letter', 'gaia_dr3_id', 'hip_name', 'hd_name', 'sy_snum', 'sy_pnum', 'cb_flag',
    'discoverymethod', 'disc_year', 'disc_facility', 'pl_orbper', 'pl_orbsmax', 'pl_orbeccen', 'pl_orbincl', 'pl_orblper',
    'pl_rade', 'pl_bmasse', 'pl_bmassprov', 'pl_eqt', 'pl_insol', 'st_teff', 'st_rad', 'st_mass', 'st_lum',
    'st_spectype', 'st_age', 'ra', 'dec', 'sy_dist', 'sy_plx', 'sy_vmag', 'sy_gaiamag', 'sy_kmag',
  ];
  const csv = await tapSync(EXO_TAP, `select ${cols.join(',')} from pscomppars`);
  if (csv.split('\n').length < 3000) throw new Error('Exoplanet Archive returned an implausibly small table');
  writeFileSync(rawPath('exo/pscomppars.csv'), csv);
  console.info(`  ✓ exo/pscomppars.csv (${csv.split('\n').length - 2} planets)`);
}

export async function downloadMisc(): Promise<void> {
  console.info('OpenNGC, IAU star names, constellations…');
  const gh = 'https://raw.githubusercontent.com';
  await download('dso/NGC.csv', `${gh}/mattiaverga/OpenNGC/master/database_files/NGC.csv`, { minBytes: 100_000 });
  await download('dso/addendum.csv', `${gh}/mattiaverga/OpenNGC/master/database_files/addendum.csv`, { minBytes: 1000 });
  await download('names/IAU-CSN.txt', 'https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt', { minBytes: 10_000 });
  await download('names/stellarium_modern.json', `${gh}/Stellarium/stellarium/master/skycultures/modern/index.json`, { minBytes: 10_000 });
}

/**
 * Solar System bodies whose orbits come from JPL Horizons: [key, Horizons id, centre id, step].
 * Planets use their system barycentres (smooth, no monthly wobble); moons are relative to their planet.
 */
export const HORIZONS_BODIES: Array<[string, string, string, string]> = [
  ['mercury', '1', '10', '30d'], ['venus', '2', '10', '30d'], ['earth', '3', '10', '30d'], ['mars', '4', '10', '30d'],
  ['jupiter', '5', '10', '30d'], ['saturn', '6', '10', '30d'], ['uranus', '7', '10', '30d'], ['neptune', '8', '10', '30d'],
  ['pluto', '9', '10', '30d'], ['ceres', '1;', '10', '30d'],
  ['moon', '301', '399', '3d'], ['phobos', '401', '499', '3d'], ['deimos', '402', '499', '3d'],
  ['io', '501', '599', '3d'], ['europa', '502', '599', '3d'], ['ganymede', '503', '599', '3d'], ['callisto', '504', '599', '3d'],
  ['mimas', '601', '699', '3d'], ['enceladus', '602', '699', '3d'], ['tethys', '603', '699', '3d'], ['dione', '604', '699', '3d'],
  ['rhea', '605', '699', '3d'], ['titan', '606', '699', '3d'], ['iapetus', '608', '699', '3d'],
  ['ariel', '701', '799', '3d'], ['umbriel', '702', '799', '3d'], ['titania', '703', '799', '3d'], ['oberon', '704', '799', '3d'], ['miranda', '705', '799', '3d'],
  ['triton', '801', '899', '3d'], ['charon', '901', '999', '3d'],
];

/**
 * Osculating elements sampled over 2020–2040. The build step fits the mean
 * longitude over this window, which averages out short-period perturbations
 * and gives mean motions good for decades (a single osculating snapshot
 * drifts by degrees within a few years).
 */
export async function downloadHorizons(): Promise<void> {
  console.info('JPL Horizons orbital elements, 2020–2040…');
  await pool(HORIZONS_BODIES, 2, async ([key, id, centre, step]) => {
    const q = new URLSearchParams({
      format: 'text', COMMAND: `'${id}'`, EPHEM_TYPE: "'ELEMENTS'", CENTER: `'500@${centre}'`,
      START_TIME: "'2020-01-01'", STOP_TIME: "'2040-01-01'", STEP_SIZE: `'${step}'`,
      REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'ICRF'", OUT_UNITS: "'KM-S'", OBJ_DATA: "'NO'", CSV_FORMAT: "'YES'",
    });
    await download(`sol2/${key}.txt`, `https://ssd.jpl.nasa.gov/api/horizons.api?${q.toString()}`, { minBytes: 20_000 });
  });
}

export const DOWNLOAD_STEPS: Record<string, () => Promise<void>> = {
  misc: downloadMisc,
  horizons: downloadHorizons,
  exoplanets: downloadExoplanets,
  vizier: downloadVizier,
  gaia: downloadGaia,
  sdss: downloadSdss,
};

/** Run the selected download steps; returns the list of steps that failed (never throws). */
export async function downloadAll(only?: string[]): Promise<Array<{ step: string; error: string }>> {
  const failures: Array<{ step: string; error: string }> = [];
  for (const [step, fn] of Object.entries(DOWNLOAD_STEPS)) {
    if (only && !only.includes(step)) continue;
    try {
      await fn();
    } catch (err) {
      console.error(`✗ download step "${step}" failed: ${String(err)}`);
      failures.push({ step, error: String(err) });
    }
  }
  return failures;
}

// Allow `tsx scripts/build-catalogs/download.ts [step…]` for running downloads on their own.
if (process.argv[1]?.endsWith('download.ts')) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  downloadAll(only.length ? only : undefined).then((f) => {
    console.info(f.length ? `Finished with ${f.length} failed step(s).` : 'All downloads complete.');
    process.exit(f.length ? 1 : 0);
  });
}
