/**
 * Message protocol between the main thread and the data workers.
 * Each request carries a numeric id; the worker answers with the same id.
 */
import type { CatalogSuppression, StarBlock, StarCell } from '../../universe/starfield';
import type { GalaxyCell } from '../../universe/cosmicWeb';
import type { GalaxyModel } from '../../universe/types';
import type { TerrainPatchData, TerrainPatchRequest } from '../../universe/terrain';
import type { CatalogChunkData, PointChunkData } from '../decode';
import type { DatasetKind } from '../format/schema';
import type { ColumnSpec } from '../format/tileFormat';

export interface JobMap {
  /** Decompress + decode a catalogue tile. */
  tile: { in: { kind: DatasetKind; specs: ColumnSpec[]; bytes: Uint8Array; cx: number; cy: number; cz: number; half: number }; out: CatalogChunkData };
  /** Decode an id sidecar. */
  ids: { in: { bytes: Uint8Array }; out: BigUint64Array };
  /** Decompress a zlib'd JSON file (names chunks, deep-sky list, exoplanets, constellations). */
  json: { in: { bytes: Uint8Array }; out: unknown };
  /** Install large-scale-structure data + catalogue limits used by galaxy generation (sent to every worker). */
  setLss: { in: { bytes: Uint8Array; twoMrsLimit: number; avoidanceDeg: number; sdssLimit: number }; out: true };
  /** Generate a block of k³ procedural star cells of a galaxy (what the star field is drawn from). */
  starBlock: { in: { galaxy: GalaxyModel; level: number; k: number; bx: number; by: number; bz: number; suppress: CatalogSuppression | null }; out: { cell: StarBlock; chunk: PointChunkData } };
  /** Generate one procedural star cell of a galaxy (used to look a star up by its id). */
  starCell: { in: { galaxy: GalaxyModel; level: number; ix: number; iy: number; iz: number; suppress: CatalogSuppression | null }; out: { cell: StarCell; chunk: PointChunkData } };
  /** Generate one cosmic-web cell (galaxies or glow particles). */
  galaxyCell: { in: { level: number; ix: number; iy: number; iz: number; real: boolean }; out: { cell: GalaxyCell; chunk: PointChunkData } };
  /** Build the mesh data of one terrain patch. */
  terrain: { in: TerrainPatchRequest; out: TerrainPatchData };
}

export type JobType = keyof JobMap;

export interface WorkerRequest<K extends JobType = JobType> {
  id: number;
  type: K;
  payload: JobMap[K]['in'];
}

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
