/**
 * Measures the first-launch download: the files the app fetches before the
 * player can start, plus the tiles the streamer requests for the default
 * starting view (at the Sun, medium quality tier). Uses the real runtime LOD
 * selection, so the number in BUILD_REPORT.json is measured, not estimated.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Manifest } from '../../../src/data/format/schema';
import { tilePath } from '../../../src/data/format/schema';
import { buildNodeIndex, selectNodes } from '../../../src/data/lod';
import { DATASET_LOD, TIERS } from '../../../src/render/qualityTiers';
import { OUT_DIR } from '../lib/http';

export function measureFirstLaunch(manifest: Manifest): { bytes: number; files: number; tiles: Record<string, number> } {
  let bytes = statSync(join(OUT_DIR, 'manifest.json')).size;
  let files = 1;
  for (const f of manifest.initial) {
    bytes += statSync(join(OUT_DIR, f)).size;
    files++;
  }
  const tiles: Record<string, number> = {};
  for (const ds of manifest.datasets) {
    const lod = DATASET_LOD[ds.id];
    if (!lod) continue;
    const nodes = buildNodeIndex(ds);
    const tenPc = (10 * 3.0856775814913673e16) / ds.unit;
    const sel = selectNodes(nodes, 0, 0, 0, { budget: lod.share(TIERS.medium), magLimit: lod.magLimit, tenPc });
    tiles[ds.id] = sel.nodes.length;
    for (const i of sel.nodes) {
      bytes += statSync(join(OUT_DIR, tilePath(ds.id, nodes[i]!.path))).size;
      files++;
    }
  }
  return { bytes, files, tiles };
}
