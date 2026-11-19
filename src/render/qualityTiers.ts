/**
 * Quality tiers with explicit budgets. The adaptive-quality controller moves
 * between tiers (and scales render resolution inside a tier) based on measured
 * frame time; users can also pin a tier in Settings.
 *
 * Plain data, no rendering imports — the catalog build pipeline reads the
 * same budgets to measure the first-launch download.
 */

export type TierName = 'low' | 'medium' | 'high';

export interface QualityTier {
  name: TierName;
  /** Upper bound on device pixel ratio. */
  maxPixelRatio: number;
  /** Dynamic-resolution range (fraction of the capped device resolution). */
  minRenderScale: number;
  maxRenderScale: number;

  // ---- Point budgets (sum = total point budget).
  /** Real catalogue stars. */
  catalogStars: number;
  /** Procedural stars around the camera. */
  proceduralStars: number;
  /** Real galaxies + quasars. */
  catalogGalaxies: number;
  /** Procedural galaxies / cosmic-web particles. */
  proceduralGalaxies: number;

  /** Target ceiling for draw calls per frame; streaming and terrain LOD back off above it. */
  drawCallBudget: number;

  // ---- Shader detail.
  /** Ray-march steps for the hero galaxy volume. */
  galaxySteps: number;
  /** Ray-march steps for nebula volumes. */
  nebulaSteps: number;
  /** Geodesic integration steps for black-hole lensing. */
  blackHoleSteps: number;
  /** In-scatter samples for atmospheres. */
  atmosphereSteps: number;
  /** Noise octaves in planet / star surface shaders. */
  surfaceOctaves: number;
  /** Bloom mip levels. */
  bloomLevels: number;
  /** Galaxy impostor sprites drawn at once. */
  galaxyImpostors: number;

  // ---- Terrain.
  /** Vertices per terrain-patch edge (must be 2^n + 1). */
  terrainPatchRes: number;
  /** Maximum terrain patches alive at once. */
  terrainMaxPatches: number;
  /** Screen-space error (pixels per patch cell) that triggers a split. */
  terrainSplitPx: number;

  /** Film grain, chromatic aberration and lens-flare ghosts. */
  fancyPost: boolean;
}

export const TIERS: Record<TierName, QualityTier> = {
  low: {
    name: 'low', maxPixelRatio: 1.25, minRenderScale: 0.5, maxRenderScale: 0.85,
    catalogStars: 40_000, proceduralStars: 20_000, catalogGalaxies: 16_000, proceduralGalaxies: 14_000,
    drawCallBudget: 140,
    galaxySteps: 14, nebulaSteps: 12, blackHoleSteps: 24, atmosphereSteps: 4, surfaceOctaves: 3, bloomLevels: 4, galaxyImpostors: 24,
    terrainPatchRes: 17, terrainMaxPatches: 90, terrainSplitPx: 7,
    fancyPost: false,
  },
  medium: {
    name: 'medium', maxPixelRatio: 1.75, minRenderScale: 0.6, maxRenderScale: 1,
    catalogStars: 90_000, proceduralStars: 50_000, catalogGalaxies: 40_000, proceduralGalaxies: 40_000,
    drawCallBudget: 240,
    galaxySteps: 24, nebulaSteps: 20, blackHoleSteps: 40, atmosphereSteps: 6, surfaceOctaves: 4, bloomLevels: 5, galaxyImpostors: 64,
    terrainPatchRes: 33, terrainMaxPatches: 140, terrainSplitPx: 5,
    fancyPost: true,
  },
  high: {
    name: 'high', maxPixelRatio: 2, minRenderScale: 0.7, maxRenderScale: 1,
    catalogStars: 200_000, proceduralStars: 120_000, catalogGalaxies: 100_000, proceduralGalaxies: 100_000,
    drawCallBudget: 420,
    galaxySteps: 40, nebulaSteps: 32, blackHoleSteps: 64, atmosphereSteps: 8, surfaceOctaves: 5, bloomLevels: 6, galaxyImpostors: 128,
    terrainPatchRes: 33, terrainMaxPatches: 220, terrainSplitPx: 3.5,
    fancyPost: true,
  },
};

export const TIER_ORDER: TierName[] = ['low', 'medium', 'high'];

/** Total point budget of a tier. */
export function pointBudget(t: QualityTier): number {
  return t.catalogStars + t.proceduralStars + t.catalogGalaxies + t.proceduralGalaxies;
}

/**
 * How the real-catalogue budgets are split between datasets, and the faintest
 * apparent magnitude worth drawing in each.
 */
export const DATASET_LOD: Record<string, { share: (t: QualityTier) => number; magLimit: number }> = {
  stars: { share: (t) => t.catalogStars, magLimit: 13.5 },
  // Galaxy datasets are budget-limited only: whatever the scale of the view, the apparently
  // brightest N objects are loaded (so the real surveys stay visible from across the universe).
  galaxies: { share: (t) => Math.round(t.catalogGalaxies * 0.3), magLimit: 60 },
  sdss: { share: (t) => Math.round(t.catalogGalaxies * 0.45), magLimit: 60 },
  quasars: { share: (t) => Math.round(t.catalogGalaxies * 0.25), magLimit: 60 },
};
