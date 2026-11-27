import { Quaternion, type ShaderMaterial, Vector3 } from 'three';
import { HITCH } from '../core/hitch';
import { PRODUCT_NAME, STORAGE_PREFIX } from '../core/product';
import { VIEW_CONE } from '../render/Cull';
import { setUploadRenderer, uploadTexture, UPLOADS } from '../render/Uploads';
import { blackbodyRGB, irradianceToMag, luminance, magToIrradiance, sunIrradianceAt } from '../astro/photometry';
import { formatUtc, SimClock, utcToTdb, dateToJdUtc } from '../core/time';
import { AU, DAY, formatDistance, PC, SUN_RADIUS } from '../core/units';
import { fmtDuration, G, L_SUN, luminosity } from '../sim/physics';
import { AtmospheresLayer, type AtmosphereData } from '../render/Atmospheres';
import { BlackHoleLayer } from '../render/BlackHoleLayer';
import { BodiesLayer, makeSphere } from '../render/Bodies';
import { generatedLook, madeLook } from '../render/PlanetLook';
import { PlanetPortrait } from '../render/PlanetPortrait';
import { PlanetTerrain } from '../render/PlanetTerrain';
import { RingSpot } from '../universe/RingSpot';
import { Landmark, LANDMARKS } from '../universe/Landmarks';
import { CometTails } from '../render/CometTails';
import { ExoPlanetLayer, type ExoView } from '../render/ExoPlanetLayer';
import { GalaxyGlow } from '../render/GalaxyLayer';
import { JetsLayer } from '../render/Jets';
import { Labels, type LabelCandidate } from '../render/Labels';
import { EARTH_FOR_SCALE } from '../render/ScaleCues';
import { NearStarsLayer } from '../render/NearStars';
import { OrbitsLayer } from '../render/Orbits';
import { FlashLayer } from '../render/Flash';
import { FuturesLayer } from '../render/Futures';
import { TrailsLayer } from '../render/Trails';
import { ProceduralStarLayer } from '../render/ProceduralStarLayer';
import { Renderer, type ViewInfo, VOLUMES } from '../render/Renderer';
import { GLOBALS, LITE, depthK } from '../render/shaders/xr';
import { SkyLayer } from '../render/Sky';
import { Comet, SmallBodiesLayer } from '../render/SmallBodies';
import { StarFieldLayer } from '../render/StarField';
import { FACE_KEY } from '../render/StarLook';
import { TileDetail } from '../render/TileDetail';
import { type CraftView, SpacecraftLayer } from '../render/SpacecraftLayer';
import { loadMaterials } from '../render/Materials';
import { Rocks } from '../render/Rocks';
import { MilkyWayVolume } from '../render/MilkyWayVolume';
import { GalaxiesLayer } from '../render/GalaxiesLayer';
import { DeepSkyLayer } from '../render/DeepSkyLayer';
import { DeepSkyObject, loadDeepSky } from '../universe/DeepSky';
import { Galaxy, loadGalaxies } from '../universe/Galaxies';
import { loadSpacecraft, Spacecraft } from '../universe/Spacecraft';
import { aimStrokes, ringStrokes } from '../ui/aimShape';
import { Hud, PORTRAIT_CSS, type HudAction, type HudState } from '../ui/Hud';

import { BlackHole, loadBlackHoles } from '../universe/BlackHoles';
import { Awe } from './Awe';
import { Body, type SpaceObject } from '../universe/Body';
import { plainDistance, plainFacts, plainLine, plainSpeedWords } from './plainWords';
import { GALAXY, glowColumn } from '../universe/Galaxy';
import { MilkyWay } from '../universe/MilkyWay';
import { ExoPlanet, type PlanetarySystem } from '../universe/Planets';
import { PlanetarySim, SimBody } from '../universe/PlanetarySim';
import { type BodyJson, SolarSystem } from '../universe/SolarSystem';
import { StarCatalog } from '../universe/StarCatalog';
import { CatalogStar, NamedStars } from '../universe/Stars';
import { Catalog } from '../universe/Catalog';
import { normKey, normScore, queryKeys, scoreKey, SEARCH_ALIASES } from '../universe/CatalogSearch';
import { CameraRig, sunlitSide } from './CameraRig';
import { Game } from '../game/Game';
import { fmtTime, MAX_RATE, spinOf, WARP_STEPS } from '../game/Flight';
import { plainSpeed } from '../game/FlightHud';
import { orbitDrift, sunHeight, sunriseIn } from './Daylight';
import { TrafficShip } from '../game/Traffic';
import { Station } from '../game/Station';
import { adapt, diskLimit, diskMiddle, diskSeen, hidden, meterFrame, middleLimit, released, seen, settleOn, TAU_STARS, type Frame } from './Exposure';
import { canAdd, isCopyKind, isWorldKind, type Kind, MADE_FIRST_ID, MADE_MASS, madeAbsMag, madeAgain, type MadeLook, madeMassAt, madeSize, madeSlider, madeWords, newMoon, newSeed, newTwin, newWorld, TWIN_OF, WORLD_BASE, type WorldKind } from './WhatIf';
import { AHEAD_MOST, Foresight } from './Foresight';
import { SlowMotion, ZONE } from './Impacts';
import { type Hit, type LiveCheckpoint, LivePhysics, PLANETARY_LEFT_OUT, weighty } from './LivePhysics';
import { type Aim, Mover } from './Mover';
import { aheadWords, dayWords, farWords, listed, FRAME_MARGIN, frameDistance, impactWords, massFactor, massOf, massSlider, massTheory, massWords, type Meeting, radiusWords, rateWords, clockChipWords, sameDensity, sizeFactor, sizeSlider, sizeTimesWords, soonestContact, spanWords, clockSpeedWords, starMassWords, the, timesWords, viewFrame, whenWords } from './Powers';
import { type PowerPlace, powersFor, type PowerTable } from './powersFor';
import { Gesture, History } from './History';
import { type ChangeKind, Glide, planChange, type RateState, sample, type Sampled, Watch, type WatchFrame } from './Watch';
import { recall, remember } from '../platform/storage';
import { forgetFragment, handOn, linkFragment, onFragmentChange, pageLink } from '../platform/share';
import { decodeLink, encodeLink, isoOf, type Named, type SceneView } from './SceneLink';
import { decodeWorld, encodeWorld, fromBase64Url, HUE_STEPS, type LiveWorld, type MadeRecord, takeName, toBase64Url, WorldError } from './SceneWorld';
import { deleteScene, savedFragment, savedScenes, saveScene, SAVES_MOST } from './Saves';
import { liveDate } from '../sim/SystemSim';
import { type Sunlit, temperatureOf, type Worked, workedOut } from './Worked';
import { count, LoadProgress } from './Loading';
import { Input } from './Input';
import { canvasRatio, leanDevice, touchFirst } from '../core/device';
import { QUALITY } from '../render/Quality';
import { describe, distanceText, distanceTo, HOLES, moonWords, objectsOf, pictureOf, starTint, type Category, type Destination, type Picture } from './destinations';
import { Systems, wellStudied } from './Systems';
import { VRSupport } from './VR';
import { FreeFly } from './FreeFly';
import { Walk } from './Walk';
import { PERF } from '../perf/Perf';

/** a picture of a world being made, as the card takes it */
type HudPortrait = NonNullable<NonNullable<NonNullable<HudState['selection']>['place']>['portrait']>;

/**
 * How bright a star's face is shown (its mean, before the tone curve): a disk large enough to
 * show its face, at the level its colours are designed for (StarLook's FACE_KEY), whether it
 * fills the view or stands in a dark sky; a smaller one brighter, up to `small` for one a few
 * pixels wide (shown brighter, a face is shown hotter: orange, yellow, white. StarLook: faceLight).
 */
const starCap = (small: number, cssRadius: number) => small + (FACE_KEY - small) * smoothstep(12, 60, cssRadius);
/** a name a hair under the ground's horizon (radians: a tenth of a degree) still stands, as the limb's let off by a little */
const HORIZON_LEEWAY = 0.1 * (Math.PI / 180);
/** below this height over the ground (m) names are hidden by the ground's real horizon, bearing by bearing */
const LOW_OVER_GROUND = 2000;
const DATA = `${import.meta.env.BASE_URL}data`;
/** catalogue stars closer than this (pc) are drawn individually by the near-star layer */
const NEAR_STAR_RADIUS = 0.02;
/** black-hole companions closer than this (pc) are drawn by the near-star layer */
const COMPANION_RADIUS = 2;
/** black holes are labelled within this distance (pc) */
const BH_LABEL_PC = 400;
/** how far a generated planet's rings reach, in its radii (for what counts as "in view") */
const EXO_RING_REACH = 3;
/** where a hole's disk is brightest, in inner radii (BlackHoleLayer.radianceAt) */
const DISK_PEAK_RADIUS = 49 / 36;
/** how bright a disk's hottest ring is shown where the disk is a glowing surface filling part of the view */
const DISK_KEY = 0.8;
/**
 * With a hole itself in the frame, how many times brighter its disk may be drawn than as a
 * glowing surface: the side of the inner edge coming towards the eye, in its brightest streaks,
 * is that much over the display's white, and blooms.
 */
const DISK_GLARE = 6;
/** how much fainter than its sunlit face the brightest of a world's night side is taken to be (city lights, twilight) */
const NIGHT = 15;
/** how long the start waits for each piece of the first view (ms) before going on without it */
const FIRST_VIEW_WAIT = 12_000;
/**
 * The share of the sky's star regions that must be in before the start goes on. They arrive
 * brightest first: what is still to come by then is the faintest stars, which fill in unnoticed.
 */
const ENOUGH_STARS = 0.65;
/** the eye's height above the ground when standing on it (m) */
const EYE_HEIGHT = 1.6;
/** how far a black hole's glint and its tight glare reach round it on the screen (CSS px) */
const HOLE_GLINT_PX = 5;
/** a phone takes the headset's lighter shaders (LITE) only at the lowest quality level (render/Quality.ts: 0 full .. 3 lowest): a last resort */
const PHONE_LITE_FROM = 3;
/** a double tap on the world the camera is at brings it this many times closer */
const DOUBLE_TAP_ZOOM = 6;
/** a click picks what is drawn within this many pixels of it; a finger reaches farther */
const POINTER_REACH = 9;
const FINGER_REACH = 22;
const RATE_STEPS = [1, 10, 60, 600, 3600, 21600, DAY, 7 * DAY, 30.4375 * DAY, 365.25 * DAY, 3652.5 * DAY, 36525 * DAY];
/** a flight to a world from farther than this many times the distance it ends at may choose the side it arrives on (CameraRig: sunlitSide) */
const FAR_ARRIVAL = 30;
/** in live physics time can be asked to run faster still: a thousand years a second (it runs as fast as the stepping allows) */
const LIVE_RATE = 365250 * DAY;
/**
 * A change is watched at most this fast (simulated seconds a second): on a touch screen ten years a
 * second until a phone's stepping has been measured, a hundred at a desk (a quarter of one of this
 * machine's cores keeps up with about that with every planet there: docs/notes/gravity-engine.md)
 */
const WATCH_MOST_TOUCH = 10 * 365.25 * DAY, WATCH_MOST = 100 * 365.25 * DAY;
/** after the return to reality, Undo is offered at the top for this long (ms); then what was undone is let go */
const REAL_AGAIN_MS = 20_000;
/** two worlds about to hit, in the clear part of the view and at least this far apart on the screen (px), are seen coming together where they are */
const SEEN_APART = 40;
const bad = (why: string): never => { throw new WorldError(why); };
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** What the app draws and selects for a body: itself, or for a body of another star's system (src/universe/PlanetarySim.ts) the star or planet it stands for. */
const shownOf = (b: Body): SpaceObject => (b instanceof SimBody ? b.shows : b);
/** a link naming an object only the catalogue of real objects has waits this long for it (ms) */
const LINK_LOOKUP_WAIT = 8000;
/** the look ahead starts again from a change at most this often (ms) */
const AHEAD_AGAIN_MS = 200;
/** the camera rides with the planet of what it turns round out to this many times that planet's sphere of influence (Earth: 28 million km) */
const HOME_REACH = 30;

/** The moment the world here was last the real one: the date, the rate of time, and whether the clock was following the present then. */
interface Start { jd: number; rate: RateState; present: boolean }
/** What Undo goes back to: the worlds (LivePhysics), the rate of time, and the moment the changes began; `what`: the change it undoes, in words. */
interface Checkpoint { live: LiveCheckpoint; rate: RateState; present: boolean; begun: Start | null; what: string }
/** A change under way: what kind, to which world (for an Add, the one added to), the state before it, how many changes there had been, the worlds as it found them (src/app/Watch.ts). */
interface Pending { kind: ChangeKind; body: Body; before: Checkpoint; count: number; sample: Map<Body, Sampled> }

export class App {
  /** a phone or a tablet (held and touched): it takes the headset's lighter shaders once the governor steps down */
  private readonly phone = touchFirst();
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly labels: Labels;
  readonly rig = new CameraRig();
  readonly clock: SimClock;
  selection: SpaceObject | null = null;
  /** dark-adapted limiting magnitude for stars ("star brightness") */
  starMagLimit = 7.5;
  /** stars are never dimmed below this fraction of the dark-adapted exposure */
  starFloor = 0.3;
  private worked: { key: string; at: number; rows: Worked[] } = { key: '', at: 0, rows: [] };
  private logExposure = 0;
  private logLight = 0;
  private logStarCap = 0;
  private lastTime = performance.now();
  /** the hitch detector over this loop (src/core/hitch.ts) */
  readonly hitch = HITCH;
  private fps = 60;
  private hudTimer = 0;
  private nearTimer = 0;
  private nearestStarDist = Infinity;
  /** compile every shader before it is first needed (set again when VR changes tone mapping) */
  warmupPending = false;
  /** how the start went: each piece that was loaded and what it brought */
  loading!: LoadProgress;
  /** settles when the Milky Way's map is in (or could not be had) */
  private skyMap!: Promise<unknown>;
  /** settles once the shaders compiled at the start are ready (warmUp) */
  private shadersReady!: () => void;
  private readonly warmed = new Promise<void>((resolve) => { this.shadersReady = resolve; });
  private fieldMinDistPc = 0;
  /** one object per catalogue star so selection, labels and near-star rendering agree */
  private starCache = new Map<string, CatalogStar>();
  private camPc = new Vector3();
  private invQuat = new Quaternion();
  /**
   * `invQuat` turned to the middle of the screen's window rather than the optical axis, for the
   * exposure's frame (a symmetric one about the direction it is aimed along: src/app/Exposure.ts)
   */
  private meterInv = new Quaternion();
  private meterView: Frame = { quat: new Quaternion(), fovY: 50, aspect: 1 };
  /** where the optical centre is from the view's middle, eased towards the middle of what the interface leaves clear (CSS px) */
  private centre = { x: 0, y: 0 };
  /** geometry of the current view (desktop camera or the headset's left eye) */
  view: ViewInfo = { quat: new Quaternion(), fovY: 50, aspect: 1, width: 1, height: 1, pixelAngle: 1e-3, pixelRatio: 1, cx: 0, cy: 0, far: Infinity, xr: false };
  vr!: VRSupport;
  sky!: SkyLayer;
  atmospheres!: AtmospheresLayer;
  blackHoles: BlackHole[] = [];
  holes!: BlackHoleLayer;
  jets!: JetsLayer;
  /** scale cues: dust parallax, Earth for scale, the rumble of giants (src/app/Awe.ts) */
  awe!: Awe;
  /** the Milky Way's unresolved light (from the galaxy model) */
  galaxy!: GalaxyGlow;
  /** procedural stars filling the galaxy beyond the catalogues */
  procStars!: ProceduralStarLayer;
  readonly milkyWay = new MilkyWay();
  exo!: ExoPlanetLayer;
  /** game mode: ship, cockpit, autopilot, traffic, missions */
  game!: Game;
  /** walking on the ground (src/app/Walk.ts) */
  walk!: Walk;
  /** free flight by touch: a stick and buttons over the view (src/app/FreeFly.ts) */
  free!: FreeFly;
  /** other galaxies (SIMBAD) */
  galaxies!: GalaxiesLayer;
  /** nebulae and star clusters (SIMBAD) */
  deepSky!: DeepSkyLayer;
  /** the searchable catalogue of ~200,000 real objects (universe/Catalog.ts, public/data/catalog) */
  objCatalog: Catalog | null = null;
  /** real spacecraft (JPL Horizons trajectories) */
  craft!: SpacecraftLayer;
  /** close-up map tiles for the body being approached */
  tiles!: TileDetail;
  /** the lighter set of content, for devices with little memory (src/core/device.ts) */
  lean = false;
  /** photo mode (U): panels and labels hidden (read by Walk for its own HUD line) */
  photoMode = false;
  private labelsBeforePhoto = true;
  /** real 3D ground under the explorer near solid worlds */
  readonly terrain = new PlanetTerrain();
  /** the Milky Way drawn per pixel from outside it */
  readonly mwVolume = new MilkyWayVolume();
  /** rocks on the ground around the explorer (on the landing terrain) */
  rocks!: Rocks;
  /** comas and tails of the active comets */
  cometTails!: CometTails;
  /** systems drawn this frame: those of the stars around the explorer, plus a selected/targeted one */
  private nearSystems: PlanetarySystem[] = [];
  activeSystems: PlanetarySystem[] = [];
  private camGal = new Vector3();
  private cssW = 1;
  private cssH = 1;
  private rateIndex = 0;
  private rateSign = 1;
  frameCount = 0;
  /** the Solar System under its own gravity, once the explorer has changed something in it (src/app/LivePhysics.ts) */
  readonly solar: LivePhysics;
  /**
   * Another star's planetary system under its own gravity (src/universe/PlanetarySim.ts): the one
   * whose star or planet a power was last offered for. Live physics runs in one system at a time.
   */
  private exoSim: { source: PlanetarySim; physics: LivePhysics } | null = null;
  /** live physics as the powers go through it: the system it runs in, or while it runs nowhere, the selection's (`powerBody`) */
  physics: LivePhysics;
  /** where the simulated bodies have been */
  readonly trails = new TrailsLayer();
  /** live physics: a flash where two worlds met, and time slowed to see them meet (src/app/Impacts.ts) */
  readonly flash = new FlashLayer();
  readonly slow = new SlowMotion<Body>();
  /** live physics: the simulation run ahead for the world held, aimed or weighed, and its path drawn (src/app/Foresight.ts) */
  readonly ahead = new Foresight();
  readonly futures = new FuturesLayer(AHEAD_MOST);
  /** the world the look ahead is for (null: none now), what it was started from, when (ms), and where its path ends from the eye */
  private aheadOf: Body | null = null;
  private aheadFrom = '';
  private aheadAt = 0;
  private aheadEnd: Vector3 | null = null;
  /** the power to move a world with a finger (src/app/Mover.ts), and this frame the ring round the world it moves and its slingshot's arrow (null: none) */
  readonly mover: Mover;
  private handleNow: { x: number; y: number } | null = null;
  private aimNow: Aim | null = null;
  /** a world's size follows its mass at the same density (the Mass panel's Same density), or each is its own */
  private sizeFollows = false;
  /** watching what a change does (src/app/Watch.ts): the rate of time while it runs, then Replay */
  readonly watch = new Watch();
  /** a change starts its watch by itself (More: "Show me what happens", remembered on the device; off unless switched on: the watch is offered with a Watch button) */
  showMe = recall('show-me') === '1';
  /** the camera on its way to a watch's frame */
  private glide: Glide | null = null;
  /** Undo: the state before each of the last changes (src/app/History.ts) */
  private readonly history = new History<Checkpoint>();
  /** one change per gesture: a finger on the mass slider until it lifts, a world held, a run of keys */
  private readonly run = new Gesture();
  private pending: Pending | null = null;
  /** the moment just after the last change, and how it was watched: Replay goes back to it */
  private replayFrom: { cp: LiveCheckpoint; frame: WatchFrame } | null = null;
  /** where the changes began (the world here the real one): Back to reality returns to it */
  private begun: Start | null = null;
  /** when the real Solar System came back (performance.now, ms), for the Undo offered just after; 0: not offered */
  private realAgain = 0;
  /**
   * A world just made is being put in place (src/app/Mover.ts: place): whether time was paused
   * before it was made (null: the explorer has set the time since, which then stays as they set
   * it), and the mass it was made with (kg: its slider means exactly that near it).
   */
  private placement: { paused: boolean | null; base: number } | null = null;
  /** the studio that pictures a world being made, for its card, and its last picture (portraitOf) */
  private portrait: PlanetPortrait | null = null;
  private portraitShot: HudPortrait | null = null;
  /**
   * The world the camera was last framed round (a change's watch, or a new world being put in
   * place): the camera rides with it while the watch lasts, or the placing, even from beyond its
   * reach (the Earth and the Moon are framed from four million km, where the camera would ride
   * with the Sun, and the Earth go out of the frame at days a second).
   */
  private framed: Body | null = null;
  /** the frame the camera was last eased to (`frameOn`), until a finger or the pointer takes the camera back */
  private frameAsked: { centre: Body; radius: number } | null = null;

  private constructor(
    canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    labelRoot: HTMLElement,
    readonly system: SolarSystem,
    readonly catalogs: StarCatalog[],
    readonly named: NamedStars,
    readonly starFields: StarFieldLayer[],
    readonly bodies: BodiesLayer,
    readonly orbits: OrbitsLayer,
    readonly small: SmallBodiesLayer,
    readonly near: NearStarsLayer,
    renderer: Renderer,
    readonly systems: Systems,
  ) {
    this.renderer = renderer;
    this.input = new Input(canvas);
    this.hud = new Hud(hudRoot, this);
    this.labels = new Labels(labelRoot);
    this.clock = SimClock.now();
    this.physics = this.solar = new LivePhysics(system, { left: (b, into) => this.bodyLeft(b, into), dropped: (b) => this.bodies.changed(b) });
    this.mover = new Mover(this);
    orbits.simulated = (b) => this.solar.simulated(b);
    // (with the orbit lines: what hides them hides these)
    orbits.group.add(this.trails.group, this.futures.group);
    renderer.scene.add(this.flash.mesh);
  }

  /**
   * Load everything and build the app. All the downloads start at once, and each tells `progress`
   * when it is in and what it brought (the loading screen shows that: src/ui/Splash.ts). What
   * the explorer cannot do without (the Solar System, the stars) stops the start if it fails;
   * the rest is done without, with a warning.
   */
  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement, labelRoot: HTMLElement, progress = new LoadProgress()): Promise<App> {
    const useGaia = new URLSearchParams(location.search).get('gaia') !== '0';
    const systems = new Systems();
    const today = SimClock.now();
    const json = async <T>(url: string): Promise<T> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url.split('/').pop()}: HTTP ${res.status}`);
      return res.json() as Promise<T>;
    };
    const without = <T>(what: string, work: Promise<T>, instead: T): Promise<T> => work.catch((e) => { console.warn(what, e); return instead; });
    const kinds = (list: Body[], kind: string) => list.filter((b) => b.kind === kind).length;

    const solar = progress.run('solar', Promise.all([
      SolarSystem.load(DATA),
      json<ConstructorParameters<typeof BodiesLayer>[1]>(`${DATA}/textures/manifest.json`),
      json<ConstructorParameters<typeof BodiesLayer>[4]>(`${DATA}/solar/rings.json`),
      json<AtmosphereData>(`${DATA}/solar/atmospheres.json`),
    ]), ([s]) => `${count(kinds(s.bodies, 'planet'), 'planet')}, ${count(kinds(s.bodies, 'moon'), 'moon')}`);
    const stars = progress.run('stars', Promise.all([
      StarCatalog.load('athyg', `${DATA}/stars`),
      useGaia ? StarCatalog.load('gaia', `${DATA}/stars-gaia`) : Promise.resolve(null),
    ]).then(([a, g]) => {
      // (how far each star's distance can be trusted: Gaia's parallaxes, so only with Gaia's data)
      if (useGaia) a.qualityBase = `${DATA}/stars-quality`;
      // (where each star's temperature comes from: the catalogue's own)
      a.teffBase = `${DATA}/stars`;
      return [a, g] as const;
    }).then(async ([a, g]) => {
      // (Gaia's temperatures of hot stars the catalogue's colour and type cannot tell: only with Gaia's data)
      if (useGaia) {
        const idx = await without('Gaia temperatures', json<{ nodes: number[] }>(`${DATA}/stars-teff-gaia/index.json`), null);
        if (idx) a.gaiaTeff = { base: `${DATA}/stars-teff-gaia`, nodes: new Set(idx.nodes) };
      }
      return [a, g] as const;
    }), ([a, g]) => count(a.totalStars + (g?.totalStars ?? 0), 'star'));
    const names = progress.run('named', NamedStars.load(`${DATA}/stars`), (n) => n.list.length.toLocaleString('en-US'));
    const exo = progress.run('exo', without('exoplanets', systems.load(DATA), undefined),
      () => (systems.loaded ? `${count(systems.planetCount, 'planet')} of ${count(systems.count, 'star')}` : 'not available'));
    const deep = progress.run('deep', Promise.all([
      without('black holes', loadBlackHoles(DATA), [] as BlackHole[]),
      without('galaxies', loadGalaxies(DATA), [] as Galaxy[]),
      without('deep sky', loadDeepSky(DATA), [] as DeepSkyObject[]),
    ]), ([holes, galaxies, dso]) => `${count(holes.length, 'black hole')}, ${count(galaxies.length, 'galaxy', 'galaxies')}, ${count(dso.length, 'nebula and cluster', 'nebulae and clusters')}`);
    const smallBodies = progress.run('small', SmallBodiesLayer.fetch(DATA), (d) => `${count(d.orbits.length / 8, 'asteroid')}, ${count(d.comets.length, 'comet')}`);
    // (the Milky Way's map is the largest single file: it comes down beside the rest, and is waited for in firstView)
    const sky = new SkyLayer(`${DATA}/sky/milkyway_4k.jpg`);
    const skyMap = progress.run('sky', sky.ready, (size) => (size ? `${size.width.toLocaleString('en-US')} × ${size.height.toLocaleString('en-US')} pixels` : 'not available'));
    // (these two need the Solar System first)
    const spacecraft = solar.then(([s]) => progress.run('craft', without('spacecraft', loadSpacecraft(DATA, s.sun, s.byId.get(399)!), [] as Spacecraft[]), (c) => count(c.length, 'spacecraft', 'spacecraft')));
    const positions = solar.then(([s]) => progress.run('today', Promise.resolve(s.ephemeris.request(today.jdTdb)),
      () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })));

    const [xrCapable, [system, manifest, rings, atmoData], [catalog, gaia], named, , [blackHoles, galaxyList, dso], smallData, craft] = await Promise.all([
      VRSupport.detect(), solar, stars, names, exo, deep, smallBodies, spacecraft, positions,
    ]);
    const lean = leanDevice(xrCapable);
    const renderer = new Renderer(canvas, xrCapable);
    // Titan's visible disk is the top of its haze: shade it with the measured albedo spectrum
    // (Karkoschka 1998) rather than the Cassini near-infrared surface map.
    const spectral = (manifest as { spectralColors?: Record<string, { linearRGB: [number, number, number]; visualAlbedo: number }> }).spectralColors;
    const titan = system.bodies.find((b) => b.name === 'Titan');
    if (titan && spectral?.titan) {
      const [r, g, bl] = spectral.titan.linearRGB;
      const m = Math.max(r, g, bl);
      // (not texture = null: a body with none takes the map of its name, and Titan's is the grey
      // near-infrared mosaic of its ground, in patches with seams between them)
      titan.noMap = true;
      titan.color = [r / m, g / m, bl / m];
      titan.albedo = spectral.titan.visualAlbedo;
      titan.meta.albedo = spectral.titan.visualAlbedo;
    }
    const catalogs = gaia ? [catalog, gaia] : [catalog];
    const starField = new StarFieldLayer(catalog);
    const starFields = [starField, ...catalogs.slice(1).map((c) => new StarFieldLayer(c, starField.psf))];
    const bodies = new BodiesLayer(system, manifest, `${DATA}/textures`, starField.psf, rings);
    const orbits = new OrbitsLayer(system);
    const small = new SmallBodiesLayer(system, starField.psf);
    const near = new NearStarsLayer(starField.psf, bodies.lightExposure);
    const app = new App(canvas, hudRoot, labelRoot, system, catalogs, named, starFields, bodies, orbits, small, near, renderer, systems);
    app.loading = progress;
    systems.indexNamed(named);
    const sc = blackbodyRGB(system.sun.teff);
    const sl = luminance(sc);
    const atmospheres = new AtmospheresLayer(system, atmoData, bodies.surfaceExposure, [sc[0] / sl, sc[1] / sl, sc[2] / sl]);
    bodies.atmosphere = (b) => atmospheres.spec(b);
    atmospheres.rings = (b) => bodies.ringsOf(b);
    app.sky = sky;
    app.skyMap = skyMap;
    app.atmospheres = atmospheres;
    app.blackHoles = blackHoles;
    app.holes = new BlackHoleLayer(blackHoles, bodies.surfaceExposure, renderer.depthMode === 'reversed-z');
    app.jets = new JetsLayer(blackHoles);
    app.galaxy = new GalaxyGlow();
    app.procStars = new ProceduralStarLayer(starField.psf, starField.colorLut, lean);
    app.exo = new ExoPlanetLayer(starField.psf, bodies.surfaceExposure);
    app.exo.gl = renderer.gl;
    app.tiles = new TileDetail(`${DATA}/tiles`, lean);
    app.rocks = new Rocks(app.terrain, lean);
    app.terrain.source = bodies.terrainSource;
    app.cometTails = new CometTails(bodies.surfaceExposure);
    app.craft = new SpacecraftLayer(craft, bodies.surfaceExposure, starField.psf);
    // M87's light is centred on its black hole
    const m87 = galaxyList.find((g) => g.name === 'M87'), m87bh = blackHoles.find((b) => b.name === 'M87*');
    if (m87 && m87bh) m87.upos.copy(m87bh.upos);
    app.galaxies = new GalaxiesLayer(galaxyList, starField.psf, lean);
    app.deepSky = new DeepSkyLayer(dso, starField.psf, starField.colorLut, lean);
    // [catalog] real objects to search and visit; picked ones join the layers above
    app.objCatalog = new Catalog(`${DATA}/catalog`, {
      addBlackHole: (d) => { const b = new BlackHole(app.blackHoles.length, d); app.blackHoles.push(b); return b; },
      addGalaxy: (d, make) => { const g = make(d, app.galaxies.galaxies.length); app.galaxies.add(g); return g; },
      addDeepSky: (d, make) => { const o = make(d, app.deepSky.objects.length); app.deepSky.add(o, starField.psf, starField.colorLut, lean); return o; },
      existing: (names) => app.catalogExisting(names),
    });
    app.objCatalog.onUpdate = () => { app.hud.refreshSearch(); if (app.vr) app.vr.menu.panel.dirty = true; };
    if (new URLSearchParams(location.search).get('procedural') === '0') app.procStars.enabled = false;
    const mw = new URLSearchParams(location.search).get('mw');
    if (mw !== null) sky.brightness = Number(mw);
    renderer.scene.add(sky.mesh, bodies.group, atmospheres.group, orbits.group, small.group, near.group, app.holes.group, app.jets.group, app.procStars.group, app.exo.group, app.terrain.group, app.rocks.group, app.mwVolume.mesh, app.cometTails.group, app.craft.group, app.galaxies.group, app.deepSky.group, ...starFields.map((f) => f.group));
    small.build(smallData);
    app.lean = lean;
    app.vr = new VRSupport(app, xrCapable, DATA);
    app.game = new Game(app);
    app.game.flight.setAtmospheres(atmoData);
    app.walk = new Walk(app); // walking hook
    app.free = new FreeFly(app);
    app.awe = new Awe(app);
    setUploadRenderer(renderer.gl);
    bodies.uploader = (t) => { void uploadTexture(t); };
    app.warmupPending = true;
    app.resize(); // (first: how far back the camera starts depends on the view's shape)
    app.applyUrl();
    // (a link to a scene, after the '#': it overrides what the query asked for)
    await app.openFragment(linkFragment());
    // (another link opened into this tab while it is open changes only the '#': it is opened in place, checked first, so
    // that one which cannot be opened leaves the scene here as it was)
    onFragmentChange((f) => { if (f) void app.openFragment(f); });
    app.showSaves();
    app.bindKeys();
    window.addEventListener('resize', () => app.resize());
    return app;
  }

  /**
   * The first view, ready to be looked at: the Milky Way's map, the maps of the world the view
   * starts at, the shaders compiled, and the stars of the sky around (all but the faintest) in.
   * The frames must be running already (start()): they are what asks for all of this. Each piece
   * is waited for FIRST_VIEW_WAIT at most: on a slow line the explorer starts with the rest
   * still arriving, as it always could.
   */
  async firstView(progress: LoadProgress): Promise<void> {
    const started = performance.now();
    const late = () => performance.now() - started > FIRST_VIEW_WAIT;
    /** wait for `frames` more frames to be drawn (or for time to be up) */
    const drawn = (frames: number) => new Promise<void>((resolve) => {
      const until = this.frameCount + frames;
      const poll = () => (this.frameCount >= until || late() ? resolve() : void setTimeout(poll, 30));
      poll();
    });
    const givenUp = new Promise<null>((resolve) => setTimeout(resolve, FIRST_VIEW_WAIT, null));

    const shaders = progress.run('shaders', Promise.race([this.warmed, givenUp]),
      () => count(this.renderer.gl.info.programs?.length ?? 0, 'shader'));

    // the maps of the world in view (and whatever else the first frames ask for)
    const at = this.rig.target instanceof Body && this.bodies.textureKey(this.rig.target) ? this.rig.target : null;
    if (at) progress.begin('world', `Maps of ${at.name}`);
    const world = progress.run('world', async () => {
      const before = UPLOADS.maps;
      await drawn(3);
      for (let quiet = 0; quiet < 3 && !late();) {
        quiet = UPLOADS.idle ? quiet + 1 : 0;
        await drawn(1);
      }
      return UPLOADS.maps - before;
    }, (maps) => (UPLOADS.loading > 0 ? `${count(maps, 'map')}, ${UPLOADS.loading} more on the way` : maps ? count(maps, 'map') : ''));

    // the stars the sky here is made of: the catalogue's regions arrive brightest first
    const field = progress.run('field', async () => {
      const waiting = () => this.catalogs.reduce((n, c) => n + c.pending, 0);
      const loaded = () => this.catalogs.reduce((n, c) => n + c.loadedStars, 0);
      await drawn(3);
      let most = 0;
      for (let quiet = 0; quiet < 3 && !late();) {
        const w = waiting();
        most = Math.max(most, w);
        const share = most > 0 ? 1 - w / most : 1;
        quiet = share >= ENOUGH_STARS ? quiet + 1 : 0;
        if (most > 0) progress.advance('field', share / ENOUGH_STARS, count(loaded(), 'star'));
        await drawn(1);
      }
      return loaded();
    }, (n) => count(n, 'star'));

    await Promise.all([Promise.race([this.skyMap, givenUp]), shaders, world, field]);
    // (the frames drawn while all that arrived were slow for reasons that are over now)
    this.renderer.resetQuality();
  }

  /** What can wait until the explorer is on the screen: the close-up ground, the lists' pictures. */
  afterStart(): void {
    // scanned ground materials for close-up surfaces
    void loadMaterials(DATA, this.lean, (t) => { void uploadTexture(t); }).catch((e) => console.warn('materials', e));
    // photographs of the worlds for the lists (the lists show plain discs until they arrive)
    void fetch(`${DATA}/textures/thumbs.json`).then((r) => r.json())
      .then((t: { cols: number; rows: number; bodies: Record<string, [number, number]> }) => this.hud.setThumbs({ url: `${DATA}/textures/thumbs.jpg`, ...t }))
      .catch((e) => console.warn('thumbnails', e));
  }

  // ------------------------------------------------------------------ setup
  private resize(): void {
    const c = this.renderer.canvas;
    this.cssW = c.clientWidth || window.innerWidth;
    this.cssH = c.clientHeight || window.innerHeight;
    this.rig.viewport.width = this.cssW;
    this.rig.viewport.height = this.cssH;
    // what the camera is aimed at sits in the room the interface leaves (an upright phone: above the card)
    this.rig.aim = this.hud.subjectLift() * this.rig.pixelAngle;
    this.renderer.setSize(this.cssW, this.cssH, canvasRatio(window.devicePixelRatio || 1, this.cssW, this.cssH));
  }

  private applyUrl(): void {
    const q = new URLSearchParams(location.search);
    const t = q.get('time');
    if (t) {
      const d = new Date(t);
      if (!Number.isNaN(d.getTime())) this.clock.jdTdb = utcToTdb(dateToJdUtc(d));
    }
    if (q.get('rate')) this.clock.rate = Number(q.get('rate'));
    if (q.get('paused') === '1') this.clock.paused = true;
    if (q.get('fov')) this.rig.fov = Number(q.get('fov'));
    if (q.get('starlimit')) this.starMagLimit = Number(q.get('starlimit'));
    if (q.get('belt')) this.small.boost = Number(q.get('belt'));
    this.system.update(this.clock.jdTdb);
    const camPc = q.get('campc');
    const target = q.get('target');
    const look = q.get('look');
    if (camPc) {
      const [x, y, z] = camPc.split(',').map(Number);
      this.rig.upos.set(x * PC, y * PC, z * PC);
      this.rig.lookAt(new Vector3(-x, -y, -z).normalize());
    } else if (target) {
      const place = (obj: SpaceObject) => {
        const dist = Number(q.get('dist') ?? 4) * Math.max(obj.radius, 1);
        this.placeNear(obj, dist, Number(q.get('az') ?? 35), Number(q.get('el') ?? 15));
        if (obj instanceof Galaxy && !q.get('el')) {
          const dir = obj.viewDir(this.rig.upos.sub(obj.upos, new Vector3()));
          this.rig.upos.copy(obj.upos).addVec(dir, dist);
          this.rig.lookAt(dir.clone().negate(), obj.major);
        }
        if (obj instanceof BlackHole && !q.get('el')) {
          // the view the autopilot arrives at: just above the disk plane
          const dir = obj.approachDir(this.rig.upos.sub(obj.upos, new Vector3()));
          this.rig.upos.copy(obj.upos).addVec(dir, dist);
          this.rig.lookAt(dir.clone().negate(), obj.diskNormal);
        }
        this.select(obj);
      };
      const obj = this.findByName(target);
      if (obj) place(obj);
      // [catalog] objects only the catalogue has (?target=3C 273): its best exact match
      else void this.objCatalog?.lookup(target).then((o) => { if (o) place(o); });
    } else {
      const earth = this.system.byId.get(399)!;
      this.placeNear(earth, 3.4 * earth.radius * this.rig.framing, 35, 12);
      this.select(earth);
    }
    if (look) {
      const obj = this.findByName(look);
      if (obj) this.rig.lookAt(obj.upos.sub(this.rig.upos, new Vector3()).normalize());
    }
    const ship = q.get('ship');
    if (ship === 'cockpit' || ship === 'chase') this.game.setMode(ship);
  }

  /** Put the camera at `dist` from `obj`, `az` degrees around from the sunward direction, looking at it. */
  placeNear(obj: SpaceObject, dist: number, az = 35, el = 15): void {
    // (put here, it stays here: a glide to the frame of a hit or a watch still under way would carry it off, and
    // the share suite caught one doing that, the camera left 11 AU from the Moon it had just been put by)
    this.glide = null;
    this.frameAsked = null;
    // lit side: towards the Sun, or towards its own star for a planet of another star
    const light = obj instanceof ExoPlanet ? obj.system.host.upos : this.system.sun.upos;
    const sunDir = light.sub(obj.upos, new Vector3());
    if (sunDir.lengthSq() < 1) sunDir.set(1, 0, 0);
    sunDir.normalize();
    const north = new Vector3(0, 0, 1);
    const axis = new Vector3().crossVectors(sunDir, north).normalize();
    const dir = sunDir.clone().applyAxisAngle(north, (az * Math.PI) / 180).applyAxisAngle(axis, (el * Math.PI) / 180);
    this.rig.upos.copy(obj.upos).addVec(dir, dist);
    this.rig.lookAt(dir.clone().negate(), north);
    this.rig.target = obj;
    this.rig.setAnchor(this.anchorFor(obj));
  }

  /** What the camera rides with when it is at `obj`: what moves (a body, a comet, a planet of another star, a spacecraft, a hole's companion), else nothing. */
  private anchorFor(obj: SpaceObject): SpaceObject | null {
    return obj instanceof Body || obj instanceof Comet || obj instanceof ExoPlanet || obj instanceof Spacecraft || this.isCompanion(obj) ? obj : null;
  }

  // ------------------------------------------------------------------ links to a scene (src/app/SceneLink.ts)
  /** Something as a link names it: its name, and its number if it is a body of the Solar System. */
  private nameOf(obj: SpaceObject): Named {
    return { name: obj.name, id: obj instanceof Body ? obj.id : null };
  }

  /**
   * The camera's rotation without the tilt that puts what it looks at above the card on an upright
   * phone (`rig.aim`): which way it looks, the same on any screen.
   */
  private pureTurn(): Quaternion {
    return this.rig.quat.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this.rig.aim));
  }

  /**
   * The scene as it is now, for a link or a save: what is selected, the camera from what it is at,
   * the date and the rate of time, and once live physics is on the changed universe
   * (src/app/SceneWorld.ts). Writing that down starts the simulation again from what was written
   * (LivePhysics.rebase: as after any change, the next step is planned afresh), so the scene goes on
   * here exactly as it will where the link is opened.
   */
  sceneView(): SceneView {
    let world: string | null = null;
    const w = this.solar.world();
    if (w) {
      // (what a world of a generated look is drawn from is kept with it: the simulation does not know it)
      for (const m of w.made) {
        const as = this.system.byId.get(m.id)?.meta.madeAs as BodyJson['madeAs'];
        m.seed = as?.seed ?? 0;
        if (as?.rings) m.rings = true;
        if (as?.hue) m.hue = as.hue;
      }
      const bytes = encodeWorld(w);
      this.solar.rebase(decodeWorld(bytes));
      world = toBase64Url(bytes);
    }
    const at = this.rig.target, q = this.pureTurn(), sel = this.selection;
    const cam = at ? this.rig.upos.sub(at.upos, new Vector3()) : new Vector3(this.rig.upos.xh + this.rig.upos.xl, this.rig.upos.yh + this.rig.upos.yl, this.rig.upos.zh + this.rig.upos.zl);
    return {
      selected: sel ? this.nameOf(sel) : null, at: at ? this.nameOf(at) : null,
      camera: [cam.x, cam.y, cam.z], turn: [q.x, q.y, q.z, q.w], fov: this.rig.fov,
      jd: this.clock.jdTdb, rate: this.clock.rate, paused: this.clock.paused, world,
    };
  }

  /** The link to the scene as it is now. */
  sceneLink(): string {
    return pageLink(encodeLink(this.sceneView()));
  }

  /** What a scene is, in a few words, for the share sheet and the list of saves: "Moon, 2 Oct 2026". */
  private sceneWords(short = false): string {
    const sel = this.selection, day = dayWords(this.clock.jdTdb, short);
    return sel ? `${sel.name}, ${day}` : day;
  }

  /** Share: the link to the scene, by the system's share sheet on a phone, copied at a desk. */
  async share(): Promise<void> {
    const url = this.sceneLink();
    const how = await handOn({ url, title: PRODUCT_NAME, text: `${this.sceneWords()}, in ${PRODUCT_NAME}${this.solar.on ? ' (changed with live physics)' : ''}` }, this.input.touch || this.hud.touchFirst);
    const kept = this.notKept();
    if (how === 'copied') this.hud.toast(`Link copied${kept}`, kept ? 4 : undefined);
    else if (how === 'shared') this.hud.toast(`Shared${kept}`, kept ? 4 : undefined);
    else if (how === 'failed') this.hud.toast('The link could not be shared here');
  }

  /** A changed planetary system of another star is not written in a link or a save yet: said, not hidden (the end of Share's and Save's words). */
  private notKept(): string {
    return this.physics !== this.solar && this.physics.on ? `. The changes round ${this.physics.system.sun.name} are not in it yet` : '';
  }

  /** More, Save this scene: kept on this device, in the list under it. */
  saveScene(): void {
    const name = `${this.sceneWords(true)}${this.solar.on ? ', changed' : ''}`;
    const how = saveScene(name, encodeLink(this.sceneView()), this.solar.on);
    const kept = this.notKept();
    if (how === 'kept') this.hud.toast(`Saved: ${name}${kept}`, kept ? 4 : undefined);
    else if (how === 'too many') this.hud.toast(`${SAVES_MOST} scenes are saved already: delete one to save another`, 4);
    else if (how === 'full') this.hud.toast("Not saved: this browser's storage for the app is full. Deleting a saved scene makes room", 5);
    else this.hud.toast('Not saved: this browser keeps nothing for the app (private browsing?). Share the link instead', 5);
    this.showSaves();
  }

  /** The list of saved scenes, as More shows it. */
  showSaves(): void {
    this.hud.setSaves(savedScenes().map((s) => ({ id: s.id, name: s.name, detail: `Saved ${dayWords(utcToTdb(dateToJdUtc(new Date(s.saved))), true)}, ${new Date(s.saved).toISOString().slice(11, 16)} UTC${s.live ? ' · live physics' : ''}` })));
  }

  /** A saved scene opened, in place of the scene as it is (a changed universe is let go first, as by Back to reality, unwatched and not to be undone). */
  async openSave(id: string): Promise<void> {
    const fragment = savedFragment(id);
    if (fragment === null) { this.hud.toast('That scene is not kept any more'); this.showSaves(); return; }
    this.hud.closeSheet();
    await this.openScene(fragment, 'save');
  }

  /** A saved scene forgotten. */
  deleteSave(id: string): void {
    deleteScene(id);
    this.showSaves();
  }

  /** Something a link names, found: a body by its number, else anything by its name (the catalogue of real objects last; null if nothing). */
  private async find(n: Named): Promise<SpaceObject | null> {
    const b = n.id !== null ? this.system.byId.get(n.id) : undefined;
    if (b && b.name === n.name) return b.valid ? b : null;
    const found = this.findByName(n.name);
    if (found) return found instanceof Body && !found.valid ? null : found;
    const cat = this.objCatalog;
    if (!cat) return null;
    // (an object only the catalogue has: its best exact match, if it comes in time)
    const late = new Promise<null>((resolve) => setTimeout(resolve, LINK_LOOKUP_WAIT, null));
    return Promise.race([cat.lookup(n.name).catch(() => null), late]);
  }

  /** Open the scene a link holds (the part of the address after the '#'; '' for none), and take it off the address. */
  async openFragment(fragment: string): Promise<void> {
    if (!fragment) return;
    forgetFragment();
    await this.openScene(fragment, 'link');
  }

  /**
   * Open a scene (a link's part after the '#', from a link or a save): the date, the rate of time,
   * the camera and the selection, the changed universe if it holds one, and a short note of what it
   * is. One that is not a scene, is damaged, or holds what this app cannot make again opens nothing
   * and says so (the app as usual). The real universe stays real: only a changed universe written
   * down switches on live physics, and then exactly as it was written.
   */
  private async openScene(fragment: string, from: 'link' | 'save'): Promise<void> {
    const word = from === 'link' ? { bad: 'This link could not be opened', view: 'A shared view', scene: 'A shared scene' } : { bad: 'This saved scene could not be opened', view: 'A saved view', scene: 'A saved scene' };
    const refuse = (why: string) => this.hud.notice(`${word.bad}: ${why}. Here is ${PRODUCT_NAME} as ${from === 'link' ? 'usual' : 'it was'}.`);
    const d = decodeLink(fragment);
    if (!d.ok) { refuse(d.why); return; }
    const v = d.view;
    let world: LiveWorld | null = null;
    if (v.world) {
      const bytes = fromBase64Url(v.world);
      try {
        world = decodeWorld(bytes ?? bad('its changed universe could not be read'));
      } catch (e) {
        refuse(e instanceof WorldError ? e.message : 'its changed universe could not be read');
        return;
      }
      if (Math.abs(world.jd0 + world.sim.time / DAY - v.jd) * DAY > 1) { refuse('its date and its changed universe do not agree'); return; }
      // (all of it checked against the catalogue before the universe here is let go for it: one that cannot be made
      // again leaves the scene as it was)
      try {
        this.solar.checkWorld(world);
      } catch (e) {
        refuse(e instanceof WorldError ? e.message : 'its changed universe could not be made again');
        return;
      }
      // (the ephemeris of both dates: where the changes began, and where what rides on the simulation is now)
      await Promise.all([this.system.ephemeris.request(world.jd0), this.system.ephemeris.request(world.jd0 + world.sim.time / DAY)]);
    }
    if (this.physics.on) this.leaveChanges();
    // (a changed universe written down is the Solar System's)
    if (world) this.useLive(this.solar);
    if (world) {
      try {
        this.solar.adoptWorld(world, (m) => this.madeJson(m));
      } catch (e) {
        refuse(e instanceof WorldError ? e.message : 'its changed universe could not be made again');
        return;
      }
      for (const m of world.made) this.madeEver = Math.max(this.madeEver, m.id - MADE_FIRST_ID + 1);
      // (Back to reality goes to where the changes began, at real time)
      this.begun = { jd: world.jd0, rate: { index: 0, sign: 1, rate: 1, paused: false }, present: false };
      this.trails.clear();
      this.bodies.changed();
    }
    const jd = this.solar.live ? liveDate(this.solar.live) : v.jd;
    const [at, selected] = await Promise.all([v.at ? this.find(v.at) : null, v.selected ? this.find(v.selected) : null]);
    const missing = [v.at && !at ? v.at.name : null, v.selected && !selected && v.selected.name !== v.at?.name ? v.selected.name : null].filter((x): x is string => !!x);
    this.clock.jdTdb = jd;
    this.setRate(v.rate);
    this.clock.paused = v.paused;
    this.system.update(jd);
    this.solar.place(jd);
    // (a planet of another star moves with its system, which a frame brings to the date only for the systems in view, and
    // `find` brought this one to the date before the link's: it is where the link's date puts it before the camera is set from it)
    for (const o of [at, selected]) if (o instanceof ExoPlanet) o.system.update(jd);
    // (let go of what the camera rode with until now: it has moved with the date, and the camera must not follow it there;
    // nor ease on to a frame it was gliding to, of a hit or a watch: the link's camera is where it is)
    this.rig.cancelGoto();
    this.rig.setAnchor(null);
    this.glide = null;
    this.frameAsked = null;
    if (v.at && !at) {
      // (what the camera was at is not here: the view of what was selected, or of the Earth, as a plain link has it)
      const to = selected ?? this.system.byId.get(399)!;
      this.placeNear(to, 3.4 * Math.max(to.radius, 1) * this.rig.framing, 35, 12);
    } else {
      if (at) this.rig.upos.copy(at.upos).addXYZ(v.camera[0], v.camera[1], v.camera[2]);
      else this.rig.upos.set(v.camera[0], v.camera[1], v.camera[2]);
      this.rig.target = at;
      this.rig.setAnchor(at ? this.anchorFor(at) : null);
      this.rig.quat.set(v.turn[0], v.turn[1], v.turn[2], v.turn[3]).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -this.rig.aim));
      this.rig.fov = v.fov;
    }
    this.select(selected);
    const when = `${dayWords(jd)}, ${isoOf(jd).slice(11, 16)} UTC`;
    const time = v.paused ? 'time paused' : v.rate === 1 ? 'time running' : `time at ${rateWords(v.rate)}${v.rate < 0 ? ', backwards' : ''}`;
    const what = selected ? the(selected.name) : at ? the(at.name) : 'open space';
    const lost = missing.length ? ` ${listed(missing.map((m) => `"${m}"`))} could not be found here.` : '';
    const changed = world ? ` Changed with live physics since ${dayWords(world.jd0)}.` : '';
    this.hud.notice(`${world ? word.scene : word.view}: ${what}, ${when}, ${time}.${changed}${lost}`);
  }

  /** A made world described again from a link or a save (src/app/WhatIf.ts: madeAgain): its look from what it is a copy of. */
  private madeJson(m: MadeRecord): BodyJson {
    const like = isCopyKind(m.kind) ? this.system.byId.get(TWIN_OF[m.kind]) ?? null : null;
    return madeAgain(m, this.system.byId.get(m.home)!, like, like ? this.bodies.textureKey(like) : null, isWorldKind(m.kind) ? this.lookOf(m.kind, m.seed ?? 0, m.hue ?? 0) : null);
  }

  /**
   * The changed universe let go, before a saved scene is opened in its place: as Back to reality,
   * but not watched, not told, and not to be undone (the save is the way back to it).
   */
  private leaveChanges(): void {
    this.mover.stop();
    this.run.end();
    this.pending = null;
    this.placement = null;
    this.watch.clear();
    this.glide = null;
    this.replayFrom = null;
    this.history.clear();
    this.physics.backToReality(this.clock);
    this.drawExo(this.clock.jdTdb);
    this.trails.clear();
    this.forgetHits();
    this.bodies.changed();
    this.begun = null;
    this.realAgain = 0;
  }

  /** Time at `rate` (simulated seconds a second): the steps of Faster and Slower carry on from the one at or below it. */
  private setRate(rate: number): void {
    const most = this.physics.on ? LIVE_RATE : RATE_STEPS[RATE_STEPS.length - 1];
    const r = Math.min(Math.abs(rate), most);
    this.rateSign = rate < 0 ? -1 : 1;
    this.rateIndex = 0;
    while (this.rateIndex + 1 < RATE_STEPS.length && RATE_STEPS[this.rateIndex + 1] <= r) this.rateIndex++;
    if (r >= LIVE_RATE) this.rateIndex = RATE_STEPS.length;
    this.clock.rate = this.rateSign * r;
  }

  /** true for the companion star of a black hole (it moves on its orbit). */
  isCompanion(obj: SpaceObject | null): boolean {
    return !!obj && this.blackHoles.some((b) => b.companion === obj);
  }

  private bindKeys(): void {
    // (a finger on the view, or the wheel, takes the camera back from a watch at once: time keeps the watch's pace)
    this.input.onDown = () => { this.glide = null; this.frameAsked = null; };
    this.input.grab = (x, y, touch, t) => this.mover.grab(x, y, touch, t);
    this.input.onTap = (x, y, touch) => {
      if (!touch && this.walk.onClick()) return; // walking: the click grabs the mouse
      if (touch && this.photoMode) { this.act('photo'); return; } // a tap brings the controls back
      this.select(this.pickAt(x, y, touch));
    };
    this.input.onDoubleTap = (x, y, touch) => {
      const hit = this.pickAt(x, y, touch);
      if (!hit) return;
      this.select(hit);
      // already there: come closer to the place that was tapped (as on a map); else fly there
      if (hit === this.rig.target && !this.rig.autopilot) this.rig.zoomToward({ x, y }, -Math.log(DOUBLE_TAP_ZOOM));
      else this.goTo(hit);
    };
    this.input.onKey = (e) => {
      if (this.game?.active) this.game.audio.start();
      if (this.walk.onKey(e)) return; // walking: B, Space jumps, ...
      switch (e.code) {
        case 'Space': this.act('pause'); e.preventDefault(); break;
        case 'BracketRight': this.act('faster'); break;
        case 'BracketLeft': this.act('slower'); break;
        case 'Backslash': this.act('reverse'); break;
        case 'Backspace': this.act('now'); e.preventDefault(); break;
        case 'KeyG': this.act('go'); break;
        case 'KeyC': this.act('centre'); break;
        case 'KeyL': this.act('labels'); break;
        case 'KeyU': this.act('photo'); break;
        case 'KeyO': this.act('orbits'); break;
        case 'KeyM': this.act('minor'); break;
        case 'KeyH': case 'F1': this.hud.toggleHelp(); e.preventDefault(); break;
        case 'KeyP': this.act('screenshot'); break;
        case 'Enter': case 'Slash': this.hud.openSearch(); e.preventDefault(); break;
        case 'KeyT': this.hud.openExplore('tour'); e.preventDefault(); break;
        case 'Equal': case 'NumpadAdd': if (this.game.flight.on) this.game.flight.stepDrive(true); else this.rig.speedFactor *= 2; break;
        case 'Minus': case 'NumpadSubtract': if (this.game.flight.on) this.game.flight.stepDrive(false); else this.rig.speedFactor /= 2; break;
        case 'Escape': this.cancelOrDeselect(); break;
        case 'KeyV': this.game.cycle(); break;
        case 'KeyJ': this.game.autopilot(); break;
        case 'KeyN': this.game.audio.setEnabled(!this.game.audio.enabled); this.hud.toast(`Sound ${this.game.audio.enabled ? 'on' : 'off'}`); break;
        case 'KeyK': this.showMissions(); break;
        case 'Comma': this.hud.toast(this.awe.toggleEarth()); break;
        case 'KeyY': if (this.game.flight.on) this.game.flight.cycleSas(e.shiftKey); break;
        case 'KeyZ': if ((e.ctrlKey || e.metaKey) && !this.game.flight.on) { this.undo(); e.preventDefault(); } break;
        case 'KeyI': if (this.game.flight.on) this.game.flight.toggleDrive(); break;
        default:
          if (/^Digit\d$/.test(e.code)) {
            const ids = [10, 199, 299, 399, 499, 599, 699, 799, 899, 999];
            const b = this.system.byId.get(ids[Number(e.code.slice(5))]);
            if (b) { this.select(b); this.goTo(b); }
          }
      }
    };
  }

  // ------------------------------------------------------------------ the interface's requests (HudHost)
  /** What a button of the interface, or the key that stands for it, does. */
  act(action: HudAction): void {
    switch (action) {
      case 'go': if (this.selection) this.goTo(this.selection); break;
      case 'centre': if (this.selection) this.center(this.selection); break;
      // (on a phone the ship opens in the chase view: HANDOFF, "The ship's looks")
      case 'ship': this.game.setMode(this.game.active ? 'off' : this.input.touch ? 'chase' : 'cockpit'); break;
      case 'pilot-controls': this.game.setPilotControls(!this.game.pilotControls); break;
      // the place chip: look at where the camera is; in open space, choose somewhere to go
      case 'home': if (this.rig.target) this.center(this.rig.target); else this.hud.openExplore(); break;
      case 'deselect': this.select(null); break;
      case 'add-moon': this.add('moon'); break;
      case 'add-earth': this.add('earth'); break;
      case 'add-jupiter': this.add('jupiter'); break;
      case 'add-sun': this.add('sun'); break;
      case 'add-terran': this.add('terran'); break;
      case 'add-ocean': this.add('ocean'); break;
      case 'add-desert': this.add('desert'); break;
      case 'add-lava': this.add('lava'); break;
      case 'add-ice': this.add('ice'); break;
      case 'add-giant': this.add('giant'); break;
      case 'add-icegiant': this.add('icegiant'); break;
      case 'new-look': this.newLook(); break;
      case 'rings': this.toggleRings(); break;
      case 'remove': {
        if (this.selection instanceof Comet) { if (this.powersOf(this.selection).remove.works) this.removeComet(this.selection); break; }
        const b = this.powerBody(); if (b && this.powersOf(this.selection!).remove.works) this.removeBody(b);
        break;
      }
      case 'move': { const b = this.powerBody(); this.mover.toggle(b && this.powersOf(this.selection!).move.works ? b : null); break; }
      case 'move-keep': this.mover.leave('keep'); break;
      case 'move-circle': this.mover.leave('circle'); break;
      case 'move-throw': this.mover.leave('throw'); break;
      case 'place-done': this.mover.stop(true); break;
      case 'reality': this.backToReality(); break;
      case 'undo': this.undo(); break;
      case 'watch-start': this.replay(); break;
      case 'watch-stop': this.stopWatch(); break;
      case 'replay': this.replay(); break;
      case 'watch-close': this.putRate(this.watch.clear()); break;
      case 'size-link': this.linkSize(!this.sizeFollows); break;
      case 'show-me':
        this.showMe = !this.showMe;
        remember('show-me', this.showMe ? '1' : '0');
        this.hud.toast(this.showMe ? 'After a change, the watch starts by itself: time speeds up and the view frames what it does' : 'After a change, nothing speeds up by itself: tap Watch to see what it does');
        break;
      case 'stop': this.rig.cancelGoto(); break;
      case 'pause': this.togglePause(); break;
      case 'faster': this.timeFaster(); break;
      case 'slower': this.timeSlower(); break;
      case 'reverse': this.timeReverse(); break;
      case 'now': case 'today': this.realTime(); break;
      case 'ship-go': this.shipThere(); break;
      case 'sunrise': this.skipToSunrise(); break;
      case 'walk': this.walk.start(); break;
      case 'free': this.free.toggle(); break;
      case 'menu': if (this.openMenu) { this.hud.closeSheet(); this.openMenu(); } break;
      case 'labels': this.labels.enabled = !this.labels.enabled; this.hud.toast(`Names ${this.labels.enabled ? 'on' : 'off'}`); break;
      case 'orbits': this.orbits.enabled = !this.orbits.enabled; this.hud.toast(`Orbits ${this.orbits.enabled ? 'on' : 'off'}`); break;
      case 'minor': this.orbits.showMinor = !this.orbits.showMinor; this.hud.toast(`Orbits of asteroids and comets ${this.orbits.showMinor ? 'on' : 'off'}`); break;
      case 'look':
        this.rig.touchDrag = this.rig.touchDrag === 'look' ? 'orbit' : 'look';
        this.hud.toast(this.rig.touchDrag === 'look' ? 'One finger looks around' : 'One finger turns round where you are');
        break;
      case 'photo': this.togglePhoto(); break;
      case 'screenshot': this.screenshot(); break;
      case 'share': void this.share(); break;
      case 'save': this.saveScene(); break;
    }
  }

  /** Photo mode: every control and name off (or back to how they were). */
  private togglePhoto(): void {
    this.photoMode = !this.photoMode;
    this.hud.setHidden(this.photoMode);
    if (this.photoMode) { this.labelsBeforePhoto = this.labels.enabled; this.labels.enabled = false; } else this.labels.enabled = this.labelsBeforePhoto;
    const leave = this.input.touch ? 'tap to leave' : 'U to leave, P to save a PNG';
    this.hud.toast(this.photoMode ? `Photo mode (${leave})` : 'Photo mode off', 1.8);
  }

  /** The places of a section of the Explore sheet, described from where the camera is. */
  browse(category: Category): Destination[] {
    if (category === 'tour') {
      // (an event is pictured by the world it happens on)
      const world: Record<string, string> = { 'tour:walk17': 'Moon', 'tour:shadow': 'Jupiter', 'tour:eclipse': 'Moon', 'tour:proxima': 'Proxima Cen b' };
      return this.tourItems().map((t) => {
        if (t.id === 'tour:comet') return { ...t, picture: { shape: 'comet', tint: [0.62, 0.92, 1] } };
        const o = world[t.id] ? this.findByName(world[t.id]) : this.resolveSearchId(t.id);
        return { ...t, picture: o ? pictureOf(o) : undefined };
      });
    }
    this.offered.clear();
    return objectsOf(this, category).filter((o) => !(o instanceof Body && this.system.isGone(o))).map((o) => {
      this.offered.set(o.key, o);
      return { label: o.name, detail: describe(this, o), id: `obj:${o.key}`, picture: pictureOf(o) };
    });
  }
  /** the objects of the list last shown, by key */
  private offered = new Map<string, SpaceObject>();

  /** A place was chosen from a list: select it and go. */
  pickDestination(id: string, from?: string): void {
    if (id.startsWith('tour:')) { this.tourAction(id.slice(5)); return; }
    const obj = this.resolveSearchId(id);
    // (a place to look at, picked from the tour: arrived at in daylight)
    if (from === 'tour' && obj instanceof Landmark) this.toDaylight(obj);
    if (obj) { this.select(obj); this.goTo(obj); }
  }

  // ------------------------------------------------------------------ actions
  togglePause(): void {
    this.takeTime();
    this.clock.paused = !this.clock.paused;
  }
  /** the rate of step `i` (one past the list's end: live physics' own) */
  private rateAt(i: number): number {
    return this.rateSign * (RATE_STEPS[i] ?? LIVE_RATE);
  }
  /**
   * The explorer reaches for time while a change is being watched: the watch's pace becomes theirs
   * to go on from (its step is the one at or below it) and the watch ends, nothing put back. True
   * if that pace lies between two steps: the step below it is already slower.
   */
  private takeTime(): boolean {
    // (a world being put in place leaves time as the explorer sets it now)
    if (this.placement) this.placement.paused = null;
    if (!this.watch.watching) return false;
    const rate = this.watch.rate;
    this.rateSign = 1;
    this.rateIndex = 0;
    while (this.rateIndex + 1 < RATE_STEPS.length && RATE_STEPS[this.rateIndex + 1] <= rate) this.rateIndex++;
    this.watch.yieldRate();
    return rate > RATE_STEPS[this.rateIndex] * 1.0001;
  }
  timeFaster(): void {
    if (this.game.flight.on) { this.shipWarp(1); return; }
    this.takeTime();
    this.rateIndex = Math.min(RATE_STEPS.length - (this.physics.on ? 0 : 1), this.rateIndex + 1);
    this.clock.rate = this.rateAt(this.rateIndex);
    this.clock.paused = false;
  }
  timeSlower(): void {
    if (this.game.flight.on) { this.shipWarp(-1); return; }
    if (!this.takeTime()) this.rateIndex = Math.max(0, this.rateIndex - 1);
    this.clock.rate = this.rateAt(this.rateIndex);
  }
  timeReverse(): void {
    // (the ship's clock only runs forwards: its physics would not undo itself)
    if (this.game.flight.on) { this.hud.toast('Time cannot run backwards aboard the ship'); return; }
    this.takeTime();
    this.rateSign *= -1;
    this.clock.rate = this.rateAt(this.rateIndex);
    // (a simulation run backwards undoes what its gravity did; two bodies that became one stay one)
    this.hud.toast(this.rateSign > 0 ? 'Time forward' : this.physics.on ? 'Time reversed: what has merged stays merged' : 'Time reversed');
  }
  /** Boarding the ship: time runs, at 1x (the date is kept). */
  flightClock(): void {
    // (the ship keeps its own time: a watch under way ends)
    this.watch.clear();
    this.glide = null;
    if (this.clock.paused || this.clock.rate !== 1) {
      this.rateIndex = 0;
      this.rateSign = 1;
      this.clock.rate = 1;
      this.clock.paused = false;
    }
  }
  /**
   * In the ship the warp is its own clock's, in steps of ten from ×1 to ×100,000 (src/game/Flight.ts,
   * WARP_STEPS): the step above or below the rate it runs at.
   */
  private shipWarp(dir: 1 | -1): void {
    const r = Math.min(Math.abs(this.clock.rate), MAX_RATE);
    let next = dir > 0 ? WARP_STEPS[WARP_STEPS.length - 1] : WARP_STEPS[0];
    for (const w of dir > 0 ? WARP_STEPS : [...WARP_STEPS].reverse()) if (dir > 0 ? w > r * 1.0001 : w < r / 1.0001) { next = w; break; }
    this.rateSign = 1;
    this.clock.rate = next;
    if (dir > 0) this.clock.paused = false;
    // (the explorer's steps carry on from about here after the ship)
    this.rateIndex = 0;
    while (this.rateIndex + 1 < RATE_STEPS.length && RATE_STEPS[this.rateIndex + 1] <= next) this.rateIndex++;
  }
  /** a flight to a place on a surface under way: on arrival, night there is told */
  private arrival: Landmark | null = null;
  /** the place whose sunrise the notice offers */
  private nightAt: Landmark | null = null;

  /**
   * Night at a place on a world: the Sun's disc below its horizon. The words for it (with the
   * time to sunrise, or that the Sun does not rise there for now) and the seconds to the Sun
   * standing `height` over the horizon (null: not soon).
   */
  night(place: Landmark, height = -0.0145): { text: string; t: number | null } | null {
    const w = place.world, sun = this.system.sunAt(w.pos);
    if (!sun || sun === w) return null;
    const sunDir = sun.upos.sub(w.upos, new Vector3()).normalize(), up = place.up();
    if (sunHeight(up, sunDir) > -0.0145) return null;
    const spin = spinOf(w, new Vector3()), drift = orbitDrift(w.upos.sub(sun.upos, new Vector3()), w.vel.clone().sub(sun.vel));
    const rise = sunriseIn(up, sunDir, spin, drift, -0.0145);
    const t = height === -0.0145 ? rise : sunriseIn(up, sunDir, spin, drift, height);
    const text = rise === null ? `Night at ${place.name}: the Sun does not rise here for now` : `Night at ${place.name}: sunrise in ${fmtTime(rise)}`;
    return { text, t };
  }

  /** Arrived at a place on a surface: if it is night there, a notice says so (and offers its sunrise). */
  private checkArrival(): void {
    const place = this.arrival;
    if (!place || this.rig.autopilot) return;
    this.arrival = null;
    if (this.rig.target !== place) return;
    const n = this.night(place);
    if (!n) return;
    this.nightAt = place;
    // (the date is the explorer's to move: not in live physics, nor aboard the ship)
    const can = n.t !== null && !this.physics.on && !this.game.flight.on;
    this.hud.notice(n.text, can ? 'sunrise' : null, 'Skip to sunrise');
  }

  /** On to the morning at the place it is night at: the clock moves to the Sun 6° over its horizon. */
  skipToSunrise(place = this.nightAt): boolean {
    if (!place || this.physics.on || this.game.flight.on) return false;
    const n = this.night(place, (6 * Math.PI) / 180);
    if (!n || n.t === null) return false;
    this.clock.jdTdb += n.t / 86400;
    this.hud.toast(`Morning at ${place.name} (${fmtTime(n.t)} on)`, 3);
    return true;
  }

  /** the title screen, opened again (src/main.ts sets it: the menu belongs to the page) */
  openMenu: (() => void) | null = null;

  /**
   * "Your ship" (or "Fly there in your ship", with something selected): board the ship, and fly to
   * the selection in it on the reactionless drive, set as strong as the trip needs (Flight.driveFor:
   * enough to steer against gravity here, and to get there within about a day aboard).
   */
  shipThere(): void {
    const sel = this.selection;
    if (!this.game.active) this.game.setMode(this.input.touch ? 'chase' : 'cockpit');
    const f = this.game.flight;
    if (!sel || !f.on) return;
    if (sel.upos.sub(this.rig.upos, new Vector3()).length() < Math.max(sel.radius * 6, 1e4)) return;
    f.driveFor(sel);
    f.autopilotTo(sel);
  }

  realTime(): void {
    // (in the ship too: back to today's date, the ship carried along with the world it was near, as
    // a jump of the explorer's would; Flight.carryToNow)
    if (this.game.flight.on) {
      this.game.flight.carryToNow(() => this.clock.setUtcNow());
      this.rateIndex = 0;
      this.rateSign = 1;
      this.clock.rate = 1;
      this.clock.paused = false;
      this.hud.toast('Back to today, real time: the ship goes along with the world it was near');
      return;
    }
    this.takeTime();
    // (in live physics the date is the simulation's: only the pace goes back to real time)
    if (!this.physics.on) this.clock.setUtcNow();
    this.rateIndex = 0;
    this.rateSign = 1;
    this.clock.rate = 1;
    this.clock.paused = false;
    this.hud.toast(this.physics.on ? 'Real time, from the date live physics has reached' : 'Real time');
  }
  /** T: a short list of places that show what the explorer can do. */
  tourItems(): { label: string; detail: string; id: string }[] {
    const lm = (n: string) => this.landmarks.findIndex((l) => l.name === n);
    const idx = (arr: { name: string }[], n: string) => arr.findIndex((o) => o.name === n);
    const items: { label: string; detail: string; id: string }[] = [
      { label: "Inside Saturn's rings", detail: 'float among the ice of the B ring', id: 'place:rings' },
      { label: 'Mount Everest', detail: 'Earth · the top of the world (real elevation data)', id: `lm:${lm('Mount Everest')}` },
      { label: 'Grand Canyon', detail: 'Earth · fly down into the canyon', id: `lm:${lm('Grand Canyon')}` },
      { label: 'Olympus Mons', detail: 'Mars · the tallest volcano known (real elevation data)', id: `lm:${lm('Olympus Mons')}` },
      { label: 'Valles Marineris', detail: 'Mars · a canyon 4,000 km long', id: `lm:${lm('Valles Marineris')}` },
      { label: 'Apollo 11 landing site', detail: 'the Moon · where people first landed', id: `lm:${lm('Apollo 11 landing site')}` },
      { label: 'Walk on the Moon at Apollo 17', detail: this.input.touch ? 'land in the Taurus-Littrow valley and walk (the stick walks, Fly takes off)' : 'land in the Taurus-Littrow valley and walk (B: walk / fly)', id: 'tour:walk17' },
      { label: 'Shackleton crater', detail: 'the Moon\'s south pole · long shadows', id: `lm:${lm('Shackleton (lunar south pole)')}` },
      { label: 'A moon\'s shadow on Jupiter', detail: 'jumps to the next shadow transit', id: 'tour:shadow' },
      { label: 'Total lunar eclipse', detail: '3 March 2026 · the Moon in Earth\'s shadow', id: 'tour:eclipse' },
      { label: 'The brightest comet now', detail: 'coma, tails and its nucleus up close', id: 'tour:comet' },
      { label: 'Proxima Cen b', detail: 'nearest exoplanet · land on it', id: 'tour:proxima' },
      { label: 'Sagittarius A*', detail: 'the black hole at the heart of the Milky Way', id: `bh:${idx(this.blackHoles.map((h) => ({ name: h.name })), 'Sagittarius A*')}` },
      { label: 'M87*', detail: 'the first black hole ever pictured (2019)', id: `bh:${idx(this.blackHoles.map((h) => ({ name: h.name })), 'M87*')}` },
      { label: 'Cygnus X-1', detail: 'a black hole pulling gas off its giant companion', id: `bh:${idx(this.blackHoles.map((h) => ({ name: h.name })), 'Cygnus X-1')}` },
      { label: 'Gaia BH1', detail: 'the nearest known black hole', id: `bh:${idx(this.blackHoles.map((h) => ({ name: h.name })), 'Gaia BH1')}` },
      { label: 'Orion Nebula', detail: 'a star-forming cloud, 1,300 light years', id: `dso:${idx(this.deepSky.objects, 'Orion Nebula')}` },
      { label: 'Andromeda Galaxy', detail: '2.5 million light years', id: `gx:${this.galaxies.galaxies.findIndex((g) => g.name.startsWith('Andromeda'))}` },
      { label: 'The Milky Way from outside', detail: 'our galaxy, 100,000 light years across', id: 'mw:0' },
    ];
    return items.filter((i) => !/:-1$/.test(i.id));
  }

  /** A tour to a place to see: if it is night there, the clock moves on to its morning first (said so). */
  private toDaylight(place: Landmark): void {
    if (this.physics.on || this.game.flight.on) return;
    const n = this.night(place, (6 * Math.PI) / 180);
    if (!n || n.t === null) return;
    this.clock.jdTdb += n.t / 86400;
    this.hud.toast(`It was night at ${place.name}: on to the morning there (${fmtTime(n.t)} later)`, 3.5);
  }

  /** Tour destinations that need more than a fly-to (a time jump, a search): desktop flies there. */
  private tourAction(what: string): void {
    if (what === 'walk17') {
      const site = this.landmarks.find((l) => l.name === 'Apollo 17 landing site')!;
      this.toDaylight(site);
      this.walk.walkAt(site);
      return;
    }

    const o = this.prepareTour(what);
    if (o) { this.select(o); this.goTo(o); }
  }

  /**
   * Set up a tour destination (jumping the clock if needed) and return what to fly to; the caller
   * flies (desktop go-to or VR travel).
   */
  prepareTour(what: string): SpaceObject | null {
    if (what === 'proxima') return this.findByName('Proxima Cen b');
    // (an eclipse or a shadow at its real date: only the real Solar System has those)
    if (what === 'eclipse' || what === 'shadow') this.backToReality();
    if (what === 'eclipse') {
      this.clock.jdTdb = utcToTdb(dateToJdUtc(new Date('2026-03-03T11:33:00Z')));
      this.clock.paused = true;
      this.hud.toast('3 March 2026, 11:33 UTC: total lunar eclipse (time paused)', 4);
      if (this.vr.active) this.vr.flash('Total lunar eclipse, 3 March 2026');
      return this.findByName('Moon');
    }
    if (what === 'shadow') {
      // the next time a Galilean moon's shadow falls on Jupiter's disk (15-minute steps, up to 4 days)
      const jup = this.findByName('Jupiter') as Body;
      const moons = ['Io', 'Europa', 'Ganymede', 'Callisto'].map((n) => this.findByName(n) as Body);
      const jd0 = this.clock.jdTdb;
      let found: { jd: number; moon: string } | null = null;
      for (let k = 0; k < 4 * 96 && !found; k++) {
        const jd = jd0 + k / 96;
        this.system.update(jd);
        const sun = this.system.sun.upos.sub(jup.upos, new Vector3()).normalize();
        for (const m of moons) {
          const v = m.upos.sub(jup.upos, new Vector3());
          const along = v.dot(sun);
          if (along > 0 && Math.sqrt(v.lengthSq() - along * along) < jup.radius * 0.8) { found = { jd, moon: m.name }; break; }
        }
      }
      this.system.update(jd0);
      if (found) {
        this.clock.jdTdb = found.jd;
        this.clock.paused = true;
        this.hud.toast(`${found.moon}'s shadow on Jupiter (time paused)`, 4);
        if (this.vr.active) this.vr.flash(`${found.moon}'s shadow on Jupiter`);
      }
      return jup;
    }
    if (what === 'comet') {
      const sun = this.system.sun.upos;
      let best: Comet | null = null, bm = Infinity;
      for (const c of this.small.cometObjects) {
        if (this.solar.away.has(c) || c.row[8] === null || !['P', 'C', 'I'].includes(c.row[1])) continue;
        const r = c.upos.sub(sun, new Vector3()).length() / AU;
        const m = c.row[8] + (c.row[9] ?? 10) * Math.log10(Math.max(r, 0.1));
        if (r < 4 && m < bm) { bm = m; best = c; }
      }
      return best;
    }
    return null;
  }

  /** K: missions and recent discoveries. */
  showMissions(): void {
    const m = this.game.missions;
    const lines = m.list.map((x) => `${x.done ? '✔' : '○'} ${x.title}`).join('\n');
    const recent = m.log.slice(0, 5).map((e) => e.name).join(', ');
    this.hud.toast(`Missions ${m.doneCount}/${m.total}\n${lines}${recent ? `\nRecently discovered: ${recent}` : ''}`, 9);
  }

  /** Escape: stop watching a change, or stop the flight, or close the open panel, or let go of the selection. */
  cancelOrDeselect(): void {
    if (this.watch.watching) this.stopWatch();
    else if (this.mover.body) this.mover.stop();
    else if (this.rig.autopilot) this.rig.cancelGoto();
    else if (this.hud.open) this.hud.closeSheet();
    else this.select(null);
  }
  /** Human-readable time rate (the clock's, unless told another). */
  /** How fast time runs, in words (the clock at the top, the ship's and the headset's panels): "3 hours a second". */
  rateText(rate = this.clock.rate): string {
    return clockChipWords(rate);
  }

  /**
   * Choose what the explorer is asking about: its name and facts are shown, and "go to" flies there.
   * The camera stays with what it is at (rig.target) until it does.
   */
  select(obj: SpaceObject | null): void {
    if (obj !== this.mover.body && (!obj || this.exoSim?.source.bodyOf(obj) !== this.mover.body)) this.mover.stop();
    this.selection = obj;
    this.orbits.selected = obj instanceof Body ? obj : null;
    if (obj instanceof CatalogStar) { obj.resolve(this.named, () => undefined); obj.gradeDistance(() => undefined); obj.describeTemperature(() => undefined); }
  }

  // ------------------------------------------------------------------ what if (src/app/WhatIf.ts)
  /**
   * The bodies the explorer has made since the system was last the real one (those taken away
   * again among them: they are gone like any world taken away, until the return to reality).
   */
  get made(): readonly Body[] {
    return this.physics.made;
  }

  // ------------------------------------------------------------------ live physics in one system at a time
  /** Where live physics runs now: round the Sun, in another star's planetary system, or nowhere. */
  private liveWhere(): 'solar' | PlanetarySystem | null {
    return this.holds(this.solar) ? 'solar' : this.exoSim && this.holds(this.exoSim.physics) ? this.exoSim.source.system : null;
  }

  /**
   * Live physics runs in `p`; or Back to reality was just used there and its Undo is still offered,
   * which another system's powers would throw away: either way it is that system's turn (one at a time).
   */
  private holds(p: LivePhysics): boolean {
    return p.on || (p === this.physics && this.realAgain > 0 && this.history.size > 0);
  }

  /** What `o` is as far as its powers go: for a star, its planetary system; and where live physics runs now (src/app/powersFor.ts). */
  private powerPlace(o: SpaceObject | null): PowerPlace {
    return { system: o instanceof CatalogStar && !this.isCompanion(o) ? this.systems.of(o) : undefined, live: this.liveWhere(), undo: !this.physics.on && this.holds(this.physics) };
  }

  /** The one table of which powers work on `o`, here and now (src/app/powersFor.ts). */
  powersOf(o: SpaceObject): PowerTable {
    return powersFor(o, this.made.length, this.powerPlace(o));
  }

  /**
   * The body the powers act on for `o` (the selection, unless told), and the live physics they go
   * through (`physics`): a world of the Solar System itself; for another star or one of its planets,
   * the body standing for it in that star's planetary system (src/universe/PlanetarySim.ts). Live
   * physics runs in one system at a time, so while it runs in one, a world of another has none
   * (powersFor says why). `fresh`: for a power about to act, the rails of a system that is not live
   * yet brought to the date. Null where no power can act.
   */
  powerBody(o: SpaceObject | null = this.selection, fresh = true): Body | null {
    if (!o) return null;
    if (o instanceof SimBody) return this.exoSim?.source.bodyOf(o.shows) === o ? o : null;
    // (a world of another system than the one whose turn it is has none: selecting it, which asks
    // here every frame, must not throw away that system's Undo)
    if (o instanceof Body) {
      if (this.exoSim && this.holds(this.exoSim.physics)) return null;
      this.useLive(this.solar);
      return o;
    }
    const system = o instanceof ExoPlanet ? o.system : o instanceof CatalogStar && !this.isCompanion(o) ? this.systems.of(o) : null;
    if (!system || this.holds(this.solar)) return null;
    let ex = this.exoSim;
    if (!ex || ex.source.system !== system) {
      if (ex && this.holds(ex.physics)) return null;
      // (made only when a power is offered for it: nothing of another star's system is simulated, or kept, before that)
      const source = new PlanetarySim(system);
      ex = this.exoSim = { source, physics: new LivePhysics(source, { left: (b, into) => this.bodyLeft(b, into), dropped: () => undefined }, PLANETARY_LEFT_OUT) };
    }
    if (!ex.source.simulable) return null;
    this.useLive(ex.physics);
    if (fresh) this.railsNow();
    return ex.source.bodyOf(o);
  }

  /** The powers go through `p` from now (it is live, or none is): what Undo kept for another system is let go with it. */
  private useLive(p: LivePhysics): void {
    if (this.physics === p) return;
    this.mover.stop();
    this.history.clear();
    this.begun = null;
    this.replayFrom = null;
    this.realAgain = 0;
    this.physics = p;
  }

  /** Another star's system that live physics has not begun in: its bodies on their rails at the clock's date, as they are drawn. */
  private railsNow(): void {
    if (this.physics !== this.solar && !this.physics.on) this.physics.system.update(this.clock.jdTdb);
  }

  /** Another star's system is drawn where its simulation has it while live physics runs it, and on its rails otherwise (each frame, and after a change of state). */
  private drawExo(jd: number): void {
    const ex = this.exoSim;
    if (!ex) return;
    if (ex.physics.on) ex.source.attach();
    else ex.source.detach(jd);
  }

  /**
   * How the mass the Mass power starts from is known, for its words: nothing to add for a measured
   * one; "(estimated)" where the archive estimated it; a star weighed by its planet's orbit, or a
   * made-up system's, says so.
   */
  private massMark(b: Body): { words: string; says: string } {
    if (!(b instanceof SimBody)) return { words: '', says: '' };
    const known = this.exoSim?.source.massKnown(b) ?? 'measured';
    if (known === 'estimated') return { words: ' (estimated)', says: 'The archive estimated its mass from its size' };
    if (known === 'least') return { words: ' (at least)', says: 'The least it can be: only its star\'s wobble was measured, not how its orbit is tilted' };
    if (known === 'orbits') return { words: ' (from its planets)', says: 'Weighed by a planet\'s orbit: the archive gives no mass' };
    if (known === 'generated') return { words: ' (generated)', says: 'A made-up system: its masses are generated' };
    return { words: '', says: '' };
  }

  /** Where a body is drawn from the eye (m) and how many pixels its radius spans, for a finger to take hold of it (src/app/Mover.ts); undefined while it is not drawn. */
  viewOf(b: Body): { rel: Vector3; pixelRadius: number } | undefined {
    if (!(b instanceof SimBody)) return this.bodies.views.get(b);
    const o = b.shows;
    if (o instanceof ExoPlanet) return this.exo.views.find((v) => v.planet === o);
    const rel = o.upos.sub(this.rig.upos, new Vector3()), d = rel.length();
    return { rel, pixelRadius: Math.asin(Math.min(1, o.radius / Math.max(d, o.radius))) / this.view.pixelAngle };
  }
  /** how many bodies were ever made: their numbers are not used twice */
  private madeEver = 0;

  /**
   * Add something to a world (the selected one, unless told which): a moon to a planet; to a star
   * a planet, or another sun. It starts between that world and the eye, is simulated from the
   * start, and is selected. Then it is put in place (src/app/Mover.ts: place): time waits, a finger
   * puts it where it is wanted and leaves it on a circle there, or flicks it, its mass can be set,
   * and Done ends its making, watched (in the ship, walking or in the headset it is left where it
   * starts). Null if that cannot be added there.
   */
  add(kind: Kind, to: SpaceObject | null = this.selection): Body | null {
    if (!(to instanceof Body) || !this.powersOf(to).add.works || !canAdd(to, this.made.length).includes(kind) || this.powerBody(to) !== to) return null;
    const eye = this.rig.upos.sub(to.upos, new Vector3()).toArray(), id = MADE_FIRST_ID + this.madeEver++;
    const like = isCopyKind(kind) ? this.system.byId.get(TWIN_OF[kind])! : null;
    const sun = this.system.sunAt(to.pos);
    const seed = newSeed(Math.random);
    const plan = like
      ? newTwin(like, this.bodies.textureKey(like), to, eye, this.made.filter((m) => m.twinOf === like).length, id)
      : isWorldKind(kind)
        ? newWorld(kind, to, eye, this.made.filter((m) => (m.meta.madeAs as BodyJson['madeAs'])?.kind === kind).length, id, seed, this.lookOf(kind, seed))
        : newMoon(to, eye, sun ? to.pos.distanceTo(sun.pos) : Infinity, this.made.filter((m) => this.system.homeOf(m) === to).length, id);
    const where = to.kind === 'star' ? `${farWords(plan.orbit)} from ${the(to.name)}` : `${formatDistance(plan.orbit - to.radius)} up`;
    this.beginChange('add', to, true, `making ${plan.json.name}`);
    const wasOn = this.physics.on;
    const made = this.physics.make(plan.json, to, plan.pos, plan.vel, this.clock.jdTdb,
      `${plan.json.name} is new: ${where}, once round in ${fmtDuration(plan.periodDays * DAY)}.`);
    this.bodies.changed();
    this.select(made);
    this.tellNews(wasOn);
    if (this.game.flight.on || this.walk.active || this.vr.active) { this.endChange(); return made; }
    this.placement = { paused: this.clock.paused, base: plan.json.madeAs?.kg ?? made.gm / G };
    this.clock.paused = true;
    this.mover.place(made);
    // (where a finger can find it: unless it is in sight already, the camera eases out until what it was given to and
    // its orbit are clear of the card)
    this.updateHud();
    const at = this.project(made.upos.sub(this.rig.upos, new Vector3())), free = this.hud.freeArea();
    if (!at || at.x < free.left || at.x > free.right || at.y < free.top || at.y > free.bottom) this.frameOn(to, FRAME_MARGIN * plan.orbit);
    return made;
  }

  /**
   * The world just made is in place (`done`: Done was tapped), or putting it in place was left
   * (another world chosen, another panel opened, Escape): time runs again as it did before it was
   * made, unless the explorer has set it since, and its making ends; it is watched only after Done.
   */
  placed(done: boolean): void {
    const p = this.placement;
    this.placement = null;
    this.portrait?.release();
    this.portraitShot = null;
    if (p && p.paused !== null) this.clock.paused = p.paused;
    if (this.pending?.kind === 'add') this.endChange(done);
  }

  /** What the generated look of a made world of `kind` and `seed` gives it: its albedo and a colour for it seen as a point (src/render/PlanetLook.ts). */
  private lookOf(kind: WorldKind, seed: number, hue = 0): MadeLook {
    const look = generatedLook(madeLook(kind, seed, madeSize(kind, WORLD_BASE[kind], false).radius, false, hue));
    return { albedo: look.albedo, color: [...(look.pal.uC2 as [number, number, number])] };
  }

  /**
   * The picture of a world being made, as it looks now, for its card (src/render/PlanetPortrait.ts): drawn again only
   * when its look changes (New look, rings, its colour), not as its mass slides; at the card's size times the screen's
   * density (three at the most).
   */
  private portraitOf(b: Body): HudPortrait | null {
    const wears = this.bodies.lookOf(b);
    if (!wears) return null;
    // (the canvas's own density, not the scene's: the governor's lower resolution does not blur the card)
    const scale = Math.min(3, Math.max(1, this.renderer.pixelRatio));
    const width = Math.round(PORTRAIT_CSS.width * scale), height = Math.round(PORTRAIT_CSS.height * scale);
    const key = `${wears.type}/${wears.seed}/${wears.rings ? 1 : 0}/${wears.hue}/${width}x${height}`;
    if (this.portraitShot?.key !== key) {
      this.portrait ??= new PlanetPortrait(this.renderer.gl, makeSphere(-180));
      this.portraitShot = { key, ...this.portrait.draw(madeLook(wears.type, wears.seed, b.radius, wears.rings, wears.hue), width, height) };
    }
    return this.portraitShot;
  }

  /** New look: the world being put in place, if it has a generated look, gets another seed (and so another look of its type). */
  newLook(): void {
    const b = this.mover.placing ? this.mover.body : null, as = b?.meta.madeAs as BodyJson['madeAs'];
    if (!b || !as || as.seed === undefined || !isWorldKind(as.kind)) return;
    as.seed = newSeed(Math.random, as.seed);
    const look = this.lookOf(as.kind, as.seed, as.hue ?? 0);
    b.albedo = look.albedo;
    b.color = look.color;
    // (drawn afresh from its new seed)
    this.bodies.changed(b);
    this.updateHud();
  }

  /**
   * The Colour slider of the world being put in place, if it has a generated look: all its colours turned `s` of a turn
   * round the colour wheel (0 to 1; kept in 256 steps, as a link keeps it), its point's colour and brightness with them.
   */
  setMadeHue(s: number): void {
    const b = this.mover.placing ? this.mover.body : null, as = b?.meta.madeAs as BodyJson['madeAs'];
    if (!b || !as || as.seed === undefined || !isWorldKind(as.kind)) return;
    const hue = (((Math.round(s * HUE_STEPS) % HUE_STEPS) + HUE_STEPS) % HUE_STEPS) / HUE_STEPS;
    if (hue === (as.hue ?? 0)) return;
    if (hue) as.hue = hue;
    else delete as.hue;
    const look = this.lookOf(as.kind, as.seed, hue);
    b.albedo = look.albedo;
    b.color = look.color;
    this.bodies.recolour(b);
  }

  /**
   * The Name field of the world being put in place was left, or Enter pressed: `typed` is its name from now (src/app/SceneWorld.ts:
   * takeName) unless it is not plain or another thing has it (`findByName` finds something else by it), when the name stays.
   * Null when it was taken; otherwise a plain line saying why not. Only a world made is renamed, never a catalogue name.
   */
  renameMade(typed: string): string | null {
    const b = this.mover.placing ? this.mover.body : null;
    if (!b || !b.meta.madeAs) return null;
    const v = takeName(typed, (n) => { const o = this.findByName(n); return !!o && o !== b; });
    if ('why' in v) return v.why;
    if (v.name !== b.name) {
      b.rename(v.name);
      // (Undo says what it undoes by the name it has now)
      if (this.pending?.kind === 'add') this.pending.before.what = `making ${v.name}`;
      this.updateHud();
    }
    return null;
  }

  /** Add rings, or Remove rings: the world being put in place, if it has a generated look, gets a ring, or loses it (the rest of its look stays). */
  toggleRings(): void {
    const b = this.mover.placing ? this.mover.body : null, as = b?.meta.madeAs as BodyJson['madeAs'];
    if (!b || !as || as.seed === undefined || !isWorldKind(as.kind)) return;
    as.rings = !as.rings;
    // (drawn afresh, with its ring or without)
    this.bodies.changed(b);
    this.updateHud();
  }

  /** The mass slider of the world being put in place (0 to 1): that mass from now, and the size that follows from it, and a sun's light and colour (src/app/WhatIf.ts: madeSize). */
  setMadeMass(s: number): void {
    const b = this.mover.placing ? this.mover.body : null, as = b?.meta.madeAs as BodyJson['madeAs'], p = this.placement;
    if (!b || !as || !p) return;
    const kind = as.kind as Kind, kg = madeMassAt(kind, s, p.base);
    if (kg === as.kg) return;
    const size = madeSize(kind, kg, as.icy), k = size.radius / b.radius;
    as.kg = kg;
    this.physics.resize(b, G * kg, [k * b.radii[0], k * b.radii[1], k * b.radii[2]], this.clock.jdTdb);
    if (kind === 'sun') this.shine(b, kg);
    this.mover.recircle();
  }

  /** A sun the explorer made shines as a star of the main sequence of `kg` would (src/app/WhatIf.ts: madeSize): its colour and its light. */
  private shine(b: Body, kg: number): void {
    const size = madeSize('sun', kg, false);
    b.teff = size.teff!;
    b.absMag = madeAbsMag(size.lum!);
    // (its face and its light are drawn afresh for its new temperature)
    this.bodies.changed(b);
  }

  // ------------------------------------------------------------------ changes: one per gesture, undone, watched
  /**
   * A change to a world begins (`what`: it, in words, for Undo): the mass slider touched, a world
   * taken hold of, Add or Remove tapped. `held`: by a finger or the pointer, and the change ends
   * when it lifts; otherwise it is a run of key presses, which a pause ends. The state before it is
   * kept for Undo (the first change also keeps where the changes began, for Back to reality), and
   * the worlds as they are, for its watch. A watch under way ends first, its rate of time put back.
   */
  beginChange(kind: ChangeKind, body: Body, held: boolean, what: string): void {
    if (this.run.open && this.pending && (this.pending.kind !== kind || this.pending.body !== body)) this.endChange();
    if (!this.run.begin(performance.now(), held)) return;
    this.putRate(this.watch.clear());
    this.forgetHits();
    this.glide = null;
    this.realAgain = 0;
    this.railsNow();
    this.pending = { kind, body, before: this.checkpoint(what), count: this.physics.changes, sample: this.sample(body) };
  }

  /** The change is over (the finger has lifted; a pause after the last key): kept for Undo if it changed anything, and watched (unless `watch` is false: a world put in place without Done). */
  endChange(watch = true): void {
    if (!this.run.end()) return;
    const c = this.pending;
    this.pending = null;
    if (!c || this.physics.changes === c.count) return;
    this.history.push(c.before);
    if (!c.before.live.sim) this.begun = { jd: c.before.live.jd, rate: c.before.rate, present: c.before.present };
    this.replayFrom = null;
    const frame = this.planWatch(c);
    if (!frame) return;
    this.replayFrom = { cp: this.physics.checkpoint(this.clock.jdTdb), frame };
    // (time stays as the explorer had it, unless they asked for the watch to start by itself)
    if (!watch || this.game.flight.on || this.walk.active) return;
    if (this.showMe) this.startWatch(frame);
    else this.watch.offerWatch();
  }

  /** The change under way came to nothing (a throw let go where it was taken hold of, or taken away by the browser): everything as it was before it began, and nothing kept for Undo. */
  cancelChange(): void {
    const c = this.pending;
    if (!this.run.end() || !c) return;
    this.pending = null;
    if (this.physics.changes === c.count) return;
    this.physics.restore(c.before.live);
    this.clock.jdTdb = c.before.live.jd;
    this.drawExo(this.clock.jdTdb);
    this.trails.clear();
    this.forgetHits();
    this.bodies.changed();
  }

  /** A finger (or the pointer) has come down on the mass slider, or lifted from it: one change from the moment it comes down until it lifts. */
  massHeld(held: boolean): void {
    const b = held ? this.powerBody() : null;
    if (held && b && this.powersOf(this.selection!).mass.works) this.beginChange('mass', b, true, `changing ${the(b.name)}'s mass`);
    else if (!held && this.pending?.kind === 'mass') this.endChange();
  }

  /** Undo: back to just before the last change, the date and the rate of time included. The first change undone is the real Solar System again. */
  undo(): void {
    // (a world being put in place: its making ends, unwatched, and is what is undone)
    if (this.mover.placing) this.mover.stop();
    if (this.run.open) this.endChange();
    const cp = this.history.pop();
    if (!cp) return;
    this.restore(cp);
    this.realAgain = !cp.live.sim && this.history.size > 0 ? performance.now() : 0;
    this.hud.toast(`Undone: ${cp.what}${cp.live.sim ? '' : this.physics === this.solar ? '. The real Solar System again' : `. ${capital(the(this.physics.system.sun.name))} and its planets are real again`}`, 3);
  }

  /** Everything as it is now, for Undo: the worlds, the rate of time, whether the clock follows the present; `what` is the change about to be made. */
  private checkpoint(what: string): Checkpoint {
    const now = utcToTdb(dateToJdUtc(new Date()));
    return { live: this.physics.checkpoint(this.clock.jdTdb), rate: this.rateState(), present: !this.clock.paused && this.clock.rate === 1 && Math.abs(this.clock.jdTdb - now) < 120 / DAY, begun: this.begun, what };
  }

  /** Back to a state Undo kept: the worlds, the date (the present, if the clock was following it in the real Solar System) and the rate of time. */
  private restore(cp: Checkpoint): void {
    this.watch.clear();
    this.glide = null;
    this.mover.stop();
    this.replayFrom = null;
    this.physics.restore(cp.live);
    this.clock.jdTdb = cp.live.jd;
    if (!cp.live.sim && cp.present) { this.clock.setUtcNow(); this.system.update(this.clock.jdTdb); }
    this.drawExo(this.clock.jdTdb);
    this.putRate(cp.rate);
    this.begun = cp.begun;
    this.trails.clear();
    this.forgetHits();
    this.bodies.changed();
  }

  /** The rate of time as the explorer has it now, to put back (Watch.ts). */
  private rateState(): RateState {
    return { index: this.rateIndex, sign: this.rateSign, rate: this.clock.rate, paused: this.clock.paused };
  }

  private putRate(s: RateState | null): void {
    if (!s) return;
    this.rateIndex = s.index;
    this.rateSign = s.sign;
    this.clock.rate = s.rate;
    this.clock.paused = s.paused;
  }

  /** The worlds as they are now, for a change's watch (src/app/Watch.ts: sample). */
  private sample(touched: Body): Map<Body, Sampled> {
    return sample(this.physics, this.physics.system, touched);
  }

  /**
   * How a change is watched (src/app/Watch.ts: planChange; null: nothing it matters to goes round
   * anything to be seen). The frame's centre: the world made heavier or lighter; the one something
   * was added to; what holds sway where a world was put; where a world taken away would have gone.
   */
  private planWatch(c: Pending): WatchFrame | null {
    const centre = c.kind === 'move' ? this.physics.swayAt(c.body.pos.toArray(), c.body) ?? c.body.parent : c.body;
    return planChange(c.kind, c.body, c.sample, this.sample(c.body), centre, this.input.touch ? WATCH_MOST_TOUCH : WATCH_MOST);
  }

  /** Watch a change: time at the watch's pace until it is stopped (src/app/Watch.ts), and the camera eased to its frame. */
  private startWatch(f: WatchFrame): void {
    // (the ship keeps its own time, and walking its own camera)
    if (this.game.flight.on || this.walk.active) return;
    this.watch.start(f.rate, this.rateState());
    this.clock.rate = f.rate;
    this.clock.paused = false;
    // (the chip and the mark are drawn first, and an open panel of the card makes room on an upright
    // screen: the frame is fitted to what they leave clear)
    this.updateHud();
    this.framed = null;
    if (f.centre) this.frameOn(f.centre, f.radius);
  }

  /**
   * Ease the camera to a frame `radius` (m) round `centre`, in the part of the view the interface
   * leaves clear (an open panel of the card folding away to make room on an upright screen).
   */
  private frameOn(centre: Body, radius: number): void {
    if (this.vr.active) return;
    this.hud.makeRoom();
    // (the optical centre it will have by the time the card and the panel are drawn: its target)
    const at = this.vr.active || this.walk.active ? null : this.hud.clearPart();
    const v = viewFrame(this.hud.freeArea(), this.cssW, this.cssH, this.rig.fovY, at?.x ?? 0, at?.y ?? 0);
    const d = frameDistance(Math.max(radius, 1.2 * centre.radius), v.halfX, v.halfY);
    if (this.rig.autopilot) this.rig.cancelGoto();
    // (a world taken away is a point to look at, nothing to turn round)
    this.rig.target = centre.valid ? shownOf(centre) : null;
    this.framed = centre.valid ? centre : null;
    this.frameAsked = { centre, radius };
    this.glide = new Glide(this.rig, centre, d, v.dir);
  }

  /** Stop: the explorer's rate of time comes back, the camera stays where it is, and Replay is offered. */
  private stopWatch(): void {
    this.putRate(this.watch.stop());
    this.glide = null;
  }

  /** Each frame: the watch's pace, lowered if the stepping cannot keep up (it ends only when stopped); a run of keys ended by its pause. */
  private tickWatch(dt: number, ran: number): void {
    const what = this.watch.tick(dt, ran, this.physics.keeping);
    if (what === 'slower') this.clock.rate = this.watch.rate;
    const now = performance.now();
    if (this.run.due(now)) this.endChange();
    // (what was undone by the return to reality is let go once Undo is no longer offered)
    if (this.realAgain && now - this.realAgain > REAL_AGAIN_MS) {
      this.realAgain = 0;
      if (!this.physics.on) this.history.clear();
    }
  }

  // ------------------------------------------------------------------ impacts you can see (src/app/Impacts.ts)
  /**
   * How much of a frame of `dt` seconds time runs for (a share of the rate asked for): all of it,
   * unless two worlds are about to hit, when time slows for their last coming together to take a
   * few seconds (SlowMotion), the camera framing them. Only while the explorer has changes shown
   * (Show me, or a watch under way: time and the view are not taken over otherwise), live physics is on and time runs on.
   */
  private slowing(dt: number): number {
    const c = this.clock;
    if (!this.physics.on || c.paused || !(c.rate > 0) || !(this.showMe || this.watch.watching)) {
      if (this.slow.phase !== 'idle') this.slow.reset();
      return 1;
    }
    const worlds: Meeting<Body>[] = [];
    for (const b of this.physics.bodies()) {
      if (!b.valid || !weighty(b) || !(b.radius > 0)) continue;
      // (how far its pull holds sway: its Hill sphere about what it goes round; the Sun's, everywhere)
      const p = b.parent, reach = p && p.gm > 0 ? b.pos.distanceTo(p.pos) * Math.cbrt(b.gm / (3 * p.gm)) : Infinity;
      worlds.push({ body: b, gm: b.gm, radius: b.radius, pos: [b.pos.x, b.pos.y, b.pos.z], vel: [b.vel.x, b.vel.y, b.vel.z], reach });
    }
    const next = soonestContact(worlds, c.rate * dt, ZONE);
    const run = this.slow.run(dt, c.rate, next);
    if (run.slowed && next) this.frameHit(next.a, next.b);
    return run.seconds / (c.rate * dt);
  }

  /**
   * Two worlds about to hit, time slowed for it: the camera frames them, round the heavier, unless
   * they are in the clear part of the view already and far enough apart on the screen to be seen
   * coming together. Not in the ship, on foot or in the headset.
   */
  private frameHit(a: Body, b: Body): void {
    if (this.game.flight.on || this.walk.active || this.vr.active) return;
    const [big, small] = a.gm >= b.gm ? [a, b] : [b, a];
    const free = this.hud.freeArea(), rel = new Vector3();
    const at = (x: Body) => this.project(x.upos.sub(this.rig.upos, rel));
    const inside = (p: { x: number; y: number } | null) => !!p && p.x > free.left && p.x < free.right && p.y > free.top && p.y < free.bottom;
    const p = at(big), q = at(small);
    if (p && q && inside(p) && inside(q) && Math.hypot(p.x - q.x, p.y - q.y) >= SEEN_APART) return;
    this.frameOn(big, 1.2 * big.pos.distanceTo(small.pos));
  }

  /**
   * Worlds have met: what the newest hit was, on a card (Powers.impactWords), and a flash where
   * they met, unless that was more than a second ago on the screen (at a hundred years a second a
   * frame is a long time); time, if it was slowed for them, comes back after a moment. Returns
   * what was said of the hit shown, which the card says better than the toast would.
   */
  private sawHits(hits: Hit[]): string {
    const h = hits[hits.length - 1];
    // (the interface as it is now first: the world taken in may have been the one chosen, its card open)
    this.updateHud();
    const was = this.hud.freeArea();
    this.hud.impact(impactWords(h.small, h.big, h.speed, h.energy));
    // (the card takes room above the world's card: where that leaves less of the view clear, a frame the camera is in for a
    // watch or a hit is fitted again to what is left, round the world they became if it was round the one that is gone)
    const f = this.frameAsked, now = this.hud.freeArea();
    const less = Math.abs(now.top - was.top) + Math.abs(now.bottom - was.bottom) + Math.abs(now.left - was.left) + Math.abs(now.right - was.right) > 1;
    if (f && less && (this.watch.watching || this.slow.phase !== 'idle')) this.frameOn(f.centre.valid ? f.centre : h.into, f.radius);
    const rate = Math.min(Math.abs(this.clock.rate), this.slow.cap);
    if (this.clock.paused || ((this.clock.jdTdb - h.jd) * DAY) / rate <= 1) this.flash.start(h.into);
    this.slow.hit();
    return h.told;
  }

  // ------------------------------------------------------------------ the future, drawn (src/app/Foresight.ts)
  /** The world the look ahead is for: one a finger holds, aims or puts in place (time waits), or one whose mass slider is held. */
  private touchedWorld(): Body | null {
    const m = this.mover, c = this.pending;
    if (m.body && (m.holding || m.placing)) return m.body;
    return c && c.kind === 'mass' && this.run.open ? c.body : null;
  }

  /**
   * Each frame: the simulation run ahead for the world touched, from how things are now, started
   * again when that has changed (at most five times a second: a copy of the simulation is made each
   * time), and grown with the time the stepping of the waiting simulation is not using (a little
   * beside it while time runs).
   */
  private lookAhead(rawDt: number): void {
    const b = this.touchedWorld(), live = this.physics.live;
    if (!b || !live || !b.valid || !this.physics.simulated(b)) {
      if (this.aheadOf) { this.ahead.stop(); this.aheadOf = null; }
      return;
    }
    const from = `${b.id} ${live.sim.time} ${live.sim.layout} ${b.gm} ${b.pos.x} ${b.pos.y} ${b.pos.z} ${b.vel.x} ${b.vel.y} ${b.vel.z}`;
    const now = performance.now();
    if (b !== this.aheadOf || (from !== this.aheadFrom && now - this.aheadAt >= AHEAD_AGAIN_MS)) {
      const p = b.parent, o = this.physics.orbit(b);
      // (once round the orbit it is on; on an open path, the time a circle would take where it is)
      const turn = o?.bound ? o.period : p ? 2 * Math.PI * Math.sqrt(b.pos.distanceTo(p.pos) ** 3 / (p.gm + b.gm)) : 365.25 * DAY;
      this.ahead.start(live.sim.snapshot(), b.id, p ? p.id : -1, turn);
      this.aheadOf = b;
      this.aheadFrom = from;
      this.aheadAt = now;
    }
    this.ahead.grow(this.clock.paused ? Math.max(3, Math.min(12, 250 * rawDt)) : 2);
  }

  /** What ends the path ahead, in words, where it ends and on the card (Powers.aheadWords: "hits Earth in 43 days", "in 49 days it is the Sun's"); null while nothing does. */
  private aheadSaid(): { there: string; line: string } | null {
    const end = this.ahead.end, live = this.physics.live, b = this.aheadOf, sun = this.physics.system.sun;
    if (!live) return null;
    // (one bound to nothing from the start, on an open path past the Sun, that nothing stops on its way: it is leaving)
    if (!end) return this.ahead.done && b && !b.parent && b !== sun && this.physics.orbit(b, sun)?.bound === false ? aheadWords({ kind: 'leaves', from: sun.name }) : null;
    const name = (id: number) => this.physics.system.byId.get(id)?.name ?? '?';
    const when = whenWords(end.time, live.jd0 + (this.ahead.from + end.time) / DAY);
    if (end.kind === 'hit') return aheadWords({ kind: 'hit', other: name(end.other), when });
    if (end.kind === 'leaves') return aheadWords({ kind: 'leaves', from: this.ahead.around >= 0 ? name(this.ahead.around) : null });
    return aheadWords({ kind: 'round', around: name(end.around), when });
  }

  /** What the look ahead found, for the card: what ends the path, or how long it goes on as it is; nothing while it is still looking. */
  private aheadLine(): string {
    const said = this.aheadSaid(), f = this.ahead;
    if (said) return said.line;
    return f.done && f.count > 1 ? `With every pull counted, it goes on like this for ${spanWords(f.times[f.count - 1] - f.from)} at least.` : '';
  }

  /** What was shown of a hit is over: a change undone or replayed, the way back to reality, a new change. */
  private forgetHits(): void {
    this.slow.reset();
    this.flash.clear();
    this.hud.impact(null);
  }

  /** Replay: back to the moment just after the last change, watched again. The simulation goes the same way: it is the same event. */
  replay(): void {
    const r = this.replayFrom;
    if (!r || this.run.open) return;
    this.watch.clear();
    this.glide = null;
    this.mover.stop();
    this.physics.restore(r.cp);
    this.clock.jdTdb = r.cp.jd;
    this.drawExo(this.clock.jdTdb);
    this.trails.clear();
    this.forgetHits();
    this.bodies.changed();
    this.startWatch(r.frame);
  }

  // ------------------------------------------------------------------ the powers (src/app/LivePhysics.ts)
  /**
   * A body is no longer there (taken away, or made one with `into`): the camera and the selection
   * go to what took it in, or to what it went round.
   */
  private bodyLeft(b: Body, into: Body | null): void {
    const system = this.physics.system;
    const near = into ?? (b.parent && !system.isGone(b.parent) ? b.parent : null);
    // (in another star's system the camera and the selection are on what its bodies stand for)
    const was = shownOf(b), to = near && shownOf(near);
    if (this.rig.target === was || this.rig.anchor === was) {
      this.rig.cancelGoto();
      this.rig.target = to;
      this.rig.setAnchor(to);
    }
    if (this.selection === was) {
      this.hud.selectionMoved();
      this.select(to);
    }
    if (was !== b) this.nearTimer = 0;
    this.orbits.forget(b);
    this.trails.forget(b);
    this.bodies.changed();
  }

  /**
   * Tell what live physics has to tell (and, the first time, that it is on): three lines at most,
   * the first three. After the explorer's own act its line is the first ("Sun 2 is new", "Ceres is
   * gone"), and what follows from it comes as the simulation tells it, the weightiest first
   * (LivePhysics.hear): a second sun that takes Mercury and Venus must not push its own news out.
   * The rest is in the log, in the Time sheet.
   */
  tellNews(wasOn = true): void {
    const hits = this.physics.takeHits();
    const carded = hits.length ? this.sawHits(hits) : '';
    const news = this.physics.takeNews().filter((n) => n !== carded).slice(0, 3);
    if (!wasOn && this.physics.on) {
      news.unshift(this.physics === this.solar ? 'Live physics is on: from now on everything here pulls on everything else.'
        : `Live physics is on round ${this.physics.system.sun.name}: its star and planets pull on one another. Everything else stays real.`);
    }
    if (news.length) this.hud.toast(news.join('\n'), 3 + 1.5 * news.length);
  }

  /**
   * The mass slider of the selected world was moved: it has that many times its real mass from now
   * on. (Without a finger on the slider, its arrow keys: a run of them is one change.)
   */
  setMass(slider: number): void {
    const b = this.powerBody();
    if (!b || !this.powersOf(this.selection!).mass.works) return;
    const real = this.physics.realGm(b), sun = madeSun(b);
    // (a sun the explorer made is a star of the main sequence: of the masses it could be made with)
    const gm = sun ? G * Math.max(MADE_MASS.sun[0], Math.min(MADE_MASS.sun[1], (massFactor(slider) * real) / G)) : massFactor(slider) * real;
    // (put back where it stood, with nothing changed yet: nothing to simulate)
    if (!(real > 0) || gm === b.gm) return;
    this.beginChange('mass', b, false, `changing ${the(b.name)}'s mass`);
    const wasOn = this.physics.on;
    // its size follows: a made sun's as the main sequence has it, a world's at the same density if that is asked
    const R = sun ? madeSize('sun', gm / G, false).radius : this.sizeFollows && this.sizeable(b) ? sameDensity(this.physics.realRadius(b), gm / real) : b.radius;
    this.physics.setMass(b, gm, this.clock.jdTdb, R === b.radius ? undefined : this.radiiOf(b, R));
    if (sun) this.shine(b, gm / G);
    this.tellNews(wasOn);
  }

  /** Can a body's size be changed: a world (not a star: a made sun's follows its mass, the Sun keeps its look) of a known mass and a measured size? */
  private sizeable(b: Body): boolean {
    return b.kind !== 'star' && this.physics.realGm(b) > 0 && b.radius > 0 && !b.radiusEstimated;
  }

  /** A body's three radii for a mean radius of `R` (m), its shape kept. */
  private radiiOf(b: Body, R: number): [number, number, number] {
    const k = R / b.radius;
    return [k * b.radii[0], k * b.radii[1], k * b.radii[2]];
  }

  /** The size slider of the selected world was put at `slider` (Powers.sizeFactor): that size from now; at the same density its mass follows. */
  setSize(slider: number): void {
    const b = this.powerBody();
    if (!b || !this.powersOf(this.selection!).size.works || !this.sizeable(b)) return;
    const R0 = this.physics.realRadius(b), R = sizeFactor(slider) * R0;
    if (R === b.radius) return;
    this.beginChange('mass', b, false, `changing ${the(b.name)}'s size`);
    const wasOn = this.physics.on;
    if (this.sizeFollows) this.physics.setMass(b, this.physics.realGm(b) * (R / R0) ** 3, this.clock.jdTdb, this.radiiOf(b, R));
    else this.physics.setSize(b, R, this.clock.jdTdb);
    this.tellNews(wasOn);
  }

  /** A finger (or the pointer) has come down on the size slider, or lifted from it: one change from the moment it comes down until it lifts. */
  sizeHeld(held: boolean): void {
    const b = held ? this.powerBody() : null;
    if (held && b && this.powersOf(this.selection!).size.works) this.beginChange('mass', b, true, `changing ${the(b.name)}'s size`);
    else if (!held && this.pending?.kind === 'mass') this.endChange();
  }

  /** Same density on (`on`) or off: on, the selected world's size is made to follow its mass at once, as one change. */
  private linkSize(on: boolean): void {
    this.sizeFollows = on;
    const b = on ? this.powerBody() : null;
    if (!on || !b || !this.powersOf(this.selection!).size.works || !this.sizeable(b)) return;
    const R = sameDensity(this.physics.realRadius(b), b.gm / this.physics.realGm(b));
    if (Math.abs(R / b.radius - 1) < 1e-12) return;
    this.beginChange('mass', b, true, `changing ${the(b.name)}'s size`);
    const wasOn = this.physics.on;
    this.physics.setSize(b, R, this.clock.jdTdb);
    this.tellNews(wasOn);
    this.endChange();
  }

  /** Take a world away: everything else carries on without it. */
  removeBody(b: Body): void {
    if (!this.powersOf(b).remove.works || !this.physics.system.bodies.includes(b)) return;
    this.beginChange('remove', b, true, `taking away ${the(b.name)}`);
    const wasOn = this.physics.on;
    this.physics.remove(b, this.clock.jdTdb);
    this.tellNews(wasOn);
    this.endChange();
  }

  /**
   * Take a comet away: live physics starts, as for any change; its point and its tail are hidden
   * until Undo or Back to reality. It has no mass, so nothing else moves differently, and nothing
   * of it is watched. (The change is made on the Sun, which does not change: no watch is planned.)
   */
  removeComet(c: Comet): void {
    if (!this.powersOf(c).remove.works || this.physics.away.has(c)) return;
    this.useLive(this.solar);
    this.beginChange('remove', this.system.sun, true, `taking away ${c.name}`);
    const wasOn = this.physics.on;
    this.physics.removeSmall(c, this.clock.jdTdb);
    if (this.rig.target === c || this.rig.anchor === c) {
      this.rig.cancelGoto();
      this.rig.target = null;
      this.rig.setAnchor(null);
    }
    if (this.selection === c) {
      this.hud.selectionMoved();
      this.select(null);
    }
    this.tellNews(wasOn);
    this.endChange();
  }

  /**
   * Undo everything: the real Solar System again as it was when the first change was made, the
   * date and the rate of time with it (the clock following the present again if it was then),
   * what was made taken away, what the simulation drew cleared. It is a change like the others:
   * for a moment Undo is offered at the top, and brings the changed world back.
   */
  backToReality(): void {
    if (!this.physics.on) return;
    // (a world being put in place is left where it is first: its making is one of the changes undone)
    this.mover.stop();
    if (this.run.open) this.endChange();
    this.putRate(this.watch.clear());
    this.glide = null;
    this.replayFrom = null;
    this.history.push(this.checkpoint('Back to reality'));
    const begun = this.begun;
    const solar = this.physics === this.solar;
    let said = this.physics.backToReality(this.clock);
    this.drawExo(this.clock.jdTdb);
    if (!solar) said = `${said}: ${the(this.physics.system.sun.name)} and its planets on their real orbits`;
    this.trails.clear();
    this.forgetHits();
    this.bodies.changed();
    if (begun) {
      this.putRate(begun.rate);
      if (begun.present) {
        this.clock.setUtcNow();
        this.system.update(this.clock.jdTdb);
        said = 'Back to reality, and to the present';
      }
    } else if (this.rateIndex >= RATE_STEPS.length) { this.rateIndex = RATE_STEPS.length - 1; this.clock.rate = this.rateAt(this.rateIndex); }
    this.begun = null;
    this.realAgain = performance.now();
    this.hud.toast(said, 4);
  }

  /**
   * Compile every material the scene can need (planets, rings, stars, glare, all atmospheres) up
   * front, so a shader is never compiled mid-flight. Runs inside a frame so the headset's variant
   * is compiled while presenting.
   */
  private warmUp(): void {
    const bodyObjs = this.bodies.warmupObjects(), exoObjs = this.exo.warmupObjects();
    // the landing terrain's shader for both kinds of surface material
    const terrain = [bodyObjs.find((m) => m.name === 'Saturn'), exoObjs[0]].filter((m) => !!m).map((m) => this.terrain.warmupMesh(m.material as ShaderMaterial));
    const air = this.atmospheres.warmupObjects()[0];
    if (air) terrain.push(this.terrain.warmupHaze(air.material as ShaderMaterial));
    const objs = [...bodyObjs, ...terrain, ...this.atmospheres.warmupObjects(), ...this.holes.warmupObjects(), ...this.near.warmupObjects(), ...exoObjs, ...this.craft.warmupObjects(), ...this.game.warmupObjects(), ...this.deepSky.warmupObjects(), ...this.galaxies.warmupObjects(), ...this.rocks.warmupObjects(), this.mwVolume.mesh, ...this.cometTails.warmupObjects(), ...this.jets.warmupObjects(), ...this.awe.cues.warmupObjects(), (this.trailWarm ??= this.trails.warmupObject()), this.futures.warmupObject(), this.flash.mesh];
    const was = objs.map((o) => o.visible);
    for (const o of objs) o.visible = true;
    // (into the HDR target the scene is drawn to: programs differ per output target)
    HITCH.markWarm(false);
    void this.renderer.withSceneTarget(() => this.renderer.gl.compileAsync(this.renderer.scene, this.renderer.camera)).catch(() => undefined).finally(() => { HITCH.markWarm(); this.shadersReady(); });
    this.galaxy.compile(this.renderer.gl);
    this.holes.compile(this.renderer.gl);
    objs.forEach((o, i) => { o.visible = was[i]; });
  }

  private trailWarm: ReturnType<TrailsLayer['warmupObject']> | null = null;

  goTo(obj: SpaceObject): void {
    // (a flight asked for takes the camera from a watch's frame)
    this.glide = null;
    if (obj instanceof Body) this.bodies.prefetch(obj);
    // in the ship nothing outruns light: the ship's autopilot flies there
    if (this.game.flight.on) { this.game.flight.autopilotTo(obj); return; }
    // arrival distances are those of a wide view; an upright one stands back to frame the same
    const fit = this.rig.framing;
    if (obj instanceof BlackHole) {
      this.rig.flyTo(obj, obj.radius * 30 * fit, undefined, true, obj.approachDir(this.rig.upos.sub(obj.upos, new Vector3())));
      return;
    }
    if (obj instanceof MilkyWay) {
      this.rig.flyTo(obj, obj.radius * 2.6 * fit, undefined, true, obj.viewDir());
      this.hud.toast('Leaving the galaxy');
      return;
    }
    if (obj instanceof DeepSkyObject) {
      this.rig.flyTo(obj, obj.radius * (obj.data.kind === 'open' ? 1.6 : 2.6) * fit);
      return;
    }
    if (obj instanceof Galaxy) {
      // a second "go" from near the galaxy flies into its disc, looking at the bulge
      const from = this.rig.upos.sub(obj.upos, new Vector3());
      if (from.length() < obj.radius * 3) {
        this.rig.flyTo(obj, obj.radius * 0.4, undefined, true, obj.insideDir(from));
        this.hud.toast(`Flying into ${obj.name}`);
        return;
      }
      this.rig.flyTo(obj, obj.radius * 2.4 * fit, undefined, true, obj.viewDir(from));
      this.hud.toast(`Going to ${obj.name} (go again to fly into it)`);
      return;
    }
    let d: number;
    if (obj instanceof Body) d = obj.kind === 'star' ? obj.radius * 8 : Math.max(obj.radius * 3.5, 2e3);
    else if (obj instanceof ExoPlanet) d = obj.radius * 3.5;
    else if (obj instanceof Spacecraft) d = Math.max(obj.radius * 5, 10);
    else if (obj instanceof TrafficShip) d = obj.radius * 6;
    else if (obj instanceof Station) {
      // arrive in front of the docking port, on the hub axis
      this.rig.flyTo(obj, 700, undefined, true, obj.axis.clone());
      this.hud.toast(`Going to ${obj.name}: fly in slowly to dock`);
      return;
    }
    else if (obj instanceof CatalogStar) d = Math.max(obj.radius * 4.5, 2e7);
    else if (obj instanceof Comet) d = Math.max(obj.radius, 2000) * 40;   // close enough to see the nucleus
    else if (obj instanceof RingSpot) {
      this.rig.flyTo(obj, 60, undefined, true, obj.approachDir());
      return;
    } else if (obj instanceof Landmark) {
      // (on arrival: if it is night there, say so, with the way on to its sunrise)
      this.arrival = obj;
      this.hud.clearNotice();
      // (with time running fast the ground would turn the place away under the flight: it would seem
      // to fly backwards. The flight is made in real time)
      if (!this.clock.paused && Math.abs(this.clock.rate) > 1 && !this.physics.on) {
        this.rateIndex = 0;
        this.rateSign = 1;
        this.clock.rate = 1;
        this.hud.toast(`Real time for the flight: the ground turns under ${obj.name}`, 3);
      }
      // arrive above the place from the side lit by the Sun, looking down at it
      this.rig.flyTo(obj, obj.def.view * fit, undefined, true, obj.approachDir(this.system.sun.upos.sub(obj.world.upos, new Vector3()).normalize()));
      return;
    }
    else d = Math.max(obj.radius * 4, 1e6);
    // a world reached from afar is arrived at where there is something of it to see: from its lit
    // side, if the straight way there ends over its night (close by, the eye is where it was put)
    const from = this.rig.upos.sub(obj.upos, new Vector3());
    const sun = obj instanceof Body && obj.kind !== 'star' && from.length() > FAR_ARRIVAL * d * fit ? this.system.sunAt(obj.pos) : null;
    this.rig.flyTo(obj, d * fit, undefined, true, sun ? sunlitSide(from, sun.upos.sub(obj.upos, new Vector3())) : undefined);
  }

  center(obj: SpaceObject): void {
    const dir = obj.upos.sub(this.rig.upos, new Vector3()).normalize();
    this.rig.lookAt(dir);
  }

  screenshot(): void {
    const a = document.createElement('a');
    a.href = this.renderer.screenshot();
    a.download = `${STORAGE_PREFIX}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
    // (long enough to be read once the sheet it was asked from has gone, and saying where it went)
    this.hud.toast(`Picture saved to your downloads\n${a.download}`, 4);
  }

  private ringSpot: RingSpot | null = null;
  private landmarkCache = new Map<string, Landmark>();
  /** normKey of the named stars' names, once each: the search runs per keystroke over them all */
  private namedKeys = new Map<string, string>();

  /** Named places on the landing terrain (Olympus Mons, the Apollo 11 site …). */
  get landmarks(): Landmark[] {
    for (const d of LANDMARKS) {
      if (this.landmarkCache.has(d.name)) continue;
      const w = this.system.bodies.find((b) => b.name === d.body);
      if (w) this.landmarkCache.set(d.name, new Landmark(d, w));
    }
    return [...this.landmarkCache.values()];
  }

  findByName(name: string): SpaceObject | null {
    const n = name.toLowerCase();
    const lm = this.landmarks.find((l) => l.name.toLowerCase() === n || l.name.toLowerCase().startsWith(`${n} (`));
    if (lm) return lm;
    if (/^(saturn'?s? rings?|rings of saturn|the rings|b ring)$/.test(n)) {
      const saturn = this.system.bodies.find((x) => x.name === 'Saturn');
      if (saturn) this.ringSpot ??= new RingSpot(saturn, this.system.sun.upos.sub(saturn.upos, new Vector3()).normalize());
      return this.ringSpot;
    }
    const b = this.system.bodies.find((x) => x.name.toLowerCase() === n);
    if (b) return b;
    const gx = this.galaxies.galaxies.find((g) => g.name.toLowerCase() === n || g.data.simbad.toLowerCase().replace(/\s+/g, '') === n.replace(/\s+/g, '') || (n === 'andromeda' && g.name.startsWith('Andromeda')));
    if (gx) return gx;
    const dso = this.deepSky.objects.find((o) => o.name.toLowerCase() === n || o.data.simbad.toLowerCase().replace(/\s+/g, '') === n.replace(/\s+/g, ''));
    if (dso) return dso;
    const sc = this.craft.craft.find((c) => c.name.toLowerCase() === n || (n === 'iss' && c.name.startsWith('International')) || (n === 'jwst' && c.name.startsWith('James')) || (n === 'hubble' && c.name.startsWith('Hubble')));
    if (sc) { sc.update(this.clock.jdTdb); return sc; }
    const c = this.small.cometObjects.find((x) => !this.solar.away.has(x) && x.name.toLowerCase().includes(n));
    if (c) return c;
    const h = this.blackHoles.find((x) => x.name.toLowerCase() === n || x.data.aliases.some((a) => a.toLowerCase() === n));
    if (h) return h;
    const ps = this.procStars.find(name);
    if (ps) return ps;
    if (n === 'milky way' || n === 'galaxy' || n === 'the galaxy') return this.milkyWay;
    const xp = this.systems.findPlanet(name);
    if (xp) return this.exoPlanet(xp.i, xp.k);
    const s = this.named.list.find((x) => x.names.some((nm) => nm.toLowerCase() === n));
    if (s) return this.getStar(this.catalog, s.node, s.slot);
    const xh = this.systems.findHost(name);
    if (xh !== null) return this.exoHost(xh);
    // a generated planet: "<star> <letter>"
    const m = /^(.+)\s([b-k])$/i.exec(name.trim());
    if (m) {
      const host = this.findByName(m[1]);
      const sys = host instanceof CatalogStar ? this.systems.of(host) : null;
      const pl = sys?.planets.find((p) => p.name.toLowerCase() === n);
      if (sys && pl) { sys.update(this.clock.jdTdb); return pl; }
    }
    return null;
  }

  searchItems(q: string): Destination[] {
    const n = q.toLowerCase();
    const keys = queryKeys(q);
    // (what people type that the data answers to under other names: "Sol" is the Sun, "Alpha
    // Centauri" is Rigil Kentaurus and Toliman)
    const alias = (SEARCH_ALIASES[normKey(q)] ?? []).map((a) => a.toLowerCase());
    const out: { label: string; detail: string; id: string; score: number }[] = [];
    const score = (name: string) => {
      const l = name.toLowerCase();
      if (l === n) return 0;
      if (alias.includes(l)) return 0;
      if (l.startsWith(n)) return 1 + l.length / 100;
      if (l.includes(n)) return 2 + l.length / 100;
      return -1;
    };
    for (const b of this.system.bodies) {
      const s = this.system.isGone(b) ? -1 : score(b.name);
      if (s >= 0) out.push({ label: b.name, detail: b.kind === 'moon' ? moonWords(b) : b.kind, id: `body:${b.id}`, score: s - (b.kind === 'planet' ? 0.5 : 0) });
    }
    this.small.cometObjects.forEach((c, i) => {
      const s = this.solar.away.has(c) ? -1 : score(c.name);
      if (s >= 0) out.push({ label: c.name, detail: 'comet', id: `comet:${i}`, score: s + 0.2 });
    });
    {
      const s = Math.min(...['Milky Way', 'galaxy'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(s)) out.push({ label: 'Milky Way', detail: 'our galaxy, seen from outside', id: 'mw:0', score: s - 0.2 });
    }
    this.blackHoles.forEach((h, i) => {
      // SIMBAD-style aliases ("NAME Sgr A*", "M  87") match as typed
      const names = [h.name, ...h.data.aliases.map((a) => a.replace(/^NAME\s+/, '').replace(/\s+/g, ' ')), 'black hole'];
      const best = Math.min(...names.map(score).filter((x) => x >= 0));
      // (the famous first: in the order of the Explore list, HOLES; a word such as "black" matches them all alike)
      const fame = HOLES.indexOf(h.name);
      if (Number.isFinite(best)) out.push({ label: h.name, detail: h.supermassive ? 'supermassive black hole' : 'black hole', id: `bh:${i}`, score: best - 0.1 + (fame >= 0 ? fame * 0.001 : 0.05) });
      if (h.companion && score(h.companion.name) >= 0) out.push({ label: h.companion.name, detail: 'star orbiting a black hole', id: `bhc:${i}`, score: score(h.companion.name) + 0.3 });
    });
    // (each name's key built once: normKey for them all is about 80 ms, once, not per keystroke)
    if (!this.namedKeys.size && this.named.list.length) {
      for (const st of this.named.list) for (const nm of st.names) if (!this.namedKeys.has(nm)) this.namedKeys.set(nm, normKey(nm));
    }
    for (const st of this.named.list) {
      let best = -1;
      for (const nm of st.names) {
        const s = score(nm), ns = this.namedKeys ? scoreKey(this.namedKeys.get(nm)!, keys) : normScore(nm, keys);
        // (the Greek-letter designations a person types spelled out: "eta carinae" finds "η Car")
        const sc = s >= 0 && ns >= 0 ? Math.min(s, ns) : s >= 0 ? s : ns;
        if (sc >= 0 && (best < 0 || sc < best)) best = sc;
      }
      const planets = best >= 0 ? this.systems.knownPlanets(st.index) : 0;
      if (best >= 0) out.push({ label: st.names[0], detail: planets ? `star with ${planets} known planet${planets > 1 ? 's' : ''} · ${st.names.slice(1, 3).join(', ')}` : `star · ${st.names.slice(1, 3).join(', ')}`, id: `star:${st.index}`, score: best + (st.proper ? 0 : 0.3) });
    }
    out.push(...this.systems.search(q, score));
    // a generated planet, "Gl 9848 b": the star's own system, generated (a confirmed planet is found above;
    // a star people know has none made up)
    const gm = /^(.+)\s+([b-k])$/i.exec(q.trim());
    if (gm) {
      const names = [gm[1].toLowerCase(), ...(SEARCH_ALIASES[normKey(gm[1])] ?? []).map((a) => a.toLowerCase())];
      const st = this.named.list.find((s) => s.names.some((nm) => names.includes(nm.toLowerCase())));
      if (st) {
        const pl = this.systems.searchGenerated(q, this.getStar(this.catalog, st.node, st.slot));
        if (pl) out.push({ label: pl.name, detail: `made-up planet of ${st.names[0]}`, id: `gen:${encodeURIComponent(pl.name)}`, score: 0.15 });
      }
    }
    this.deepSky.objects.forEach((o, i) => {
      const sc = Math.min(...[o.name, o.data.simbad, o.data.simbad.replace(/\s+/g, ''), o.kind].map(score).filter((x) => x >= 0));
      if (Number.isFinite(sc)) out.push({ label: o.name, detail: `${o.data.kind === 'open' || o.data.kind === 'globular' ? `${o.data.kind} cluster` : 'nebula'} · ${Math.round(o.data.distPc * 3.2616).toLocaleString()} ly`, id: `dso:${i}`, score: sc + 0.02 });
    });
    this.galaxies.galaxies.forEach((g, i) => {
      const sc = Math.min(...[g.name, g.data.simbad, g.data.simbad.replace(/\s+/g, ''), 'galaxy'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(sc)) out.push({ label: g.name, detail: `galaxy · ${((g.data.distPc * 3.2616) / 1e6).toFixed(g.data.distPc < 3e5 ? 2 : 1)} million ly`, id: `gx:${i}`, score: sc + (g.name === 'Milky Way' ? 0 : 0.05) });
    });
    {
      const s = Math.min(...["Saturn's rings", 'Saturn rings', 'rings', 'B ring'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(s)) out.push({ label: "Saturn's rings", detail: 'fly into the B ring, among its ice', id: 'place:rings', score: s + 0.1 });
    }
    this.landmarks.forEach((l, i) => {
      const sc = Math.min(...[l.name, l.def.body, 'landing', 'place'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(sc)) out.push({ label: l.name, detail: `place on ${l.def.body}`, id: `lm:${i}`, score: sc + 0.15 });
    });
    this.craft.craft.forEach((c, i) => {
      const sc = Math.min(...[c.name, 'spacecraft', 'probe'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(sc)) out.push({ label: c.name, detail: 'spacecraft', id: `sc:${i}`, score: sc - 0.1 });
    });
    // [catalog] ~200,000 real objects by name and designation (results arrive asynchronously)
    if (this.objCatalog) {
      const k = normKey(q);
      const have = new Set(out.map((o) => normKey(o.label)));
      for (const r of this.objCatalog.find(q)) {
        if (have.has(normKey(r.label))) continue;
        out.push({ ...r, score: normKey(r.label) === k ? 0.05 : 1.5 });
      }
    }
    out.sort((a, b) => a.score - b.score);
    return out.slice(0, 14).map(({ label, detail, id }) => ({ label, detail, id, picture: this.pictureFor(id) }));
  }

  /** The picture beside a search result (what can be told without loading anything for it). */
  private pictureFor(id: string): Picture | undefined {
    const [kind, v] = id.split(':');
    if (kind === 'star') return { shape: 'star', tint: starTint(this.named.list[Number(v)]?.teff ?? 0) };
    if (kind === 'xh' || kind === 'bhc') return { shape: 'star', tint: starTint(0) };
    if (kind === 'xp') return { shape: 'world', tint: [0.55, 0.66, 0.78] };
    if (kind === 'cat') return undefined; // (a catalogue entry becomes an object only when it is chosen)
    const o = this.resolveSearchId(id);
    return o ? pictureOf(o) : undefined;
  }

  /** [catalog] The app's own object for a catalogue entry, if it has one under any of these names. */
  catalogExisting(names: string[]): SpaceObject | null {
    for (const name of names) {
      const n = name.toLowerCase(), ns = n.replace(/\s+/g, '');
      const g = this.galaxies.galaxies.find((x) => x.name.toLowerCase() === n || x.data.simbad.toLowerCase().replace(/\s+/g, '') === ns);
      if (g) return g;
      const d = this.deepSky.objects.find((x) => x.name.toLowerCase() === n || x.data.simbad.toLowerCase().replace(/\s+/g, '') === ns);
      if (d) return d;
      const h = this.blackHoles.find((x) => x.name.toLowerCase() === n || x.data.aliases.some((a) => a.toLowerCase() === n));
      if (h) return h;
      const st = this.named.list.find((s) => s.names.some((x) => x.toLowerCase() === n));
      if (st) return this.getStar(this.catalog, st.node, st.slot);
    }
    return null;
  }

  resolveSearchId(id: string): SpaceObject | null {
    const [kind, v] = id.split(':');
    if (kind === 'obj') return this.offered.get(id.slice(4)) ?? null;
    if (kind === 'body') return this.system.byId.get(Number(v)) ?? null;
    if (kind === 'comet') return this.small.cometObjects[Number(v)] ?? null;
    if (kind === 'bh') return this.blackHoles[Number(v)] ?? null;
    if (kind === 'mw') return this.milkyWay;
    if (kind === 'bhc') return this.blackHoles[Number(v)]?.companion ?? null;
    if (kind === 'star') { const st = this.named.list[Number(v)]; return this.getStar(this.catalog, st.node, st.slot); }
    if (kind === 'xh') return this.exoHost(Number(v));
    if (kind === 'sc') return this.craft.craft[Number(v)] ?? null;
    if (kind === 'gx') return this.galaxies.galaxies[Number(v)] ?? null;
    if (kind === 'dso') return this.deepSky.objects[Number(v)] ?? null;
    if (kind === 'xp') return this.exoPlanet(Number(v), Number(id.split(':')[2]));
    if (kind === 'gen') return this.findByName(decodeURIComponent(v));
    if (kind === 'place' && v === 'rings') return this.findByName("Saturn's rings");
    if (kind === 'lm') return this.landmarks[Number(v)] ?? null;
    if (kind === 'cat') return this.objCatalog?.resolve(id) ?? null;
    return null;
  }

  /** The star of confirmed-planet system `i`: the catalogue's copy when the archive names one, else built from the archive. */
  exoHost(i: number): CatalogStar {
    const ni = this.systems.namedHost(i);
    if (ni !== null) {
      const st = this.named.list[ni];
      const cs = this.getStar(this.catalog, st.node, st.slot);
      this.systems.claim(cs, i);
      return cs;
    }
    return this.systems.hostStar(i);
  }

  /** Planet `k` of confirmed-planet system `i` (its system becomes active so it moves and is drawn). */
  exoPlanet(i: number, k: number): ExoPlanet | null {
    const sys = this.systems.of(this.exoHost(i));
    if (!sys) return null;
    const name = this.systems.planetName(i, k);
    const pl = sys.planets.find((p) => p.name === name) ?? sys.planets[k] ?? null;
    if (pl) sys.update(this.clock.jdTdb);
    return pl;
  }

  // ------------------------------------------------------------------ per-frame helpers
  /** camera-relative vector -> CSS pixel coordinates; null if behind the camera */
  project(rel: Vector3, fixed = false): { x: number; y: number } | null {
    const v = rel.clone().applyQuaternion(this.invQuat);
    if (v.z >= 0) return null;
    // (counted from the optical centre, which is (cx, cy) off the middle of the view; `fixed`: as a
    // thing hung on the screen is drawn, the cockpit's frame, which stays where it is when the centre moves)
    const t = Math.tan((this.view.fovY * Math.PI) / 360);
    const aspect = this.view.aspect;
    const nx = v.x / -v.z / (t * aspect);
    const ny = v.y / -v.z / t;
    return { x: (nx * 0.5 + 0.5) * this.view.width + (fixed ? 0 : this.view.cx), y: (-ny * 0.5 + 0.5) * this.view.height + (fixed ? 0 : this.view.cy) };
  }

  /**
   * Ease the optical centre (what is straight ahead, and what the camera holds the selected world
   * at) to the middle of the part of the view the interface leaves clear (Hud.clearPart): about
   * 0.3 s to settle. Not in a headset, nor on foot; upright and with the interface put away it is
   * the middle.
   */
  private updateCentre(dt: number): void {
    const want = this.vr.active || this.walk.active ? null : this.hud.clearPart();
    const wx = want?.x ?? 0, wy = want?.y ?? 0, k = 1 - Math.exp(-dt / 0.1);
    const c = this.centre;
    c.x += (wx - c.x) * k;
    c.y += (wy - c.y) * k;
    if (Math.abs(wx - c.x) < 0.05) c.x = wx;
    if (Math.abs(wy - c.y) < 0.05) c.y = wy;
    this.rig.centre.x = c.x;
    this.rig.centre.y = c.y;
  }

  /** `meterInv` and `meterView`: the screen's window as the exposure meters it (src/app/Exposure.ts) */
  private meterInverse(): void {
    const v = this.view;
    meterFrame({ fovY: v.fovY, aspect: v.aspect, height: v.height, cx: v.xr ? 0 : v.cx, cy: v.xr ? 0 : v.cy }, this.invQuat, this.meterInv, this.meterView);
    this.meterView.quat.copy(this.view.quat);
  }

  private chooseAnchor(): void {
    // (a watch's frame, or a new world's while it is put in place, rides with what it is framed round)
    const framed = this.framed;
    if (framed?.valid && (this.watch.state !== 'idle' || this.glide || this.mover.placing)) { this.rig.setAnchor(shownOf(framed)); return; }
    let best: Body | null = null;
    let bestSoi = Infinity;
    const rel = new Vector3();
    for (const b of this.system.bodies) {
      if (!b.valid) continue;
      const soi = b.soiRadius();
      if (soi >= bestSoi) continue;
      const d = b.upos.sub(this.rig.upos, rel).length();
      if (d < soi) { best = b; bestSoi = soi; }
    }
    // close to a ship (game mode) or a spacecraft: ride along with it
    for (const st of this.game.traffic.stations) {
      if (st.upos.sub(this.rig.upos, rel).length() < 3000) { this.rig.setAnchor(st); return; }
    }
    for (const sh of this.game.traffic.ships) {
      if (sh.upos.sub(this.rig.upos, rel).length() < sh.radius * 300) { this.rig.setAnchor(sh); return; }
    }
    for (const cv of this.craft.views) {
      if (cv.dist < Math.max(300 * cv.craft.radius, 2000)) { this.rig.setAnchor(cv.craft); return; }
    }
    // an exoplanet whose Hill sphere we are in (planets of other stars carry the camera along)
    if (!best) {
      // (the planet the camera already rides with is judged by where it is now: its system may not have been in view a frame
      // ago, as when a link has just put the camera at it, and a planet without a view yet would let the camera go)
      const held = this.rig.anchor;
      if (held instanceof ExoPlanet && held.upos.sub(this.rig.upos, rel).length() < held.hill) return;
      let bestExo: ExoPlanet | null = null;
      let bestD = Infinity;
      for (const ev of this.exo.views) {
        if (ev.dist < ev.planet.hill && ev.dist < bestD) { bestExo = ev.planet; bestD = ev.dist; }
      }
      if (bestExo) { this.rig.setAnchor(bestExo); return; }
    }
    const sel = this.selection;
    if (sel instanceof Comet) {
      const d = sel.upos.sub(this.rig.upos, rel).length();
      if (d < 1e9) { this.rig.setAnchor(sel); return; }
    }
    if (sel && this.isCompanion(sel) && sel.upos.sub(this.rig.upos, rel).length() < sel.radius * 60) {
      this.rig.setAnchor(sel);
      return;
    }
    // The world the camera turns and zooms round keeps carrying it, zoomed out beyond the reach of its planet's own pull
    // (a planet and its moons seen together, a moon put far out): left to its star's alone, the camera stayed where it
    // was while the planet went on round its star, and with time running fast the worlds it was looking at flew out of
    // the view, still the target (the owner, 27 Nov 2026). Out to many times that reach; further, its star again.
    const home = this.rig.autopilot ? null : planetOf(this.rig.target);
    if (home?.valid && (!best || best.kind === 'star') && home.upos.sub(this.rig.upos, rel).length() < HOME_REACH * home.soiRadius()) best = home;
    this.rig.setAnchor(best);
  }

  /** the world (a body, or a planet of another star) whose surface is the nearest thing to the camera, and how high above it */
  private nearWorld: { obj: SpaceObject; alt: number } | null = null;

  private computeAltitude(): number {
    let alt = Infinity;
    let world: SpaceObject | null = null;
    const rel = new Vector3();
    // above the landing terrain, the height of the ground below
    const tb = this.terrain.owner;
    const below = this.terrain.below(this.rig.upos);
    if (below) { alt = below.dist - below.ground; world = tb as SpaceObject; }
    for (const b of this.system.bodies) {
      if (!b.valid || b === tb) continue;
      const d = b.upos.sub(this.rig.upos, rel).length() - b.radius;
      if (d < alt) { alt = d; world = b; }
    }
    for (const ev of this.exo.views) if (ev.planet !== tb && ev.dist - ev.planet.radius < alt) { alt = ev.dist - ev.planet.radius; world = ev.planet; }
    const worldAlt = alt;
    if (this.selection instanceof Comet) alt = Math.min(alt, this.selection.upos.sub(this.rig.upos, rel).length() - Math.max(this.selection.radius, 2000));
    alt = Math.min(alt, this.nearestStarDist);
    for (const cv of this.craft.views) alt = Math.min(alt, cv.dist - cv.craft.radius);
    for (const st of this.game.traffic.stations) alt = Math.min(alt, st.upos.sub(this.rig.upos, rel).length() - st.radius * 0.5);
    for (const h of this.blackHoles) {
      alt = Math.min(alt, h.upos.sub(this.rig.upos, rel).length() - h.radius);
      if (h.companion) alt = Math.min(alt, h.companion.upos.sub(this.rig.upos, rel).length() - h.companion.radius);
    }
    this.nearWorld = world && worldAlt <= alt ? { obj: world, alt: Math.max(worldAlt, 0) } : null;
    return Math.max(alt, 0.5);
  }

  /** the orientation, at the previous frame, of the world whose ground is under the camera */
  private carried: { owner: object; q: Quaternion } | null = null;

  /**
   * Near the ground the camera turns with the world, so the ground stays put under it instead of
   * sliding by at the world's spin (465 m/s at Earth's equator), and the sky wheels overhead when
   * time runs fast. From afar it does not: a planet is seen to rotate. Fully below 2 % of the
   * radius above the ground, not at all above 20 %, part of the turn in between. Walking and the
   * ship have frames of their own, and a flight under way is flown about the centre.
   */
  private carryWithGround(): void {
    const world = this.terrain.current;
    const below = world ? this.terrain.below(this.rig.upos) : null;
    if (!world || !below) { this.carried = null; return; }
    const q = new Quaternion().setFromRotationMatrix(world.orient);
    const before = this.carried?.owner === world.ground.owner ? this.carried.q : null;
    this.carried = { owner: world.ground.owner, q };
    // (only a camera that moves with that world's centre: beside a spacecraft in orbit it keeps to the spacecraft)
    if (!before || this.rig.anchor !== world.ground.owner || this.rig.autopilot || this.walk.walking || this.game.flight.on) return;
    const share = 1 - smoothstep(0.02, 0.2, (below.dist - below.ground) / below.ground);
    if (share <= 0) return;
    // the world's turn since the last frame, and the share of it the camera takes
    const turn = q.clone().multiply(before.clone().invert());
    this.rig.carry(below.centre, new Quaternion().slerp(turn, share));
  }

  /**
   * Tell the camera what it has to work with this frame: its target as a pointer finds it (the
   * surface under the camera, how close zooming may come) and which way is up when a world is near.
   */
  private describeSurroundings(): void {
    const rig = this.rig, t = rig.target;
    const below = this.terrain.below(rig.upos);
    rig.surface = 0;
    rig.closest = 1;
    if (t && t === this.terrain.owner && below) {
      // over the landing terrain: the ground itself, down to eye height
      rig.surface = below.ground;
      rig.closest = below.ground + EYE_HEIGHT;
    } else if (t instanceof Body || t instanceof ExoPlanet || t instanceof CatalogStar) {
      rig.surface = t.radius;
      rig.closest = t.radius * 1.002;
    } else if (t instanceof BlackHole) rig.closest = t.radius * 1.5;
    else if (t instanceof Galaxy || t instanceof DeepSkyObject || t instanceof MilkyWay) rig.closest = t.radius * 0.02; // into it
    else if (t instanceof Landmark) rig.closest = 30;
    else if (t instanceof RingSpot) rig.closest = 5;
    else if (t) rig.closest = Math.max(t.radius * 1.5, 2);
    // within a radius of a world its vertical takes over: looking round keeps the horizon level
    const w = this.nearWorld;
    rig.verticalWeight = 0;
    if (w) {
      const d = rig.upos.sub(w.obj.upos, rig.vertical).length();
      if (d > 0) {
        rig.vertical.divideScalar(d);
        rig.verticalWeight = 1 - smoothstep(0.25, 1, w.alt / Math.max(w.obj.radius, 1));
      }
    }
  }

  /** Registry of selectable catalogue stars, keyed by octree node and slot. */
  get catalog(): StarCatalog {
    return this.catalogs[0];
  }

  getStar(cat: StarCatalog, node: number, slot: number): CatalogStar {
    const key = `star:${cat.id}:${node}:${slot}`;
    let cs = this.starCache.get(key);
    const n = cat.nodes[node];
    // named stars belong to the primary (AT-HYG) catalogue
    const nm = cat === this.catalog ? this.named.byNodeSlot.get(`${node}:${slot}`) : undefined;
    if (!cs) {
      const ref = { catalog: cat, node: n, slot };
      if (n.state === 'ready') {
        cs = new CatalogStar(key, cat.starPosition(ref), cat.starAbsMag(ref), nm?.teff ?? cat.starTeff(ref), nm?.spect ?? '', nm?.names ?? [], ref);
        cs.exact = true;
      } else {
        cs = new CatalogStar(key, nm!.pos.clone(), nm!.absMag, nm!.teff, nm!.spect, nm!.names, ref);
      }
      if (!nm) cs.resolve(this.named, () => undefined);
      // (its temperature's source, and Gaia's temperature where that is used: before it is seen close)
      cs.describeTemperature(() => undefined);
      this.starCache.set(key, cs);
    } else if (!cs.exact && n.state === 'ready') {
      // the name list's position (rounded, and from a different reduction) can be hundreds of AU
      // off the catalogue's: an explorer parked at the star (arrived, or started there) moves with it
      const before = cs.upos.clone();
      cs.setPosition(cat.starPosition({ catalog: cat, node: n, slot }));
      cs.exact = true;
      const shift = cs.upos.sub(before, new Vector3());
      const away = before.sub(this.rig.upos, new Vector3()).length();
      // (an explorer anchored to the star, or to anything that moves with it — its planets and
      // their moons — already follows its anchor: rig.followAnchor; shifting again moved it twice)
      const movesWithStar = (o: unknown): boolean => {
        let x = o as { system?: { host?: unknown }; parentObject?: unknown } | null;
        for (let i = 0; x && i < 6; i++) {
          if (x === cs) return true;
          x = (x.system?.host ?? x.parentObject ?? null) as typeof x;
        }
        return false;
      };
      if (!movesWithStar(this.rig.anchor) && shift.lengthSq() > 0 && away < Math.max(1000 * cs.radius, 50 * shift.length())) this.rig.upos.addVec(shift, 1);
    }
    return cs;
  }

  private updateNearStars(): void {
    // Nearest catalogue stars (for speed control and individual rendering)
    let nearestNamed = Infinity;
    for (const s of this.named.list) {
      const d = s.pos.distanceTo(this.camPc);
      if (d < nearestNamed) nearestNamed = d;
    }
    const near = this.catalogs
      .flatMap((c) => c.nearest(this.camPc, Math.max(NEAR_STAR_RADIUS, Math.min(1, nearestNamed)), 12))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 12);
    const nearestCat = near.length ? near[0].dist : Infinity;
    // Lower bound on the distance of any star the star field draws (half, for motion between updates)
    const searchR = Math.max(NEAR_STAR_RADIUS, Math.min(1, nearestNamed));
    const beyond = near.find((x) => x.dist > NEAR_STAR_RADIUS);
    const bound = beyond ? beyond.dist : near.length < 12 ? searchR : NEAR_STAR_RADIUS;
    this.fieldMinDistPc = Math.min(bound, nearestNamed > NEAR_STAR_RADIUS ? nearestNamed : bound) * 0.5;
    this.nearestStarDist = Math.min(nearestNamed, nearestCat) * PC;
    const list: CatalogStar[] = [];
    for (const { ref, dist } of near) {
      if (dist > NEAR_STAR_RADIUS) break;
      const cs = this.getStar(ref.catalog, ref.node.id, ref.slot);
      list.push(cs);
      // nearest star surface distance
      this.nearestStarDist = Math.min(this.nearestStarDist, dist * PC - cs.radius);
    }
    for (const h of this.blackHoles) {
      if (h.companion && h.companion.upos.sub(this.rig.upos, new Vector3()).length() < COMPANION_RADIUS * PC) list.push(h.companion);
    }
    for (const { star, dist } of this.procStars.nearest(this.camPc, 1, 12)) {
      this.nearestStarDist = Math.min(this.nearestStarDist, dist * PC - star.radius);
      if (dist < NEAR_STAR_RADIUS) list.push(star);
    }
    // planetary systems of the stars around us; claim archive systems for their catalogue stars
    const systems: PlanetarySystem[] = [];
    for (const st of list) {
      if (this.isCompanion(st)) continue;
      const sys = this.systems.of(st);
      if (sys) systems.push(sys);
    }
    // confirmed-planet hosts the catalogues lack (or know only under another name)
    const tmp = new Vector3();
    for (const i of this.systems.hostsNear(this.camPc, NEAR_STAR_RADIUS)) {
      const h = this.systems.hostStar(i);
      const claimedBy = this.systems.claimedBy(i);
      if (claimedBy && list.some((x) => x.key === claimedBy)) continue;
      // the same star from a catalogue: same place (within catalogue distance errors) and brightness
      const twin = list.find((x) => !this.isCompanion(x) && x.upos.sub(h.upos, tmp).length() < 0.03 * PC && Math.abs(x.absMag - h.absMag) < 1.5);
      if (twin) {
        this.systems.claim(twin, i);
        const at = systems.findIndex((y) => y.host === twin);
        const sys = this.systems.of(twin);
        if (at >= 0) systems.splice(at, 1);
        if (sys) systems.push(sys);
        continue;
      }
      list.push(h);
      this.nearestStarDist = Math.min(this.nearestStarDist, h.upos.sub(this.rig.upos, tmp).length() - h.radius);
      const sys = this.systems.of(h);
      if (sys) systems.push(sys);
    }
    // [catalog] visited catalogue stars the star tiles lack (brown dwarfs, pulsars, faint white dwarfs)
    for (const st of this.objCatalog?.nearStars(this.camPc, NEAR_STAR_RADIUS) ?? []) {
      if (list.includes(st) || list.some((x) => x.upos.sub(st.upos, tmp).length() < 0.03 * PC && Math.abs(x.absMag - st.absMag) < 1.5)) continue;
      list.push(st);
      this.nearestStarDist = Math.min(this.nearestStarDist, st.upos.sub(this.rig.upos, tmp).length() - st.radius);
    }
    // (a star live physics has taken away is not drawn)
    const live = this.exoSim?.source.system.live;
    this.near.stars = live ? list.filter((st) => !live.gone(st)) : list;
    this.nearSystems = systems;
  }

  /** A planet is labelled/pickable once resolved, or while the explorer is inside its system. */
  private exoShown(ev: ExoView): boolean {
    if (ev.pixelRadius >= 0.8 || ev.planet === this.selection) return true;
    const host = ev.planet.system.host;
    const dHost = host.upos.sub(this.rig.upos, new Vector3()).length();
    return dHost < Math.max(400 * AU, ev.planet.spec.aM * 25);
  }

  /** Spacecraft are labelled/pickable once resolved, when selected, or when near enough to find. */
  private craftShown(cv: CraftView): boolean {
    if (cv.pixelRadius > 0.5 || cv.craft === this.selection) return true;
    const reach = cv.craft.isOrbiter ? 3e7 : cv.craft.parentObject ? 5e9 : 0.3 * AU;
    return cv.dist < reach;
  }

  /** Systems to draw: the stars' around us, plus those of a selected or targeted planet or host. */
  private updateActiveSystems(): void {
    const act = [...this.nearSystems];
    for (const o of [this.selection, this.rig.target]) {
      let sys: PlanetarySystem | null = null;
      if (o instanceof ExoPlanet) sys = o.system;
      else if (o instanceof CatalogStar && !this.isCompanion(o) && o.upos.sub(this.rig.upos, new Vector3()).length() < 0.5 * PC) sys = this.systems.of(o);
      if (sys && !act.includes(sys)) act.push(sys);
    }
    this.activeSystems = act;
  }

  /**
   * Fraction of the view a sphere covers, from angles: for bodies so close that their centre may be
   * behind the camera (standing on a surface, skimming it).
   */
  /**
   * Radiance of the daytime sky when the explorer is inside a sunlit atmosphere (0 otherwise):
   * the zenith Rayleigh optical depth (green) times the sunlight, fading through twilight.
   */
  private skyRadiance(): number {
    let best = 0;
    const rel = new Vector3();
    const sky = (tau: number, up: Vector3, sunDir: Vector3, sunIrr: number) => {
      const t = Math.min(1, Math.max(0, (up.dot(sunDir) + 0.1) / 0.2));
      best = Math.max(best, Math.min(1, tau) * (sunIrr / Math.PI) * t * t * (3 - 2 * t));
    };
    for (const v of this.bodies.views.values()) {
      if (!v.resolved || v.body.kind === 'star') continue;
      const spec = this.atmospheres.spec(v.body);
      if (!spec || v.dist > v.body.radius + spec.top * 0.5) continue;
      if (!v.sun) continue;
      const up = rel.copy(v.rel).negate().normalize();
      const toSun = v.sun.upos.sub(v.body.upos, new Vector3());
      const d = toSun.length();
      sky(spec.betaR[1] * spec.HR, up.clone(), toSun.divideScalar(d), sunIrradianceAt(d, this.system.brightness(v.sun)));
    }
    for (const e of this.exo.atmospheres()) {
      if (e.rel.length() > e.radius + e.spec.top * 0.5) continue;
      sky(e.spec.betaR[1] * e.spec.HR, e.rel.clone().negate().normalize(), e.sunDir, e.sunIrr);
    }
    return best;
  }

  /** Radiance of the sunlit ring ice around the explorer (0 when not inside Saturn's rings). */
  private ringRadiance(): number {
    const rp = this.bodies.ringParticles;
    const sat = this.system.bodies.find((b) => b.name === 'Saturn');
    const sun = sat && this.system.sunAt(sat.pos);
    if (!(rp?.mesh.visible || rp?.slabActive) || !sat || !sun) return 0;
    return (0.6 * sunIrradianceAt(Math.max(sat.pos.distanceTo(sun.pos), 1), this.system.brightness(sun))) / Math.PI;
  }

  /** A body's albedo for the exposure: near its ground, the eye adapts to the ground around (TerrainPatch.exposureAlbedo). */
  private surfaceAlbedo(b: Body): number {
    return this.terrain.owner === b ? this.terrain.exposureAlbedo(b.albedo) : b.albedo;
  }

  private seenScratch = new Vector3();

  /**
   * The share of a sun's disc (from the eye: `rel`, `radius`) that no world stands in front of. A
   * sun behind a world shines on nothing the eye sees: it holds no exposure and throws no glare
   * (in a planet's shadow the stars are out, and the planet's night side is there to be seen).
   */
  private inSight(rel: Vector3, radius: number): number {
    let share = 1;
    for (const v of this.bodies.views.values()) {
      if (v.resolved && v.body.kind !== 'star') share = Math.min(share, 1 - hidden(rel, radius, v.rel, v.body.radius));
    }
    for (const ev of this.exo.views) share = Math.min(share, 1 - hidden(rel, radius, ev.rel, ev.planet.radius));
    return share;
  }

  /**
   * The exposures of this frame: `xSurf` for surfaces, `xLight` for a sun's own face, `xStar` for
   * the stars and what glows among them, the limiting magnitude that goes with it, and `xDark`,
   * the exposure of an eye in the dark.
   *
   * The eye settles on the largest bright thing in view (a sunlit world at mid-grey, a star's or a
   * hot disk's face brighter), and nothing in view is shown brighter than its limit. "In view" is
   * measured by how much of the thing is in the frame (src/app/Exposure.ts), so the limits let go
   * gradually as it leaves, and the eye opens up slowly and shuts quickly (adapt).
   *
   * A sun in the frame puts out the stars, and its own face is shown at a sun's level; the worlds
   * beside it stay exposed for themselves. (They used to go down with it: with the Sun a few
   * pixels wide anywhere in the frame, the planet being looked at was black.)
   */
  private updateExposure(dt: number): { xStar: number; xSurf: number; xLight: number; mLim: number; xDark: number } {
    const pixSA = (this.view.pixelAngle * this.view.pixelRatio) ** 2; // per CSS pixel
    const xDark = (0.01 * pixSA) / magToIrradiance(this.starMagLimit);
    const open = Math.log(xDark);
    const look = (rel: Vector3, radius: number) => seen(rel, radius, this.meterView, this.seenScratch, this.meterInv);
    // what the eye settles on: the bright thing covering most of the frame, its radiance, and the
    // display level a frame-filling one is shown at
    let wBest = 0, lBest = 1, keyBest = 0.45, meanBest = false;
    // (`mean`: the eye follows the frame's mean light as the thing comes to fill it, Exposure.settleOn;
    // a black hole's disk, a thousand million times brighter than the dark. Otherwise the eye goes
    // from the dark's exposure to the thing's key in the logarithm, by its weight: a star's face
    // coming in at the frame's edge does not take the eye over at a hundredth of the frame.)
    const settle = (coverage: number, radiance: number, key: number, mean = false) => {
      const w = smoothstep(0.0015, 0.08, coverage);
      if (w > wBest && radiance > 0) { wBest = w; lBest = radiance; keyBest = key; meanBest = mean; }
    };
    // the limits (log exposure): a lit surface holds the surface exposure down, a sun or a
    // daylit sky the stars' too
    let surfaceLimit = Infinity, lightLimit = Infinity;
    const limitSurface = (level: number, radiance: number, presence: number) => {
      if (radiance > 0) surfaceLimit = Math.min(surfaceLimit, released(Math.log(level / radiance), open, presence));
    };
    const limitLight = (level: number, radiance: number, presence: number) => {
      if (radiance > 0) lightLimit = Math.min(lightLimit, released(Math.log(level / radiance), open, presence));
    };
    // (lit by the sun brightest in its sky; in a system without one, by nothing)
    const litBy = (sun: Body | null, distToSun: number, albedo: number) => (sun ? (albedo * sunIrradianceAt(Math.max(distToSun, 1), this.system.brightness(sun))) / Math.PI : 0);

    // A lit disc holds the surfaces' exposure from the size at which it is drawn as one (each
    // layer's own: BodiesLayer `resolved`, a planet of another star 0.8 px, a spacecraft 0.6): a
    // disc a pixel wide that did not would be drawn ten thousand times too bright with the eye
    // open for the dark, and bloom into a ball of light (a moon of Jupiter from Jupiter; with the
    // worlds exposed for themselves beside a sun, a small planet next to its star).
    for (const v of this.bodies.views.values()) {
      if (!v.resolved) continue;
      const b = v.body;
      const s = look(v.rel, b.radius);
      if (b.kind === 'star') {
        if (v.pixelRadius <= 1.5) continue;
        const L = (AU / SUN_RADIUS) ** 2;
        const shown = this.inSight(v.rel, b.radius);
        if (v.pixelRadius >= 2) settle(s.coverage * shown, L, FACE_KEY);
        // (a small Sun is shown glaring)
        limitLight(starCap(1.8, v.pixelRadius / this.view.pixelRatio), L, s.presence * shown);
        continue;
      }
      // In the world's own shadow none of its sunlit face is in sight (the Sun behind it, the side
      // turned to the eye is all night): what is left to see of it, the lights of its night side
      // and the twilight round its limb, is NIGHT times fainter at the most.
      // (Rings reach out of the shadow and shine as the world does, well beyond its disc.)
      const rings = this.bodies.ringOuter(b);
      const sunRel = v.sun && this.bodies.views.get(v.sun)?.rel;
      const night = rings > 0 || !sunRel ? 1 : 1 + (NIGHT - 1) * hidden(sunRel, SUN_RADIUS, v.rel, b.radius);
      // (in a system without a sun a world is seen by its own lights, if it has any)
      const L = v.sun ? (litBy(v.sun, b.pos.distanceTo(v.sun.pos), Math.min(1, 1.5 * this.surfaceAlbedo(b))) * (this.bodies.sunlit.get(b) ?? 1)) / night : this.bodies.ownLight(b);
      if (v.pixelRadius >= 2) settle(s.coverage, L, 0.45);
      limitSurface(1.6, L, rings > 0 ? Math.max(s.presence, look(v.rel, rings).presence) : s.presence);
    }
    for (const cv of this.craft.views) {
      if (cv.pixelRadius <= 0.6) continue;
      const s = look(cv.rel, cv.craft.radius);
      const sun = this.system.suns[0] ?? null;
      const L = litBy(sun, sun ? cv.craft.upos.sub(sun.upos, new Vector3()).length() : 0, 0.6);
      if (cv.pixelRadius >= 2) settle(s.coverage, L, 0.45);
      limitSurface(1.6, L, s.presence);
    }
    const nucleus = this.cometTails.nucleusView;
    if (nucleus) {
      const s = look(nucleus.rel, nucleus.radius);
      if (s.size / this.view.pixelAngle / this.view.pixelRatio > 2) settle(s.coverage, nucleus.radiance, 0.45);
      // (a comet nucleus is very dark rock: shown grey, not as bright as a planet's disc)
      limitSurface(1.0, nucleus.radiance, s.presence);
    }
    for (const ev of this.exo.views) {
      if (ev.pixelRadius <= 0.8 || ev.radiance <= 0) continue;
      const s = look(ev.rel, ev.planet.radius);
      if (ev.pixelRadius >= 2) settle(s.coverage, ev.radiance, 0.45);
      limitSurface(1.6, ev.radiance, ev.planet.spec.rings ? Math.max(s.presence, look(ev.rel, ev.planet.radius * EXO_RING_REACH).presence) : s.presence);
    }
    // inside Saturn's rings the ice around the explorer is a lit surface filling much of the view
    const ringL = this.ringRadiance();
    if (ringL > 0) {
      settle(0.12, ringL, 0.45);
      limitSurface(1.6, ringL, 1);
    }
    for (const hv of [...this.holes.views, ...this.holes.far]) {
      if (!hv.diskRadiance) continue;
      const peak = hv.bh.diskInner * DISK_PEAK_RADIUS;
      const shown = (r: number, approach: number) => this.holes.shownAt(hv.bh, r, approach);
      // The middle of the disk (its bright ring; from far off, all of it) is drawn with an
      // exposure of its own at the most, which is a matter of where the eye is and of nothing
      // else: so its light is steady, and only ever falls as the eye moves off. (Held by the
      // scene's exposure alone it was a ball of light as soon as it was small in the frame, and
      // swelled and shrank behind every move as the eye caught up.)
      const middle = diskMiddle(hv.rel, hv.bh.diskNormal, 2 * peak, this.meterView, pixSA, this.seenScratch, this.meterInv);
      hv.middle.radius = middle.radius;
      hv.middle.exposure = Math.exp(Math.min(open, middleLimit(middle, shown, hv.bh.diskInner, this.holes.radianceAt(hv.bh, peak), DISK_KEY, pixSA, open)));
      // A disk is brightest at its inner edge and fades outwards, and its centre is often out of
      // frame while the disk fills it: the eye is set by the brightest part that is in view.
      // Close to the hole its gravity wraps the disk's picture round it: there it is measured
      // as a ball, out to four times the radius of the brightest part in view.
      const whole = look(hv.rel, hv.bh.diskOuter);
      const nearest = Math.max(peak, hv.dist * Math.sin(Math.min(Math.PI / 2, Math.max(0, whole.angle - whole.halfFrame))));
      // The inner edge is shown glaring (it blooms): with the hole itself in the frame, the eye is set for that.
      const glare = smoothstep(3, 1, nearest / peak);
      // Away from the hole the disk is flat, and from within its own radius it lies all round
      // the eye: whichever part of it is in the frame holds the exposure, from any side, and
      // is shown as a glowing surface, under the display's white.
      const flat = diskSeen(hv.rel, hv.bh.diskNormal, hv.bh.diskInner, hv.bh.diskOuter, this.meterView, this.meterInv);
      surfaceLimit = Math.min(surfaceLimit, diskLimit(flat, shown, 0.9 * (1 + DISK_GLARE * glare), open));
      const L = this.holes.radianceAt(hv.bh, nearest);
      const bright = look(hv.rel, Math.min(4 * nearest, hv.bh.diskOuter));
      if (bright.size / this.view.pixelAngle / this.view.pixelRatio <= 1.5) continue;
      settle(bright.coverage, L, DISK_KEY, true);
      // (a hot inner disk only takes over the eye once it covers part of the view)
      limitSurface((0.9 + 1.1 * glare) / Math.max(smoothstep(0.0015, 0.08, bright.coverage), 1e-6), L, whole.presence);
    }
    // (unresolved point sources never drive the exposure: their displayed glare is capped in the PSF)
    for (const st of this.near.stars) {
      const rel = st.upos.sub(this.rig.upos, new Vector3());
      const d = rel.length();
      const s = look(rel, st.radius);
      const L = (magToIrradiance(st.absMag + 5 * Math.log10(d / PC) - 5) * d * d) / (Math.PI * st.radius * st.radius);
      const shown = this.inSight(rel, st.radius);
      settle(s.coverage * shown, L, FACE_KEY);
      const px = s.size / this.view.pixelAngle;
      if (px <= 1.5) continue;
      limitLight(starCap(1.4, px / this.view.pixelRatio), L, s.presence * shown);
    }
    // under a daytime sky the eye adapts to the sky: the stars fade out, and the sky itself is a lit surface
    const sky = this.skyRadiance();
    if (sky > 0) {
      const limit = Math.log(1.2 / sky);
      surfaceLimit = Math.min(surfaceLimit, limit);
      lightLimit = Math.min(lightLimit, limit);
    }

    const settled = meanBest ? settleOn(open, wBest, lBest, keyBest) : wBest > 0 ? Math.min(open, open + (Math.log(keyBest / lBest) - open) * wBest) : open;
    const target = Math.min(settled, surfaceLimit);
    const lightTarget = Math.min(target, lightLimit);
    const first = this.frameCount < 3;
    this.logExposure = first ? target : adapt(this.logExposure, target, dt);
    this.logLight = first ? lightTarget : adapt(this.logLight, lightTarget, dt);
    const xSurf = Math.exp(this.logExposure);
    const xLight = Math.exp(Math.min(this.logLight, this.logExposure));
    // Stars keep a floor exposure (artistic, SpaceEngine-like) unless a star or a daylit sky is in view.
    const starTarget = Math.min(lightLimit, open);
    this.logStarCap = first ? starTarget : adapt(this.logStarCap, starTarget, dt, TAU_STARS);
    const xStar = Math.min(Math.exp(this.logStarCap), Math.max(xSurf, xDark * this.starFloor));
    const minEnergy = this.starFields[0].psf.uMinEnergy.value;
    const mLim = irradianceToMag((minEnergy * pixSA) / xStar);
    return { xStar, xSurf, xLight, mLim, xDark };
  }

  /**
   * What a click or a tap at a point of the view means: the object under it, or the one whose label
   * is under it. A finger covers more than a mouse pointer: it reaches FINGER_REACH pixels.
   */
  pickAt(x: number, y: number, touch = false): SpaceObject | null {
    const reach = touch ? FINGER_REACH : POINTER_REACH;
    const label = this.labels.at(x, y, touch ? 8 : 2);
    return (label ? this.pick(label.x, label.y, reach) : null) ?? this.pick(x, y, reach);
  }

  /** The object drawn nearest to a point of the view (CSS px), within `reach` pixels of it or under it. */
  private pick(cx: number, cy: number, reach = POINTER_REACH): SpaceObject | null {
    let best: SpaceObject | null = null;
    let bestScore = Infinity;
    const consider = (obj: SpaceObject, p: { x: number; y: number } | null, radiusPx: number, bias: number) => {
      if (!p) return;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > Math.max(radiusPx, reach)) return;
      const s = d + bias;
      if (s < bestScore) { bestScore = s; best = obj; }
    };
    // Overlapping galaxies are not a nearest-centre contest: the one the view is framed on wins,
    // then the biggest on screen. Their whole drawn discs count, however far the centre is away.
    const galaxy: { best?: { obj: SpaceObject; radiusPx: number; score: number } } = {};
    const considerGalaxy = (obj: SpaceObject, p: { x: number; y: number } | null, radiusPx: number) => {
      if (!p) return;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > Math.max(radiusPx, reach)) return;
      const score = d + 2, framed = obj === this.rig.target;
      if (galaxy.best) {
        const oldFramed = galaxy.best.obj === this.rig.target;
        if (oldFramed && !framed) return;
        if (oldFramed === framed && (radiusPx < galaxy.best.radiusPx || (radiusPx === galaxy.best.radiusPx && score >= galaxy.best.score))) return;
      }
      galaxy.best = { obj, radiusPx, score };
    };
    const mLim = this.lastMLim;
    for (const v of this.bodies.views.values()) {
      if (!v.resolved && v.apparentMag > mLim + 1.5 && !this.namedInTheDark(v)) continue;
      consider(v.body, this.project(v.rel), v.pixelRadius / this.view.pixelRatio, v.resolved ? -6 : -3);
    }
    const rel = new Vector3();
    for (const c of this.small.cometObjects) {
      if (c.apparentMag > mLim) continue;
      consider(c, this.project(c.upos.sub(this.rig.upos, rel)), 0, 0);
    }
    for (const ev of this.exo.views) if (this.exoShown(ev)) consider(ev.planet, this.project(ev.rel), ev.pixelRadius / this.view.pixelRatio, ev.pixelRadius > 2 ? -6 : -3);
    for (const cv of this.craft.views) if (this.craftShown(cv)) consider(cv.craft, this.project(cv.rel), cv.pixelRadius / this.view.pixelRatio, -5);
    for (const gv of this.galaxies.views) if (gv.pixelRadius >= 2.5) considerGalaxy(gv.galaxy, this.project(gv.rel), gv.pixelRadius / this.view.pixelRatio);
    if (this.mwVolume.mesh.visible) {
      const r = this.milkyWay.upos.sub(this.rig.upos, new Vector3());
      const radiusPx = Math.atan2(this.milkyWay.radius, r.length()) / this.view.pixelAngle / this.view.pixelRatio;
      if (radiusPx >= 2.5) considerGalaxy(this.milkyWay, this.project(r), radiusPx);
    }
    for (const dv of this.deepSky.views) if (dv.pixelRadius >= 3 && dv.dist > dv.obj.radius) consider(dv.obj, this.project(dv.rel), Math.min(dv.pixelRadius / this.view.pixelRatio, 80), 1.5);
    for (const sh of [...this.game.traffic.ships, ...this.game.traffic.stations]) {
      const r = sh.upos.sub(this.rig.upos, new Vector3());
      if (r.length() < 2e6) consider(sh, this.project(r), (Math.atan2(sh.radius, r.length()) / this.view.pixelAngle) / this.view.pixelRatio, -4);
    }
    for (const s of this.near.stars) consider(s, this.project(s.upos.sub(this.rig.upos, rel)), 0, -2);
    for (const { bh, rel: r, shadowPx } of this.labelledHoles()) consider(bh, this.project(r), shadowPx / this.view.pixelRatio, -4);
    if (galaxy.best && galaxy.best.score < bestScore) best = galaxy.best.obj;
    if (best) return best;
    // Catalogue stars currently drawn
    let bestRef: { cat: StarCatalog; node: number; slot: number } | null = null;
    const cam = this.camPc;
    for (const cat of this.catalogs) for (const n of cat.needed) {
      const pos = cat.cpuPositions(n);
      if (!pos || !n.absMag) continue;
      for (let i = 0; i < n.drawCount; i++) {
        rel.set(pos[i * 3] - cam.x, pos[i * 3 + 1] - cam.y, pos[i * 3 + 2] - cam.z);
        const d = rel.length();
        if (d < NEAR_STAR_RADIUS) continue;
        const m = n.absMag[i] + 5 * Math.log10(d) - 5;
        if (m > mLim) continue;
        const p = this.project(rel);
        if (!p) continue;
        const ds = Math.hypot(p.x - cx, p.y - cy);
        if (ds > starReach(reach, m)) continue;
        const s = ds + 0.4 * m;
        if (s < bestScore) { bestScore = s; bestRef = { cat, node: n.id, slot: i }; }
      }
    }
    let bestProc: (() => SpaceObject) | null = null;
    this.procStars.forEachVisible(cam, mLim, (r, m, star) => {
      if (r.length() < NEAR_STAR_RADIUS) return;
      const p = this.project(r);
      if (!p) return;
      const ds = Math.hypot(p.x - cx, p.y - cy);
      if (ds > starReach(reach, m)) return;
      const sc = ds + 0.4 * m;
      if (sc < bestScore) { bestScore = sc; bestProc = star; }
    });
    if (bestProc) return (bestProc as () => SpaceObject)();
    if (!bestRef) return null;
    return this.getStar(bestRef.cat, bestRef.node, bestRef.slot);
  }
  private lastMLim = 6;

  /**
   * Pick along a ray (VR controller). `origin` and `dir` are camera-relative,
   * world-oriented. Objects within ~1.5° of the ray (or under it) qualify.
   */
  pickRay(origin: Vector3, dir: Vector3): SpaceObject | null {
    const d = dir.clone().normalize();
    const surface = this.rayHitBody(origin, d);
    if (surface) return surface;
    const tol = (1.5 * Math.PI) / 180;
    let best: SpaceObject | null = null;
    let bestScore = Infinity;
    const tmp = new Vector3();
    const angleTo = (rel: Vector3) => {
      tmp.copy(rel).sub(origin);
      const len = tmp.length();
      return { ang: Math.acos(Math.max(-1, Math.min(1, tmp.dot(d) / len))), len };
    };
    const consider = (obj: SpaceObject, rel: Vector3, radius: number, bias: number) => {
      const { ang, len } = angleTo(rel);
      const size = Math.asin(Math.min(1, radius / Math.max(len, radius * 1.0001)));
      if (ang > Math.max(tol, size)) return;
      const score = ang / tol + bias;
      if (score < bestScore) { bestScore = score; best = obj; }
    };
    const mLim = this.lastMLim;
    for (const v of this.bodies.views.values()) {
      if (!v.resolved && v.apparentMag > mLim + 1.5) continue;
      consider(v.body, v.rel, v.body.radius, v.resolved ? -1 : -0.3);
    }
    const rel = new Vector3();
    for (const c of this.small.cometObjects) {
      if (c.apparentMag > mLim) continue;
      consider(c, c.upos.sub(this.rig.upos, rel).clone(), c.radius, 0);
    }
    for (const ev of this.exo.views) if (this.exoShown(ev)) consider(ev.planet, ev.rel, ev.planet.radius, ev.pixelRadius > 2 ? -1 : -0.3);
    for (const cv of this.craft.views) if (this.craftShown(cv)) consider(cv.craft, cv.rel, cv.craft.radius, -0.6);
    for (const gv of this.galaxies.views) if (gv.pixelRadius >= 2.5) consider(gv.galaxy, gv.rel, gv.galaxy.radius * 0.5, 0.5);
    for (const dv of this.deepSky.views) if (dv.pixelRadius >= 3 && dv.dist > dv.obj.radius) consider(dv.obj, dv.rel, dv.obj.radius * 0.6, 0.4);
    for (const sh of [...this.game.traffic.ships, ...this.game.traffic.stations]) {
      const r = sh.upos.sub(this.rig.upos, new Vector3());
      if (r.length() < 2e6) consider(sh, r, sh.radius, -0.6);
    }
    for (const st of this.near.stars) consider(st, st.upos.sub(this.rig.upos, rel).clone(), st.radius, -0.2);
    for (const { bh, rel: r } of this.labelledHoles()) consider(bh, r, bh.radius * 2.6, -0.5);
    if (best) return best;
    let bestRef: { cat: StarCatalog; node: number; slot: number } | null = null;
    const cam = this.camPc;
    const dpc = new Vector3();
    for (const cat of this.catalogs) for (const n of cat.needed) {
      const pos = cat.cpuPositions(n);
      if (!pos || !n.absMag) continue;
      for (let i = 0; i < n.drawCount; i++) {
        dpc.set(pos[i * 3] - cam.x, pos[i * 3 + 1] - cam.y, pos[i * 3 + 2] - cam.z);
        const dist = dpc.length();
        if (dist < NEAR_STAR_RADIUS) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, dpc.dot(d) / dist)));
        if (ang > tol) continue;
        const m = n.absMag[i] + 5 * Math.log10(dist) - 5;
        if (m > mLim) continue;
        const score = ang / tol + 0.08 * m;
        if (score < bestScore) { bestScore = score; bestRef = { cat, node: n.id, slot: i }; }
      }
    }
    let bestProc: (() => SpaceObject) | null = null;
    this.procStars.forEachVisible(cam, mLim, (r, m, star) => {
      const dist = r.length();
      if (dist < NEAR_STAR_RADIUS) return;
      const ang = Math.acos(Math.max(-1, Math.min(1, r.dot(d) / dist)));
      if (ang > tol) return;
      const score = ang / tol + 0.08 * m;
      if (score < bestScore) { bestScore = score; bestProc = star; }
    });
    if (bestProc) return (bestProc as () => SpaceObject)();
    return bestRef ? this.getStar(bestRef.cat, bestRef.node, bestRef.slot) : null;
  }

  /** Nearest resolved body whose sphere the ray actually hits (what you see along the ray). */
  private rayHitBody(origin: Vector3, d: Vector3): SpaceObject | null {
    let best: SpaceObject | null = null;
    let bestT = Infinity;
    const oc = new Vector3();
    for (const v of this.bodies.views.values()) {
      if (!v.resolved) continue;
      oc.copy(origin).sub(v.rel);
      const b = oc.dot(d);
      const c = oc.lengthSq() - v.body.radius * v.body.radius;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bestT) { bestT = t; best = v.body; }
    }
    for (const ev of this.exo.views) {
      if (ev.pixelRadius < 0.8) continue;
      oc.copy(origin).sub(ev.rel);
      const b = oc.dot(d);
      const disc = b * b - (oc.lengthSq() - ev.planet.radius * ev.planet.radius);
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bestT) { bestT = t; best = ev.planet; }
    }
    return best;
  }

  /**
   * Cheap ray pick for per-frame hover in VR: Solar System bodies, comets, nearby stars and
   * named stars (no scan of the full catalogue).
   */
  pickRayFast(origin: Vector3, dir: Vector3, tolDeg = 2): SpaceObject | null {
    const d = dir.clone().normalize();
    const surface = this.rayHitBody(origin, d);
    if (surface) return surface;
    const tol = (tolDeg * Math.PI) / 180;
    let best: SpaceObject | null = null;
    let bestScore = Infinity;
    const tmp = new Vector3();
    const consider = (obj: SpaceObject, rel: Vector3, radius: number, bias: number) => {
      tmp.copy(rel).sub(origin);
      const len = tmp.length();
      const ang = Math.acos(Math.max(-1, Math.min(1, tmp.dot(d) / len)));
      const size = Math.asin(Math.min(1, radius / Math.max(len, radius * 1.0001)));
      if (ang > Math.max(tol, size)) return;
      const score = ang / tol + bias;
      if (score < bestScore) { bestScore = score; best = obj; }
    };
    const mLim = this.lastMLim;
    for (const v of this.bodies.views.values()) {
      if (!v.resolved && v.apparentMag > mLim + 1.5) continue;
      if (this.occluded(v.rel, v.body)) continue;
      consider(v.body, v.rel, v.body.radius, v.resolved ? -1 : -0.3);
    }
    const rel = new Vector3();
    for (const c of this.small.cometObjects) {
      if (c.apparentMag > mLim) continue;
      consider(c, c.upos.sub(this.rig.upos, rel).clone(), c.radius, 0);
    }
    for (const ev of this.exo.views) if (this.exoShown(ev)) consider(ev.planet, ev.rel, ev.planet.radius, ev.pixelRadius > 2 ? -1 : -0.3);
    for (const cv of this.craft.views) if (this.craftShown(cv)) consider(cv.craft, cv.rel, cv.craft.radius, -0.6);
    for (const gv of this.galaxies.views) if (gv.pixelRadius >= 2.5) consider(gv.galaxy, gv.rel, gv.galaxy.radius * 0.5, 0.5);
    for (const dv of this.deepSky.views) if (dv.pixelRadius >= 3 && dv.dist > dv.obj.radius) consider(dv.obj, dv.rel, dv.obj.radius * 0.6, 0.4);
    for (const sh of [...this.game.traffic.ships, ...this.game.traffic.stations]) {
      const r = sh.upos.sub(this.rig.upos, new Vector3());
      if (r.length() < 2e6) consider(sh, r, sh.radius, -0.6);
    }
    for (const st of this.near.stars) consider(st, st.upos.sub(this.rig.upos, rel).clone(), st.radius, -0.2);
    for (const { bh, rel: r } of this.labelledHoles()) consider(bh, r, bh.radius * 2.6, -0.5);
    if (best) return best;
    const cam = this.camPc;
    let bestStar: { node: number; slot: number } | null = null;
    for (const s of this.named.list) {
      const dist = s.pos.distanceTo(cam);
      if (dist < NEAR_STAR_RADIUS) continue;
      const m = s.absMag + 5 * Math.log10(dist) - 5;
      if (m > Math.min(mLim, 6.5)) continue;
      rel.copy(s.pos).sub(cam);
      const ang = Math.acos(Math.max(-1, Math.min(1, rel.dot(d) / rel.length())));
      if (ang > tol) continue;
      const score = ang / tol + 0.1 * m;
      if (score < bestScore) { bestScore = score; bestStar = s; }
    }
    return bestStar ? this.getStar(this.catalog, bestStar.node, bestStar.slot) : null;
  }

  /** true if the segment camera -> rel is blocked by a resolved body or a black hole's shadow (other than `self`). */
  private occluded(rel: Vector3, self: SpaceObject | null): boolean {
    const dist = rel.length();
    for (const v of this.holes.views) {
      if (v.bh === self || v.dist > dist) continue;
      // shadow seen from the eye: angular radius asin(3√3/2 rs / d); objects behind it out to ~3
      // shadow radii are seen only as displaced, lensed images, so their labels would mislead
      const ang = Math.asin(Math.min(1, (2.598 * v.bh.radius) / v.dist));
      if (self !== v.bh.companion && rel.angleTo(v.rel) < 3 * ang) return true;
    }
    for (const o of this.occluders) {
      if (o.body === self) continue;
      if (o.dist > dist) continue;
      // low over the landing terrain, what lies beyond the ground's horizon is behind it where the
      // ground really stands along that bearing: a valley's walls, or the land falling away from a
      // summit (higher up, the sphere through the ground below is near enough, and far cheaper)
      if (o.low) {
        const dir = rel.clone().divideScalar(dist);
        const h = this.terrain.horizonAt(this.rig.upos, dir);
        if (h && dist > h.reach) {
          const elevation = -Math.asin(Math.max(-1, Math.min(1, dir.dot(o.rel) / o.rel.length())));
          if (elevation < h.elevation - HORIZON_LEEWAY) return true;
          continue;
        }
      }
      // ray-sphere test (camera at origin, direction rel/dist)
      const t = o.rel.dot(rel) / dist;
      if (t <= 0 || t > dist) continue;
      const d2 = o.rel.lengthSq() - t * t;
      // (a world's limb is let off by a quarter of a percent of its radius, so names just over it
      // stay; the ground's horizon is already set a little low, and that much would be kilometres)
      if (d2 < o.radius * o.radius * (o.exact ? 1 : 0.995)) return true;
    }
    return false;
  }
  private occluders: { body: object; rel: Vector3; dist: number; radius: number; exact?: boolean; low?: boolean }[] = [];

  /** Black holes worth a label/pick: near ones, ones being drawn, and the selection. */
  private labelledHoles(): { bh: BlackHole; rel: Vector3; shadowPx: number; diskPx: number }[] {
    const out: { bh: BlackHole; rel: Vector3; shadowPx: number; diskPx: number }[] = [];
    for (const bh of this.blackHoles) {
      const v = this.holes.views.find((x) => x.bh === bh);
      if (v) { out.push({ bh, rel: v.rel, shadowPx: v.shadowPx, diskPx: v.innerDiskPx }); continue; }
      const rel = bh.upos.sub(this.rig.upos, new Vector3());
      if (bh === this.selection || rel.length() < BH_LABEL_PC * PC) out.push({ bh, rel, shadowPx: 0, diskPx: 0 });
    }
    return out;
  }

  /**
   * A planet with no sun to light it cannot be seen from afar, and would be lost for good: its
   * name stays on the sky, and a tap on it finds it.
   */
  private namedInTheDark(v: { body: Body; sun: Body | null }): boolean {
    return !v.sun && v.body.kind === 'planet';
  }

  /** Never let the camera reach an event horizon. */
  /**
   * Never below the landing terrain: an eye height above the ground. Within a few metres of it and
   * not climbing, the explorer walks: eye height is kept over hills and into craters.
   */
  private keepAboveGround(dt: number): void {
    const below = this.terrain.below(this.rig.upos);
    if (!below) return;
    const EYE = EYE_HEIGHT;
    const h = below.dist - below.ground;
    const out = this.rig.upos.sub(below.centre, new Vector3()).normalize();
    let target = h;
    if (h < EYE) target = EYE;
    else if (h < 4 && !this.rig.autopilot && this.rig.vel.dot(out) < 0.05 && this.rig.rising <= 0 && !this.input.keys.has('KeyR')) {
      target = h + (EYE - h) * (1 - Math.exp(-dt * 6));
    }
    if (target !== h) this.rig.upos.addVec(out, target - h);
  }

  private keepOutsideHorizons(): void {
    const rel = new Vector3();
    for (const h of this.blackHoles) {
      this.rig.upos.sub(h.upos, rel);
      const d = rel.length();
      const min = h.radius * 1.15;
      if (d < min) this.rig.upos.copy(h.upos).addVec(d > 0 ? rel.divideScalar(d) : rel.set(0, 0, 1), min);
    }
  }

  private labelCandidates(): LabelCandidate[] {
    const out: LabelCandidate[] = [];
    this.occluders = [];
    for (const v of this.bodies.views.values()) {
      if (v.resolved && v.pixelRadius > 2) this.occluders.push({ body: v.body, rel: v.rel, dist: v.dist, radius: v.body.radius });
    }
    // on the landing terrain: the horizon is that of the ground below (a sphere through it, a little
    // lower so labels just above the horizon stay), and planets of other stars occlude too
    const below = this.terrain.below(this.rig.upos);
    if (below) {
      const owner = this.terrain.owner;
      const oc = this.occluders.find((o) => o.body === owner);
      const r = Math.min(below.ground, below.dist) - Math.max(2, (below.dist - below.ground) * 0.02);
      const low = below.dist - below.ground < LOW_OVER_GROUND;
      if (oc) { oc.radius = r; oc.exact = true; oc.low = low; }
      else this.occluders.push({ body: owner!, rel: below.centre.sub(this.rig.upos, new Vector3()), dist: below.dist, radius: r, exact: true, low });
    }
    const mLim = this.lastMLim;
    const sel = this.selection;
    const dpr = this.view.pixelRatio;
    for (const v of this.bodies.views.values()) {
      const b = v.body;
      const isSel = b === sel;
      let show = isSel;
      let prio = 0;
      if (b.kind === 'star') { show = true; prio = 600; }
      else if (b.kind === 'planet') { show = show || v.apparentMag < mLim + 2 || v.resolved || this.namedInTheDark(v); prio = 500 - v.apparentMag; }
      else if (b.kind === 'dwarf') { show = show || v.apparentMag < mLim || v.resolved; prio = 380 - v.apparentMag; }
      else if (b.kind === 'moon') {
        const parentView = b.parent ? this.bodies.views.get(b.parent) : undefined;
        const sep = parentView ? b.pos.distanceTo(b.parent!.pos) / v.dist / this.view.pixelAngle / dpr : 0;
        show = show || ((v.apparentMag < mLim + 1 || v.resolved) && sep > 18 && (!b.radiusEstimated || v.resolved));
        prio = 300 - v.apparentMag + (b.radiusEstimated ? -50 : 0);
      } else {
        show = show || v.resolved || v.apparentMag < Math.min(mLim, 9);
        prio = 200 - v.apparentMag;
      }
      if (!show) continue;
      const p = this.project(v.rel);
      if (!p || this.occluded(v.rel, b)) continue;
      out.push({ rel: v.rel.clone(), key: b.key, text: b.name, x: p.x, y: p.y, radius: v.pixelRadius / dpr, priority: isSel ? 1e4 : prio, cls: isSel ? 'selected' : b.kind });
    }
    const rel = new Vector3();
    for (const c of this.small.cometObjects) {
      if (c.apparentMag > Math.min(mLim, 10) && c !== sel) continue;
      c.upos.sub(this.rig.upos, rel);
      const p = this.project(rel);
      if (p && !this.occluded(rel, null)) out.push({ rel: rel.clone(), key: c.key, text: c.name, x: p.x, y: p.y, radius: 2, priority: c === sel ? 1e4 : 250 - c.apparentMag, cls: c === sel ? 'selected' : 'comet' });
    }
    const cam = this.camPc;
    for (const s of this.named.list) {
      if (!s.proper) continue;
      const d = s.pos.distanceTo(cam);
      if (d < NEAR_STAR_RADIUS) continue;
      const m = s.absMag + 5 * Math.log10(d) - 5;
      if (m > Math.min(mLim - 4, 2.6)) continue;
      rel.copy(s.pos).sub(cam).multiplyScalar(PC);
      const p = this.project(rel);
      if (p && !this.occluded(rel, null)) out.push({ rel: rel.clone(), key: `named:${s.index}`, text: s.names[0], x: p.x, y: p.y, radius: 3, priority: 100 - m, cls: 'star' });
    }
    for (const s of this.near.stars) {
      const p = this.project(s.upos.sub(this.rig.upos, rel));
      if (p) out.push({ rel: rel.clone(), key: s.key, text: s.name, x: p.x, y: p.y, radius: 4, priority: s === sel ? 1e4 : 450, cls: s === sel ? 'selected' : 'star' });
    }
    for (const sh of [...this.game.traffic.stations, ...this.game.traffic.ships]) {
      const r = sh.upos.sub(this.rig.upos, new Vector3());
      if (r.length() > (sh instanceof Station ? 3e7 : 1.5e6) && sh !== sel) continue;
      const p = this.project(r);
      if (p && !this.occluded(r, null)) out.push({ rel: r, key: sh.key, text: sh.name, x: p.x, y: p.y, radius: 3, priority: sh === sel ? 1e4 : 300, cls: sh === sel ? 'selected' : 'ship' });
    }
    for (const cv of this.craft.views) {
      if (!this.craftShown(cv)) continue;
      const p = this.project(cv.rel);
      if (p && !this.occluded(cv.rel, null)) {
        const isSel = cv.craft === sel;
        out.push({ rel: cv.rel.clone(), key: cv.craft.key, text: cv.craft.name, x: p.x, y: p.y, radius: cv.pixelRadius / dpr, priority: isSel ? 1e4 : 460, cls: isSel ? 'selected' : 'craft' });
      }
    }
    for (const ev of this.exo.views) {
      if (!this.exoShown(ev)) continue;
      const p = this.project(ev.rel);
      if (p && !this.occluded(ev.rel, null)) {
        const isSel = ev.planet === sel;
        out.push({ rel: ev.rel.clone(), key: ev.planet.key, text: ev.planet.name, x: p.x, y: p.y, radius: ev.pixelRadius / dpr, priority: isSel ? 1e4 : 470 + Math.min(ev.pixelRadius, 20), cls: isSel ? 'selected' : 'exoplanet' });
      }
    }
    for (const { bh, rel: r, shadowPx, diskPx } of this.labelledHoles()) {
      const p = this.project(r);
      // the name clears what shines: the bright inner disk, or a glint and its glare (HOLE_GLINT_PX)
      // when that is smaller; set by the shadow alone it stood on the glowing disk
      const radius = Math.max(shadowPx / dpr, diskPx / dpr, HOLE_GLINT_PX);
      if (p && !this.occluded(r, bh)) out.push({ rel: r, key: bh.key, text: bh.name, x: p.x, y: p.y, radius, priority: bh === sel ? 1e4 : 420, cls: bh === sel ? 'selected' : 'blackhole' });
    }
    for (const dv of this.deepSky.views) {
      const isSel = dv.obj === sel;
      if (!isSel && (dv.pixelRadius < 3 || dv.dist < dv.obj.radius * 0.8)) continue;
      const p = this.project(dv.rel);
      if (p && !this.occluded(dv.rel, null)) out.push({ rel: dv.rel.clone(), key: dv.obj.key, text: dv.obj.name, x: p.x, y: p.y, radius: Math.min(dv.pixelRadius / dpr, 60), priority: isSel ? 1e4 : 520 + Math.min(dv.pixelRadius, 40), cls: isSel ? 'selected' : 'nebula' });
    }
    for (const gv of this.galaxies.views) {
      const isSel = gv.galaxy === sel;
      if (!isSel && gv.pixelRadius < 2.5) continue;
      const p = this.project(gv.rel);
      if (p && !this.occluded(gv.rel, null)) out.push({ rel: gv.rel.clone(), key: gv.galaxy.key, text: gv.galaxy.name, x: p.x, y: p.y, radius: Math.min(gv.pixelRadius / dpr, 60), priority: isSel ? 1e4 : 640 + Math.min(gv.pixelRadius, 50), cls: isSel ? 'selected' : 'galaxy' });
    }
    {
      const mw = this.milkyWay;
      const r = mw.upos.sub(this.rig.upos, new Vector3());
      if (r.length() > mw.radius * 1.4 || sel === mw) {
        const p = this.project(r);
        if (p && !this.occluded(r, null)) out.push({ rel: r, key: mw.key, text: mw.name, x: p.x, y: p.y, radius: 40, priority: sel === mw ? 1e4 : 700, cls: sel === mw ? 'selected' : 'galaxy' });
      }
    }
    if (sel instanceof CatalogStar && !this.near.stars.includes(sel)) {
      const p = this.project(sel.upos.sub(this.rig.upos, rel));
      if (p && !this.occluded(rel, null)) out.push({ rel: rel.clone(), key: sel.key, text: sel.name, x: p.x, y: p.y, radius: 3, priority: 1e4, cls: 'selected' });
    }
    // Earth for scale (Awe) is drawn only with its name, which goes first: without it the disc
    // reads as a spot on the giant behind it
    const earth = this.awe?.cues.earthAt;
    if (earth) {
      const p = this.project(earth);
      const px = this.awe.cues.earthAngle / this.view.pixelAngle / dpr;
      if (p) out.push({ rel: earth.clone(), key: 'earth-for-scale', text: EARTH_FOR_SCALE, x: p.x, y: p.y, radius: px, priority: 2e4, cls: 'planet', over: true });
    }
    // what ends the path ahead of a world touched, where it ends (the future, drawn)
    const end = this.aheadEnd, said = end && this.aheadSaid();
    if (end && said) {
      const p = this.project(end);
      if (p) out.push({ rel: end.clone(), key: 'future-end', text: said.there, x: p.x, y: p.y, radius: 4, priority: 3e4, cls: 'future', over: true, avoid: [...ringStrokes(this.handleNow), ...aimStrokes(this.aimNow, this.view.width)] });
    }
    return out;
  }

  // ------------------------------------------------------------------ main loop
  start(): void {
    // setAnimationLoop follows the display's refresh, or the headset's while presenting.
    this.renderer.gl.setAnimationLoop(() => this.frame());
  }

  frame(): void {
    const now = performance.now();
    PERF.frameStart(now);
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    // Camera/controls use a clamped step for stability; the simulation clock follows real time.
    const dt = Math.min(0.1, rawDt);
    this.lastTime = now;
    if (rawDt > 0) this.fps += (1 / rawDt - this.fps) * 0.05;
    this.frameCount++;
    HITCH.begin();

    // 1. time and ephemerides
    // (in the ship, physics picks the universe step: time warp limits, dilation; the ship moves first)
    const flight = this.game.flight;
    const jd0 = this.clock.jdTdb;
    if (flight.on) this.clock.jdTdb += flight.before(rawDt, dt) / DAY;
    else {
      const step = Math.min(rawDt, 1);
      this.clock.advance(step * this.slowing(step));
    }
    // (live physics: the simulation goes where the clock asks as far as a frame allows, and the clock shows where it got)
    this.physics.follow(this.clock, rawDt);
    this.tickWatch(Math.min(rawDt, 1), (this.clock.jdTdb - jd0) * DAY);
    if (flight.on) {
      flight.simDt = Math.max(0, (this.clock.jdTdb - jd0) * DAY);
      flight.step();
    }
    const jd = this.clock.jdTdb;
    this.system.update(jd, this.clock.paused ? 0 : Math.sign(this.clock.rate), this.simFocus());
    if (this.physics.on) {
      // (another star's system: its rails at the date first, as the Solar System's ephemeris above; then the simulation's places)
      if (this.physics !== this.solar) this.physics.system.update(jd);
      this.physics.place(jd);
      this.trails.record(this.physics.bodies());
      this.tellNews();
    }
    this.lookAhead(rawDt);
    this.small.present = this.solar.sunAsWas;
    this.small.hide(this.solar.away);
    this.drawExo(jd);
    HITCH.lap('solarSystem');
    for (const h of this.blackHoles) h.update(jd);
    // planets and spacecraft move before the camera follows its anchor (which may be one of them)
    for (const sys of this.activeSystems) sys.update(jd);
    // (the real spacecraft flew their paths in the real Solar System: in live physics they have none)
    for (const c of this.craft.craft) {
      if (this.solar.on) c.valid = false;
      else c.update(jd);
    }
    HITCH.lap('ephemeris');
    PERF.lap('sim');

    if (this.selection instanceof CatalogStar && !this.selection.exact && this.selection.ref) {
      const r = this.selection.ref;
      this.getStar(r.catalog, r.node.id, r.slot);
    }
    // 2. camera: co-move with the reference body (and, near its ground, turn with it), then apply controls
    this.rig.followAnchor();
    this.carryWithGround();
    this.chooseAnchor();
    // (a world held by a finger goes where the finger goes: the camera must not go with it, or the finger would never catch up)
    if (this.mover.holding) this.rig.setAnchor(null);
    this.awe?.beginFrame();
    this.camPc.set((this.rig.upos.xh + this.rig.upos.xl) / PC, (this.rig.upos.yh + this.rig.upos.yl) / PC, (this.rig.upos.zh + this.rig.upos.zl) / PC);
    HITCH.lap('anchor');
    if (this.nearTimer-- <= 0) {
      this.updateNearStars();
      this.nearTimer = 10;
      HITCH.lap('nearScan');
    }
    this.rig.altitude = this.computeAltitude();
    this.describeSurroundings();
    HITCH.lap('altitude');
    this.updateCentre(dt);
    if (this.vr.active) this.vr.updateInput(dt);
    this.rig.braking = this.input.keys.has('KeyX');
    // free flight by touch (src/app/FreeFly.ts): the stick's push, or its end where the ship or walking has the controls
    this.free.update(dt);
    // walking (src/app/Walk.ts) owns the camera while on foot; otherwise free flight
    if (this.walk.update(dt)) { this.glide = null; /* on foot */ }
    else if (flight.on) {
      // the docking computer flies the rig; physics resumes after it
      if (flight.external) this.rig.update(dt, this.input);
      flight.after(dt);
    }
    else {
      this.rig.update(dt, this.input);
      // (a watch's frame: the camera eased to it, unless a finger has taken it back)
      if (this.glide && !this.glide.step(dt)) this.glide = null;
      this.keepOutsideHorizons();
      this.keepAboveGround(dt);
    }
    this.camPc.set((this.rig.upos.xh + this.rig.upos.xl) / PC, (this.rig.upos.yh + this.rig.upos.yl) / PC, (this.rig.upos.zh + this.rig.upos.zl) / PC);

    // The dolly carries the explorer's orientation; a headset pose is applied on top of it.
    this.renderer.rig.quaternion.copy(this.rig.quat);
    this.renderer.rig.updateMatrixWorld(true);
    PERF.lap('cam');
    const cam = this.renderer.camera;
    cam.fov = this.rig.fovY;
    this.renderer.setCentre(this.centre.x, this.centre.y);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.view = this.renderer.viewInfo();
    this.invQuat.copy(this.view.quat).invert();
    this.meterInverse();
    // culling cone for per-object layers: the frame's corners plus a margin (more in a headset:
    // the second eye and head motion until the next frame)
    VIEW_CONE.set(this.view.quat, this.view.fovY, this.view.aspect, this.view.xr ? 0.35 : 0.12, (2 * Math.abs(this.view.cx)) / this.view.height, (2 * Math.abs(this.view.cy)) / this.view.height);
    // Headset runtimes may clamp the far plane: pull distant geometry inside it, and fit log depth to it.
    // (not with reversed-Z in the headset: Renderer.reverseXrProjections drops the runtime's far plane)
    const finiteFar = this.view.xr && Number.isFinite(this.view.far) && this.renderer.depthMode !== 'reversed-z';
    GLOBALS.uPullIn.value = finiteFar ? this.view.far * 0.5 : 0;
    // (the lighter shaders are the headset's; a phone takes them only as a last resort, at the governor's lowest level,
    // which on a phone means under 30 frames a second even at the lowest resolution (render/Quality.ts: PHONE_FPS):
    // they make a nebula close up grainy, and looks come first here. With the governor off, as in the browser checks,
    // a phone draws as before)
    LITE.uLite.value = this.vr.active || (this.phone && QUALITY.level >= PHONE_LITE_FROM) ? 1 : 0;
    GLOBALS.uDepthK.value = finiteFar ? depthK(this.renderer.camera.far) : 1;
    HITCH.lap('camera');

    // 3. exposure and level of detail
    const pixelAngle = this.view.pixelAngle;
    // the Sun's glare (the desktop bloom alone leaves a resolved Sun a bare dot)
    this.bodies.glareOn = true;
    this.bodies.glareVr = this.vr.active;
    // (of the suns there are, the one that looks largest from here: the Sun, while it is the only one)
    const sunRel = new Vector3();
    let chief: Body | null = null, largest = 0;
    for (const s of this.system.suns) {
      const size = s.radius / Math.max(s.upos.sub(this.rig.upos, sunRel).length(), s.radius);
      if (size > largest) { largest = size; chief = s; }
    }
    this.bodies.chief = chief;
    this.bodies.glarePresence = 0;
    if (chief) {
      chief.upos.sub(this.rig.upos, sunRel);
      const sunSeen = seen(sunRel, chief.radius, this.meterView, this.seenScratch, this.meterInv);
      // (no glare from a Sun behind a world: as the worlds stood a frame ago)
      this.bodies.glarePresence = sunSeen.presence * this.inSight(sunRel, chief.radius);
      // (the glare is a far-off Sun's: once its disk takes a twelfth of the frame's half-width it fades, gone by a third)
      const halfY = (this.view.fovY * Math.PI) / 360;
      this.bodies.glareFill = smoothstep(0.08, 0.35, sunSeen.size / Math.min(halfY, Math.atan(Math.tan(halfY) * this.view.aspect)));
    }
    this.bodies.allowHi = !this.vr.active && !this.lean;
    // (the world a flight is on its way to, the camera's or the ship's: its full maps on the way)
    const bound = this.rig.autopilot ? this.rig.target : this.game.flight.autopilot?.target;
    if (bound instanceof Body) this.bodies.keepWanted(bound);
    this.bodies.update(this.rig.upos, pixelAngle, dt, this.view.quat);
    HITCH.lap('bodies');
    this.bodies.updateDetail(this.renderer.gl, this.tiles, pixelAngle, new Vector3(0, 0, -1).applyQuaternion(this.view.quat));
    HITCH.lap('bodyDetail');
    PERF.lap('bodies');
    this.atmospheres.steps = this.vr.active ? 10 : 16;
    this.atmospheres.update(this.bodies.views);
    HITCH.lap('atmospheres');
    PERF.lap('atmo');
    this.updateActiveSystems();
    HITCH.lap('systems');
    this.exo.showOrbits = this.orbits.enabled;
    this.exo.update(this.rig.upos, pixelAngle, this.activeSystems, jd, now / 1000);
    this.atmospheres.updateExo(this.exo.atmospheres());
    HITCH.lap('exo');
    PERF.lap('exo');
    // landing terrain on the nearest solid world (Solar System body or generated planet)
    {
      // (none on a world whose size has been changed: its ground is measured for its real size)
      const cands = [this.bodies.terrainCandidate(), this.exo.terrainCandidate()].filter((c): c is NonNullable<typeof c> => c !== null && !(c.ground.owner instanceof Body && this.solar.resized(c.ground.owner)) && !(c.ground.owner instanceof ExoPlanet && c.ground.owner.radius !== c.ground.owner.spec.radiusM));
      cands.sort((a, b) => a.alt - b.alt);
      const c = cands[0] ?? null;
      if (c) c.air = this.atmospheres.material(c.ground.owner);
      this.terrain.vr = this.vr.active;
      this.terrain.view = this.view;
      this.terrain.update(c);
      this.rocks.update(this.rig.upos, this.renderer.gl);
      HITCH.lap('terrain');
    }
    PERF.lap('terrain');
    this.craft.update(this.rig.upos, pixelAngle, jd, this.system.sun, this.system.byId.get(399)!);
    HITCH.lap('craft');
    PERF.lap('craft');
    this.holes.vr = this.vr.active;
    // (a far hole's disk is a point in the frame from where its light is that of the faintest star shown)
    this.holes.update(this.rig.upos, pixelAngle, now / 1000, magToIrradiance(this.starMagLimit));
    // a black hole's environment capture sees every direction: no view culling while one is active
    if (this.holes.views.length) VIEW_CONE.enabled = false;
    // the volume pass: its pixels are larger than the frame's (their noise's level of detail), and
    // inside a hole's lensing region it is not seen at all (the hole draws the surroundings itself)
    // (a phone in the lighter shaders keeps the screen's own volume pass: only a headset's is half resolution)
    VOLUMES.pixelAngle.value = pixelAngle / Math.min(1, this.vr.active ? VOLUMES.scaleXr : VOLUMES.scale);
    VOLUMES.covered = this.holes.views.some((v) => v.inside);
    this.jets.update(this.rig.upos, pixelAngle, now / 1000);
    HITCH.lap('holes');
    PERF.lap('holes');
    const { xStar, xSurf, xLight, mLim, xDark } = this.updateExposure(dt);
    HITCH.lap('exposure');
    const sunDistPc = this.camPc.length();
    GALAXY.toGal(this.camPc, this.camGal);
    this.galaxy.vr = this.vr.active;
    // one face per frame while travelling; all at once if we find ourselves far out with no map yet
    if (sunDistPc > 60) this.galaxy.update(this.renderer.gl, this.camGal, !this.galaxy.ready && sunDistPc > 150 ? 6 : 1);
    HITCH.lap('galaxyCube');
    const glow = this.galaxy.ready ? this.galaxy : null;
    this.sky.updateWith(xStar / xDark, sunDistPc, glow?.target.texture ?? null, this.camGal, glow?.prev.texture ?? null, glow?.blend ?? 1);
    this.mwVolume.update(this.rig.upos, this.camGal, this.sky.modelK, SkyLayer.MODEL_REF, this.sky.modelExp);
    HITCH.lap('sky');
    this.galaxies.update(this.rig.upos, pixelAngle, xStar / xDark, smoothstep(300, 1500, sunDistPc), this.view.quat);
    HITCH.lap('galaxies');
    this.deepSky.update(this.rig.upos, this.camPc, pixelAngle, xStar / xDark);
    HITCH.lap('deepSky');
    this.cometTails.gain.value = xStar / xDark;
    // (what a black hole shows of the glow around it follows the glow's brightness)
    this.holes.glowLevel = [this.galaxies.gain.value, this.deepSky.gain.value, this.mwVolume.level, this.cometTails.gain.value];
    PERF.lap('sky');
    this.lastMLim = mLim;
    const psf = this.starFields[0].psf;
    psf.uExposure.value = xStar;
    const dpr = this.view.pixelRatio;
    psf.uPixelSA.value = (this.view.pixelAngle * dpr) ** 2;
    psf.uDpr.value = dpr;
    // The narrowest star is half a pixel of the screen wide, whatever the screen's density: a
    // sharp point on each. (A headset's pixels are large and the head never still: wider there.)
    // Its light is what a star 0.6 px wide had on the display: the faint stars are as bright as
    // they were, in less room.
    psf.uMinSigma.value = this.vr.active ? 0.8 : 0.5 / dpr;
    psf.uPointLight.value = this.vr.active ? 1.41 : 0.79;
    this.bodies.surfaceExposure.value = xSurf;
    this.bodies.lightExposure.value = xLight;
    for (const c of this.catalogs) c.update(this.camPc, mLim, this.fieldMinDistPc);
    HITCH.lap('catalogs');
    for (const f of this.starFields) f.update(this.camPc, NEAR_STAR_RADIUS);
    HITCH.lap('starFields');
    this.procStars.update(this.camPc, mLim, NEAR_STAR_RADIUS, this.vr.active ? 2 : 4);
    HITCH.lap('procStars');
    this.near.update(this.rig.upos, pixelAngle, now / 1000, this.view.quat);
    HITCH.lap('nearStars');
    PERF.lap('stars');
    this.orbits.focus = this.rig.anchor instanceof Body ? this.rig.anchor : null;
    this.orbits.update(this.rig.upos, pixelAngle, jd);
    this.trails.enabled = this.orbits.enabled;
    this.trails.showMinor = this.orbits.showMinor;
    this.trails.selected = this.orbits.selected;
    this.trails.update(this.rig.upos, pixelAngle);
    this.flash.update(this.rig.upos, this.view.quat, pixelAngle * this.view.pixelRatio, Math.min(rawDt, 0.1));
    this.aheadEnd = this.futures.update(this.rig.upos, this.aheadOf && this.ahead, this.aheadOf);
    HITCH.lap('orbits');
    this.small.update(this.rig.upos, jd);
    HITCH.lap('smallBodies');
    this.cometTails.update(this.rig.upos, this.system.sun.upos, this.small.cometObjects, this.selection, jd);
    HITCH.lap('cometTails');

    PERF.lap('orbits');
    this.game.update(dt);
    HITCH.lap('game');
    PERF.lap('game');
    this.awe?.update(dt);
    HITCH.lap('awe');
    PERF.lap('awe'); // scale cues

    // 4. draw
    if (this.warmupPending) {
      this.warmupPending = false;
      this.warmUp();
    }
    HITCH.lap('warmUp');
    UPLOADS.budgetMs = this.vr.active ? 2 : 4;
    UPLOADS.pump();
    HITCH.lap('uploads');
    PERF.gpuBegin();
    this.holes.capture(this.renderer.gl, this.renderer.scene, [this.renderer.rig, this.renderer.volQuad, this.jets.group, this.orbits.group, ...this.vr.sceneOverlays], psf);
    this.holes.miniatures(this.renderer.gl);
    HITCH.lap('holeCapture');
    PERF.lap('capture');
    this.renderer.render();
    PERF.gpuEnd();
    HITCH.lap('render');
    PERF.lap('render');

    // 5. overlays
    // (the ring round a world being moved, and its slingshot's arrow if a throw is aimed: the words at the end of the path ahead keep off them)
    this.handleNow = this.mover.handle();
    this.aimNow = this.mover.aim();
    if (this.vr.active) {
      this.labels.update([], this.cssW, this.cssH);
      this.vr.updateOverlays(this.labelCandidates(), dt);
    } else {
      // (no name under the interface's cards and chips, nor the ship's instruments)
      this.labels.keepOut = this.hud.covers();
      this.labels.update(this.labelCandidates(), this.view.width, this.view.height);
    }
    HITCH.lap('labels');
    this.hud.setHandle(this.handleNow);
    this.hud.setAim(this.aimNow);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.updateHud();
    }
    HITCH.lap('hud');
    const info = this.renderer.gl.info;
    HITCH.end(info.programs ?? 0, info.memory.textures);
    PERF.lap('overlay');
    PERF.frameEnd();
  }

  private readonly focusSet = new Set<Body>();
  /**
   * The Solar System bodies whose motion must be exact this frame (SolarSystem.update scales the
   * rest with what is on screen): where the camera is and what it is going to or has selected, and
   * every body drawn larger than a pixel last frame.
   */
  private simFocus(): ReadonlySet<Body> | undefined {
    if (SIM_FOCUS_OFF) return undefined;
    const f = this.focusSet;
    f.clear();
    for (const o of [this.rig.anchor, this.rig.target, this.selection]) if (o instanceof Body) f.add(o);
    for (const v of this.bodies.views.values()) if (v.pixelRadius > 0.7) f.add(v.body);
    return f;
  }

  /**
   * The temperature of a world whose Bond albedo is measured (src/app/Worked.ts: temperatureOf): as
   * its fact sheet has it while the Solar System is the real one, and where it is now, under every
   * sun, in live physics. (A moon the sheet gives no sunlight for gets its planet's: it is as far
   * from the Sun.) Null for any other.
   */
  private temperature(b: Body): { line: string; worked: Worked[] } | null {
    const climate = b.climate;
    if (!climate || !b.valid) return null;
    const listed = climate.irradiance ?? b.parent?.climate?.irradiance ?? null;
    const sun: Sunlit = !this.solar.on && listed !== null ? { listed }
      : { suns: this.system.suns.filter((s) => s !== b && s.valid && s.radius > 0 && s.teff > 0).map((s) => ({ name: s.name, lumW: luminosity(s.radius, s.teff).value * L_SUN, dM: s.pos.distanceTo(b.pos) })) };
    return temperatureOf({ name: b.name, giant: b.isGasGiant, oceans: b.name === 'Earth' }, climate, sun);
  }

  private updateHud(): void {
    const c = this.clock, rig = this.rig;
    this.checkArrival();
    let selection: HudState['selection'] = null;
    if (this.selection) {
      const sel = this.selection;
      const d = sel.upos.sub(rig.upos, new Vector3()).length();
      // what the textbook makes of its facts, worked afresh a few times a second (an orbit's speed moves on)
      const now = performance.now();
      if (this.worked.key !== sel.key || now - this.worked.at > 400) this.worked = { key: sel.key, at: now, rows: workedOut(sel, this.solar.on ? null : this.system) };
      // (its temperature, worked afresh each time: it follows a finger dragging it sunwards)
      const warmth = sel instanceof Body ? this.temperature(sel) : null;
      const worked = warmth ? [...this.worked.rows, ...warmth.worked] : this.worked.rows;
      // (a fact that is worked out is shown there, with its working: not twice)
      const rows: [string, string][] = [['Distance', distanceText(distanceTo(this, sel))], ...sel.info().filter(([k]) => !worked.some((w) => w.label === k)), ...this.awe.rows(sel, d)];
      if (sel instanceof CatalogStar && !this.isCompanion(sel)) {
        const sys = this.systems.of(sel);
        if (sys) rows.push(['Planets', sys.real ? `${sys.planets.length} confirmed (NASA Exoplanet Archive)` : `${sys.planets.length} generated (not observed)`]);
        else if (wellStudied(sel)) rows.push(['Planets', 'none confirmed (NASA Exoplanet Archive)']);
      }
      const available = this.powersOf(sel);
      // (the body the powers act on: a world of the Solar System itself, or the one standing for another star or its planet)
      const pb = this.powerBody(sel, false);
      selection = {
        key: sel.key, name: sel.name, detail: plainLine(this, sel), plain: plainFacts(this, sel), rows, worked, warmth: warmth?.line ?? '', picture: pictureOf(sel), here: sel === rig.target && !rig.autopilot,
        powers: available, mass: null, size: null, removable: false, move: null, place: null, add: sel instanceof Body && available.add.works ? canAdd(sel, this.made.length) : [],
      };
      // the powers over a world, when the one table says they work
      if (pb && available.move.works) {
        selection.rows.splice(1, 0, ...this.physics.rows(pb));
        selection.removable = available.remove.works;
        selection.move = { ...this.mover.describe(pb), ahead: pb === this.aheadOf ? this.aheadLine() : '' };
        const real = this.physics.realGm(pb);
        if (available.mass.works) {
          const factor = pb.gm / real, sun = madeSun(pb), mark = this.massMark(pb);
          selection.mass = {
            slider: massSlider(factor), words: `${(pb.kind === 'star' ? starMassWords : massWords)(massOf(pb.gm))}${mark.words}`, times: timesWords(factor),
            says: mark.says || (sun ? 'Its size, colour and light follow' : pb.kind === 'star' ? 'Only its pull changes, not its size or look' : this.sizeFollows ? 'Its size follows: the same density' : 'Only its pull changes, not its size'),
            theory: massTheory(massOf(pb.gm), pb.kind === 'star') ?? '',
          };
          // its size, as a factor on its real radius
          if (available.size.works) {
            const size = pb.radius / this.physics.realRadius(pb);
            // (a factor the slider snapped to, read back from the radius, is that factor to the last digits)
            const nice = sizeFactor(sizeSlider(size)), f = Math.abs(size / nice - 1) < 1e-9 ? nice : size;
            selection.size = { slider: sizeSlider(size), words: radiusWords(pb.radius), times: sizeTimesWords(f), linked: this.sizeFollows };
          }
        }
        // a world just made, being put in place: its own mass slider, and what it is at that mass
        const as = pb.meta.madeAs as BodyJson['madeAs'];
        if (as && this.mover.placing && this.mover.body === pb) {
          const kind = as.kind as Kind;
          const looked = as.seed !== undefined && isWorldKind(kind);
          selection.place = {
            name: pb.name, slider: madeSlider(kind, as.kg), ...madeWords(kind, as.kg, as.icy), newLook: looked, rings: looked ? !!as.rings : null, hue: looked ? as.hue ?? 0 : null,
            portrait: looked ? this.portraitOf(pb) : null,
          };
        }
      }
    }
    const status = this.physics.status();
    // (two worlds about to hit: time runs slower than asked, and the chips say how fast it runs)
    const slowed = this.slow.cap < Math.abs(c.rate), runs = slowed ? this.slow.cap : c.rate;
    const kept = status && !c.paused && status.share < 0.9 ? c.rate * status.share : 0;
    const slow = kept ? `getting ${rateWords(kept)}` : '';
    // (the mark at the top has the room of a phone: while a change is watched its chip says the pace, and the watch slows
    // itself when the stepping falls behind)
    const where = this.physics === this.solar ? null : this.physics.system.sun.name;
    const mark = kept && !this.watch.watching ? `only ${this.rateText(kept)}` : status ? (where ? `round ${where}` : `since ${dayWords(this.physics.live!.jd0, true)}`) : '';
    // where the camera is: at its target (how high above it, or how far from it), or in open space
    const t = rig.target;
    let place = rig.anchor ? `Near ${rig.anchor.name}` : 'Open space';
    let placeDetail = 'no destination';
    if (t) {
      const d = t.upos.sub(rig.upos, new Vector3()).length();
      place = t.name;
      // close to a world it is a height; from afar, or with nothing to stand on, a distance
      const h = Math.max(d - rig.surface, 0);
      // (in plain words: kilometres, millions or billions of them, then light years; never AU)
      placeDetail = rig.surface > 0 && h < 10 * rig.surface ? `${formatDistance(h)} up` : `${plainDistance(rig.surface > 0 ? h : d)} away`;
    }
    // (in the ship the speed is its own, from its proper speed, as its instruments say it)
    const flight = this.game.flight;
    const speed = flight.on ? plainSpeed(flight.readout.properSpeed) : plainSpeedWords(rig.speed);
    if (rig.speed > 0) placeDetail = t ? `${placeDetail} · ${speed}` : speed;
    // (on foot the chip says where you stand, not where you last flew to)
    if (this.walk.walking) {
      const w = this.walk.worldName();
      place = `On ${w}`;
      placeDetail = 'walking';
    }
    const drawn = this.starFields.reduce((a, f) => a + f.drawnStars, 0) + this.procStars.drawnStars;
    const loaded = this.catalogs.reduce((a, cat) => a + cat.loadedStars, 0);
    const total = this.catalogs.reduce((a, cat) => a + cat.totalStars, 0);
    const pending = this.catalogs.reduce((a, cat) => a + cat.pending, 0);
    this.hud.update({
      place,
      placeDetail,
      date: formatUtc(c.jdTdb),
      rate: this.rateText(runs),
      paused: c.paused,
      reversed: c.rate < 0,
      selection,
      live: status && { since: status.since, mark, slow, rails: status.rails, leftOut: status.leftOut, log: status.log, where },
      realWhat: where ? `${where}'s real orbits again` : 'the real Solar System again',
      undo: this.history.size > 0 && (this.physics.on || this.realAgain > 0),
      realAgain: !this.physics.on && this.realAgain > 0 && this.history.size > 0,
      watch: this.watch.state === 'idle' ? null
        : this.watch.state === 'offered' ? { text: 'See what it does', ended: false, offer: true }
        : this.watch.watching ? { text: slowed ? `Slowed: ${rateWords(runs)}` : `Watching: ${rateWords(this.watch.rate)}`, ended: false }
          : { text: `Watched: ${spanWords(this.watch.shown)}`, ended: true, replay: !!this.replayFrom },
      showMe: this.showMe,
      flying: rig.autopilot && t ? t.name : null,
      labels: this.labels.enabled,
      orbits: this.orbits.enabled,
      minor: this.orbits.showMinor,
      look: rig.touchDrag === 'look',
      free: this.free.active,
      pilotControls: this.game.pilotControls,
      mode: this.walk.active ? 'walk' : this.game.active ? 'ship' : 'explore',
      touch: this.input.touch,
      ship: flight.on ? flight.timeReport() : null,
      missions: { done: this.game.missions.doneCount, total: this.game.missions.total, items: this.game.missions.list },
      // (a day or more from today, and the date is the explorer's to set: not in live physics)
      canWalk: this.input.touch && !this.game.active && this.walk.canStartHere(),
      // (not at the present moment at real time: a day or more away, any other rate, backwards, or paused; not in live physics)
      today: !this.physics.on && (Math.abs(c.jdTdb - (Date.now() / 86_400_000 + 2_440_587.5)) > 1 || c.rate !== 1 || c.paused) ? 'Back to now' : '',
      speed: clockSpeedWords(runs),
      status: [
        `${this.fps.toFixed(0)} fps`,
        `${(drawn / 1e3).toFixed(0)}k stars drawn, ${(loaded / 1e6).toFixed(2)}M of ${(total / 1e6).toFixed(2)}M loaded`,
        ...(pending ? [`streaming ${pending} star tiles`] : []),
        this.system.usingDE ? 'ephemeris JPL DE442S' : 'ephemeris: approximate elements',
        `depth ${this.renderer.depthMode}`,
      ].join(' · '),
    });
  }

  /** Galaxy model column (L☉/pc², light beyond 300 pc) along world direction `dir` from the eye (debugging). */
  debugGlowColumn(dir: [number, number, number]): number {
    return glowColumn(this.camGal, GALAXY.dirToGal(new Vector3(...dir).normalize()), 400, 300);
  }

  /** Scripting helpers (used by automated tests and the browser console). */
  debugState() {
    return {
      jd: this.clock.jdTdb,
      camera: this.rig.upos.toVector3().toArray(),
      anchor: this.rig.anchor?.name ?? null,
      selection: this.selection?.name ?? null,
      target: this.rig.target?.name ?? null,
      starsDrawn: this.starFields.reduce((a, f) => a + f.drawnStars, 0),
      proceduralDrawn: this.procStars.drawnStars,
      proceduralPending: this.procStars.pending,
      starsLoaded: this.catalogs.reduce((a, c) => a + c.loadedStars, 0),
      pendingTiles: this.catalogs.reduce((a, c) => a + c.pending, 0),
      exposure: this.bodies.surfaceExposure.value,
      lightExposure: this.bodies.lightExposure.value,
      starExposure: this.starFields[0].psf.uExposure.value,
      glare: this.bodies.glareLevel,
      mLim: this.lastMLim,
      depthMode: this.renderer.depthMode,
      usingDE: this.system.usingDE,
      fps: this.fps,
      autopilot: this.rig.autopilot,
    };
  }
}

/** `?simfocus=0`: update every body every frame (A/B of the focus-scaled update) */
const SIM_FOCUS_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('simfocus') === '0';

/**
 * How near a star a tap must be to pick it (px): the whole reach for a bright star, down to a
 * pointer's for a faint one. The sky is full of faint stars: a finger put down between them is
 * not asking for one.
 */
function starReach(reach: number, magnitude: number): number {
  return Math.max(Math.min(reach, POINTER_REACH), Math.min(reach, reach - 3 * (magnitude - 2)));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The planet a body belongs to (a moon's planet; a planet, dwarf planet or a world made round a star: itself); null for a star or not a body. */
function planetOf(o: SpaceObject | null): Body | null {
  if (!(o instanceof Body) || o.kind === 'star') return null;
  let b: Body = o;
  while (b.parent instanceof Body && b.parent.kind !== 'star') b = b.parent;
  return b;
}

/** A sun the explorer made: a star of the main sequence of its mass, its size, colour and light following it (src/app/WhatIf.ts: madeSize). */
function madeSun(b: Body): boolean {
  return (b.meta.madeAs as BodyJson['madeAs'])?.kind === 'sun';
}
