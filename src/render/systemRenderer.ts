/**
 * Renders one star system: its stars, planets, moons, rings, belts and orbit
 * lines, all camera-relative.
 *
 * Every body starts as a faint dot. As it grows on screen it is upgraded to a
 * full model — a photosphere + corona for stars, a banded cloud deck for
 * giants, quadtree terrain with atmosphere and clouds for solid worlds — and
 * downgraded again when left behind, so only what the player is looking at
 * costs anything.
 */
import * as THREE from 'three';
import { STAR_MAG_REF } from './pointLayer';
import { type UPos, uposAddInPlace, uposSub } from '../core/hp';
import { AU, L_SUN, PC } from '../core/units';
import type { WorkerPool } from '../data/workerPool';
import { bodyAxisWorld, bodyPositions, bodyRotation } from '../universe/system';
import { type TerrainParams, surfaceElevation } from '../universe/terrain';
import type { Body, PlanetBody, StarBody, SystemModel } from '../universe/types';
import type { BlackHoleView } from './blackHolePass';
import { type Uniforms, atmoUniforms, atmosphereMesh, beamMesh, beltPoints, cloudMesh, giantMaterial, glowMaterial, lightUniforms, lineMaterial, ringMesh, starMaterial, unitQuad, unitSphere } from './bodyVisuals';
import type { Engine } from './engine';
import { TerrainBody } from './terrainRenderer';

interface BodyVisual {
  body: Body;
  /** Centre relative to the camera, world axes (float64 values). */
  rel: THREE.Vector3;
  /** Body-fixed → world rotation this frame. */
  rot: THREE.Quaternion;
  rotM: THREE.Matrix3;
  distance: number;
  /** Apparent radius in pixels. */
  px: number;
  light: Uniforms;
  atmo: Uniforms;
  glow: THREE.Mesh | null;
  sphere: THREE.Mesh | null;
  terrain: TerrainBody | null;
  ring: THREE.Mesh | null;
  shell: THREE.Mesh | null;
  clouds: THREE.Mesh | null;
  beams: THREE.Group | null;
  orbit: THREE.LineLoop | null;
  /** Cached terrain parameters for solid bodies. */
  terrainParams: TerrainParams | null;
  /** Seconds the body has been too small to need its full model (for hysteresis). */
  idle: number;
}

/** Scene-linear brightness of full sunlight on a white surface (before tone mapping). */
const LIGHT = 1.35;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM4 = new THREE.Matrix4();

const isStar = (b: Body): b is StarBody => b.kind === 'star';
const isGiant = (b: Body): boolean => b.kind !== 'star' && (b.type === 'gasgiant' || b.type === 'icegiant');

export class SystemRenderer {
  system: SystemModel | null = null;
  /** Index of the body whose surface is nearest to the camera, its altitude and "up" direction. */
  nearestIndex = -1;
  nearestAltitude = Infinity;
  readonly nearestUp = new THREE.Vector3(0, 1, 0);
  /** Set when a black hole of this system should be lensed this frame. */
  blackHole: BlackHoleView | null = null;
  /** Black-hole proximity 0…1 and time-dilation factor at the camera (for effects and the data readout). */
  blackHoleProximity = 0;
  timeDilation = 1;
  /** Lens-flare source this frame: view-space direction is converted by the caller. */
  readonly flare = { rel: new THREE.Vector3(), color: new THREE.Color(), strength: 0 };
  /** 0…1: how much the nearest star's glare / daylight should dim the background star field. */
  skyDimming = 0;
  showOrbits = true;

  private visuals: BodyVisual[] = [];
  private belts: Array<{ points: THREE.Points; parent: number; rate: number; base: THREE.Quaternion }> = [];
  private readonly group = new THREE.Group();
  private positions = new Float64Array(0);
  private prevPositions = new Float64Array(0);
  private prevValid = false;
  private prevAngle = 0;
  private prevRotIndex = -1;
  private readonly originRel = { x: 0, y: 0, z: 0 };
  private readonly bh: BlackHoleView = { center: new THREE.Vector3(), rs: 1, axis: new THREE.Vector3(0, 1, 0), diskInner: 3, diskOuter: 12, diskGain: 1, jet: 0 };
  private time = 0;

  constructor(private readonly engine: Engine, private readonly pool: WorkerPool) {
    engine.scene.add(this.group);
  }

  /** Switch to another system (or none). */
  setSystem(system: SystemModel | null): void {
    if (system === this.system) return;
    this.clear();
    this.system = system;
    if (!system) return;
    this.positions = new Float64Array(system.bodies.length * 3);
    this.prevPositions = new Float64Array(system.bodies.length * 3);
    this.prevValid = false;
    this.prevRotIndex = -1;
    const noise = this.engine.noise;
    this.visuals = system.bodies.map((body) => {
      const v: BodyVisual = {
        body, rel: new THREE.Vector3(), rot: new THREE.Quaternion(), rotM: new THREE.Matrix3(), distance: 0, px: 0, light: lightUniforms(noise), atmo: atmoUniforms(),
        glow: null, sphere: null, terrain: null, ring: null, shell: null, clouds: null, beams: null, orbit: null, terrainParams: null, idle: 0,
      };
      // The dot / glare billboard exists for every body: it is how far-away bodies are seen at all.
      const color = isStar(body) ? body.star.color : body.color;
      v.glow = new THREE.Mesh(unitQuad(), glowMaterial(noise, color, body.seed));
      v.glow.frustumCulled = false;
      v.glow.renderOrder = 4;
      this.group.add(v.glow);
      if (!isStar(body) && !isGiant(body)) v.terrainParams = { radius: body.radius, type: body.type, surface: body.surface, tSurface: body.tSurface };
      if (body.orbit) {
        // Orbit ellipse relative to the parent, in system-frame metres (rotated to world by the group).
        const pts = new Float32Array(193 * 3);
        const o = body.orbit;
        const b = system.basis;
        for (let k = 0; k <= 192; k++) {
          const E = (k / 192) * Math.PI * 2;
          const px = o.a * (Math.cos(E) - o.e);
          const py = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
          const cw = Math.cos(o.peri), sw = Math.sin(o.peri), cn = Math.cos(o.node), sn = Math.sin(o.node), ci = Math.cos(o.i), si = Math.sin(o.i);
          const x1 = cw * px - sw * py;
          const y1 = sw * px + cw * py;
          const x = cn * x1 - sn * ci * y1;
          const y = sn * x1 + cn * ci * y1;
          const z = si * y1;
          pts[k * 3] = b[0] * x + b[3] * y + b[6] * z;
          pts[k * 3 + 1] = b[1] * x + b[4] * y + b[7] * z;
          pts[k * 3 + 2] = b[2] * x + b[5] * y + b[8] * z;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const tint: [number, number, number] = isStar(body) ? [0.9, 0.8, 0.5] : body.kind === 'moon' ? [0.45, 0.5, 0.6] : [0.35, 0.55, 0.9];
        v.orbit = new THREE.LineLoop(geo, lineMaterial(tint));
        v.orbit.frustumCulled = false;
        v.orbit.renderOrder = 2;
        this.group.add(v.orbit);
      }
      return v;
    });
    for (const belt of system.belts) {
      const points = beltPoints(belt);
      // Belt plane = system plane: rotate the local z axis onto the system normal.
      const b = system.basis;
      tmpM4.set(b[0], b[3], b[6], 0, b[1], b[4], b[7], 0, b[2], b[5], b[8], 0, 0, 0, 0, 1);
      points.quaternion.setFromRotationMatrix(tmpM4);
      this.group.add(points);
      const mid = (belt.inner + belt.outer) / 2;
      const parentMass = system.bodies[Math.max(0, belt.parent)]!.mass;
      this.belts.push({ points, parent: belt.parent, rate: Math.sqrt((6.6743e-11 * parentMass) / (mid * mid * mid)), base: points.quaternion.clone() });
    }
  }

  private clear(): void {
    for (const v of this.visuals) this.dropModel(v, true);
    for (const b of this.belts) {
      this.group.remove(b.points);
      b.points.geometry.dispose();
      (b.points.material as THREE.Material).dispose();
    }
    this.visuals = [];
    this.belts = [];
    this.blackHole = null;
    this.nearestIndex = -1;
    this.nearestAltitude = Infinity;
  }

  private dropModel(v: BodyVisual, all: boolean): void {
    const drop = (m: THREE.Object3D | null): void => {
      if (!m) return;
      this.group.remove(m);
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry && mesh.geometry !== unitSphere() && mesh.geometry !== unitSphere(true) && mesh.geometry !== unitQuad()) mesh.geometry.dispose();
        if (mesh.material) (mesh.material as THREE.Material).dispose();
      });
    };
    drop(v.sphere);
    drop(v.ring);
    drop(v.shell);
    drop(v.clouds);
    drop(v.beams);
    v.terrain?.dispose();
    v.sphere = v.ring = v.shell = v.clouds = null;
    v.beams = null;
    v.terrain = null;
    if (all) {
      drop(v.glow);
      drop(v.orbit);
      v.glow = null;
      v.orbit = null;
    }
  }

  /** Create the full model of a body that has grown large enough on screen. */
  private buildModel(v: BodyVisual): void {
    const body = v.body;
    const noise = this.engine.noise;
    if (isStar(body)) {
      const t = body.star.type;
      if (t === 'blackhole') return; // drawn entirely by the lensing pass
      v.sphere = new THREE.Mesh(unitSphere(), starMaterial(noise, body));
      this.group.add(v.sphere);
      if (t === 'pulsar') {
        v.beams = new THREE.Group();
        const a = beamMesh();
        const b = beamMesh();
        b.rotation.x = Math.PI;
        v.beams.add(a, b);
        this.group.add(v.beams);
      }
      return;
    }
    const planet = body as PlanetBody;
    const light = v.light;
    if (isGiant(body)) {
      v.sphere = new THREE.Mesh(unitSphere(), giantMaterial(light, planet));
      this.group.add(v.sphere);
    } else {
      v.terrain = new TerrainBody(v.terrainParams!, this.pool, noise, { ...light, ...v.atmo }, this.engine.tier);
      this.group.add(v.terrain.group);
    }
    if (planet.rings) {
      v.ring = ringMesh(light, planet);
      this.group.add(v.ring);
    }
    if (planet.atmosphere) {
      v.shell = atmosphereMesh(noise, v.atmo, isGiant(body));
      this.group.add(v.shell);
    }
    if (planet.surface.clouds > 0.03 && !isGiant(body)) {
      v.clouds = cloudMesh({ ...light, ...v.atmo }, planet);
      this.group.add(v.clouds);
    }
  }

  /**
   * Per-frame update. `simTime` is seconds since J2000.
   *
   * If `drag` is given, the camera is carried along with the body it is next to: it follows the
   * body's orbital motion and, close to the surface, its rotation — so a world you are orbiting
   * does not fly away from under you, and the ground stays still when you are low over it.
   */
  update(camPos: UPos, camera: THREE.PerspectiveCamera, simTime: number, dt: number, starMagLimit: number, drag: { quat: THREE.Quaternion } | null = null): void {
    const sys = this.system;
    this.blackHole = null;
    this.blackHoleProximity = 0;
    this.timeDilation = 1;
    this.flare.strength = 0;
    this.skyDimming = 0;
    if (!sys) return;
    this.time += dt;
    const engine = this.engine;
    const tier = engine.tier;
    const focal = engine.pixelsPerRadian;
    bodyPositions(sys, simTime, this.positions);
    const pos = this.positions;
    const anchor = this.nearestIndex;
    if (drag && this.prevValid && anchor >= 0 && anchor < this.visuals.length) {
      const av = this.visuals[anchor]!;
      const R = av.body.radius;
      if (this.nearestAltitude < R * 40) {
        // Follow the body's translation…
        uposAddInPlace(camPos, pos[anchor * 3]! - this.prevPositions[anchor * 3]!, pos[anchor * 3 + 1]! - this.prevPositions[anchor * 3 + 1]!, pos[anchor * 3 + 2]! - this.prevPositions[anchor * 3 + 2]!);
        // …and, near the ground, its spin (fully below 5 % of a radius of altitude, fading out by 60 %).
        const w = 1 - Math.min(1, Math.max(0, (this.nearestAltitude / R - 0.05) / 0.55));
        if (w > 0 && this.prevRotIndex === anchor && !isStar(av.body)) {
          const axis = bodyAxisWorld(sys, av.body);
          const angle = bodyRotation(av.body, simTime) - this.prevAngle;
          if (Math.abs(angle) < 1) {
            tmpQ.setFromAxisAngle(tmpA.set(axis.x, axis.y, axis.z).normalize(), angle * w * w * (3 - 2 * w));
            uposSub(camPos, sys.origin, this.originRel);
            tmpB.set(this.originRel.x - pos[anchor * 3]!, this.originRel.y - pos[anchor * 3 + 1]!, this.originRel.z - pos[anchor * 3 + 2]!);
            tmpC.copy(tmpB).applyQuaternion(tmpQ).sub(tmpB);
            uposAddInPlace(camPos, tmpC.x, tmpC.y, tmpC.z);
            drag.quat.premultiply(tmpQ);
          }
        }
      }
    }
    this.prevPositions.set(pos);
    this.prevValid = true;
    this.prevRotIndex = anchor;
    if (anchor >= 0 && anchor < this.visuals.length) this.prevAngle = bodyRotation(this.visuals[anchor]!.body, simTime);
    uposSub(sys.origin, camPos, this.originRel);
    const o = this.originRel;

    // ---- Pass 1: positions, orientation, sizes; find the nearest surface.
    let nearest = -1;
    let nearestAlt = Infinity;
    for (let i = 0; i < this.visuals.length; i++) {
      const v = this.visuals[i]!;
      const body = v.body;
      v.rel.set(o.x + pos[i * 3]!, o.y + pos[i * 3 + 1]!, o.z + pos[i * 3 + 2]!);
      v.distance = v.rel.length();
      v.px = (body.radius / Math.max(v.distance, body.radius * 0.01)) * focal;
      // Orientation: z = spin axis; x = prime meridian, measured from the node of the equator on the ICRS equator (IAU convention).
      const axis = bodyAxisWorld(sys, body);
      tmpA.set(axis.x, axis.y, axis.z).normalize();
      tmpB.crossVectors(Z_AXIS, tmpA);
      if (tmpB.lengthSq() < 1e-10) tmpB.set(0, 1, 0);
      tmpB.normalize();
      tmpC.crossVectors(tmpA, tmpB);
      tmpM4.makeBasis(tmpB, tmpC, tmpA);
      v.rot.setFromRotationMatrix(tmpM4);
      tmpQ.setFromAxisAngle(Z_AXIS, bodyRotation(body, simTime));
      v.rot.multiply(tmpQ);
      v.rotM.setFromMatrix4(tmpM4.makeRotationFromQuaternion(v.rot));
      const alt = v.distance - body.radius;
      if (alt < nearestAlt) {
        nearestAlt = alt;
        nearest = i;
      }
    }

    // ---- Pass 2: lights, shadows and visuals.
    const stars = this.visuals.filter((v) => isStar(v.body) && (v.body as StarBody).star.type !== 'blackhole');
    for (let i = 0; i < this.visuals.length; i++) {
      const v = this.visuals[i]!;
      const body = v.body;
      const star = isStar(body) ? body : null;

      // Level of detail with hysteresis: build the model above ~1.5 px, drop it after a while below 0.8 px.
      const want = v.px > 1.5;
      const has = v.sphere !== null || v.terrain !== null || (star?.star.type === 'blackhole' && want);
      if (want && !has) this.buildModel(v);
      if (!want && has) {
        v.idle += dt;
        if (v.idle > 3 && v.px < 0.8) this.dropModel(v, false);
      } else v.idle = 0;

      if (star) this.updateStar(v, star, camera, focal, starMagLimit, simTime);
      else this.updatePlanet(v, body as PlanetBody, i, stars, camera, focal, tier.atmosphereSteps, simTime);

      if (v.orbit) {
        // Orbit lines hang off the parent's position; hide the line of the body you are standing next to.
        const p = body.parent;
        v.orbit.position.set(o.x + (p >= 0 ? pos[p * 3]! : 0), o.y + (p >= 0 ? pos[p * 3 + 1]! : 0), o.z + (p >= 0 ? pos[p * 3 + 2]! : 0));
        const size = body.orbit!.a;
        const sizePx = (size / Math.max(v.orbit.position.length(), size * 0.3)) * focal;
        const near = Math.min(1, Math.max(0, v.distance / (body.radius * 60) - 0.4));
        const alpha = this.showOrbits ? Math.min(1, Math.max(0, (sizePx - 6) / 30)) * Math.min(1, 1500 / sizePx) * near * 0.045 : 0;
        v.orbit.visible = alpha > 0.004;
        (v.orbit.material as THREE.ShaderMaterial).uniforms.uAlpha!.value = alpha;
      }
    }

    // ---- Belts.
    for (const belt of this.belts) {
      const p = belt.parent;
      belt.points.position.set(o.x + (p >= 0 ? pos[p * 3]! : 0), o.y + (p >= 0 ? pos[p * 3 + 1]! : 0), o.z + (p >= 0 ? pos[p * 3 + 2]! : 0));
      // The whole belt turns at the Keplerian rate of its middle (individual rocks are not tracked).
      belt.points.quaternion.copy(belt.base).multiply(tmpQ.setFromAxisAngle(Z_AXIS, (belt.rate * simTime) % (Math.PI * 2)));
      (belt.points.material as THREE.ShaderMaterial).uniforms.uFocal!.value = focal;
    }

    // ---- Nearest surface (terrain-aware) for altitude, collision and the horizon.
    this.nearestIndex = nearest;
    if (nearest >= 0) {
      const v = this.visuals[nearest]!;
      this.nearestUp.copy(v.rel).multiplyScalar(-1).normalize();
      let ground = v.body.radius;
      if (v.terrainParams && nearestAlt < v.body.radius * 0.5) {
        // Camera direction in the body-fixed frame → elevation of the ground beneath.
        tmpA.copy(this.nearestUp).applyQuaternion(tmpQ.copy(v.rot).invert());
        ground += surfaceElevation(v.terrainParams, tmpA.x, tmpA.y, tmpA.z, 14);
      }
      this.nearestAltitude = v.distance - ground;
    } else this.nearestAltitude = Infinity;
  }

  private updateStar(v: BodyVisual, star: StarBody, camera: THREE.PerspectiveCamera, focal: number, starMagLimit: number, simTime: number): void {
    const p = star.star;
    const glow = v.glow!;
    const gu = (glow.material as THREE.ShaderMaterial).uniforms;
    if (p.type === 'blackhole') {
      glow.visible = false;
      // Hand the hole to the lensing pass when it is in front of the camera or we are close enough to be inside its field.
      const rs = p.schwarzschildRadius;
      const outer = 6 + 10 * p.accretion;
      const view = tmpA.copy(v.rel).applyQuaternion(tmpQ.copy(camera.quaternion).invert());
      const visible = view.z < rs * 60 && (rs * outer / Math.max(v.distance, rs)) * focal > 0.6;
      const prox = Math.min(1, Math.max(0, 1 - (v.distance / rs - 1.6) / 40));
      if (prox > this.blackHoleProximity) {
        this.blackHoleProximity = prox;
        this.timeDilation = 1 / Math.sqrt(Math.max(1e-4, 1 - rs / Math.max(v.distance, rs * 1.0001)));
      }
      if (visible && (!this.blackHole || v.distance < this.blackHole.center.length())) {
        const bh = this.bh;
        bh.center.copy(view);
        bh.rs = rs;
        const axis = bodyAxisWorld(this.system!, star);
        bh.axis.set(axis.x, axis.y, axis.z).applyQuaternion(tmpQ);
        bh.diskInner = 3;
        bh.diskOuter = p.accretion > 0.03 ? outer : 0;
        bh.diskGain = 0.6 + 2.4 * p.accretion;
        bh.jet = p.accretion > 0.75 ? (p.accretion - 0.75) * 4 : 0;
        this.blackHole = bh;
      }
      return;
    }

    // Apparent brightness → glare size, with the same law as the point sprites so the hand-over is seamless.
    const dPc = v.distance / PC;
    const m = p.absMag + 5 * Math.log10(Math.max(dPc, 1e-12) / 10);
    void starMagLimit;
    const e = Math.pow(10, 0.4 * Math.min(STAR_MAG_REF - m, 30));
    const pxScale = Math.max(1.1, this.engine.renderHeight / 720);
    const glarePx = pxScale * Math.min(0.72 + 0.5 * Math.pow(e, 0.3), 30) * 2.2;
    const discPx = v.px;
    // Once the disc itself is big, the glare gives way to the corona.
    const coronaPx = discPx * (p.type === 'whitedwarf' || p.type === 'neutron' || p.type === 'pulsar' ? 9 : 3.4);
    const quadPx = Math.max(glarePx, coronaPx);
    const size = (quadPx / focal) * v.distance;
    glow.visible = true;
    (gu.uCenter!.value as THREE.Vector3).copy(v.rel);
    gu.uSize!.value = size;
    gu.uDisc!.value = Math.min(0.999, discPx / quadPx);
    gu.uCorona!.value = Math.min(1, discPx / 3) * (p.type === 'giant' || p.type === 'supergiant' ? 0.6 : 1) * (p.type === 'neutron' || p.type === 'pulsar' ? 2.5 : 1);
    gu.uGlare!.value = Math.min(0.5 * Math.pow(e, 0.62), 14) * Math.max(0, 1 - discPx / Math.max(glarePx * 0.45, 1e-3)) * (glarePx / quadPx) ** 2 + (discPx > glarePx * 0.2 ? 0.5 : 0);
    gu.uTime!.value = this.time;

    if (v.sphere) {
      v.sphere.position.copy(v.rel);
      v.sphere.quaternion.copy(v.rot);
      v.sphere.scale.setScalar(star.radius);
      const su = (v.sphere.material as THREE.ShaderMaterial).uniforms;
      (su.uBodyRot!.value as THREE.Matrix3).copy(v.rotM);
      // Surface features evolve on visual, not physical, time-scales.
      su.uTime!.value = this.time * (p.type === 'giant' || p.type === 'supergiant' ? 0.3 : 1);
      su.uDetail!.value = this.engine.tier.surfaceOctaves / 5;
    }
    if (v.beams) {
      // Pulsar beams along the magnetic axis, which is tilted from the spin axis and swept around by rotation.
      // Real pulsars spin many times a second; the sweep is slowed to a calm, non-strobing ~0.5 Hz.
      const spin = (this.time * Math.PI * 2) / Math.max(1.8, Math.min(6, p.rotationPeriod * 4));
      tmpQ.setFromAxisAngle(Z_AXIS, spin);
      v.beams.quaternion.copy(v.rot).multiply(tmpQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.6));
      v.beams.position.copy(v.rel);
      v.beams.scale.setScalar(Math.max(star.radius * 4000, v.distance * 0.35));
    }

    // Lens flare and sky dimming come from the star that is brightest in the sky right now.
    const brightness = Math.min(1, Math.max(0, (-12 - m) / 14));
    if (brightness > this.flare.strength) {
      this.flare.strength = brightness;
      this.flare.rel.copy(v.rel);
      this.flare.color.setRGB(p.color[0], p.color[1], p.color[2]);
    }
    // A blazing sun in (or near) the frame washes out the stars; with it behind you they come back.
    const toward = v.distance > 0 ? tmpA.copy(v.rel).multiplyScalar(1 / v.distance).dot(tmpB.set(0, 0, -1).applyQuaternion(camera.quaternion)) : 1;
    const inView = Math.min(1, Math.max(0, (toward - 0.25) / 0.65));
    this.skyDimming = Math.max(this.skyDimming, Math.min(1, Math.max(0, (-9 - m) / 12)) * (0.22 + 0.78 * inView * inView * (3 - 2 * inView)));
    void simTime;
  }

  private updatePlanet(v: BodyVisual, planet: PlanetBody, index: number, stars: BodyVisual[], camera: THREE.PerspectiveCamera, focal: number, atmoSteps: number, simTime: number): void {
    const sys = this.system!;
    const glow = v.glow!;
    const gu = (glow.material as THREE.ShaderMaterial).uniforms;
    const light = v.light;

    // ---- Lights: the two stars that illuminate this body the most.
    const ranked = stars
      .map((s) => {
        const d = tmpA.subVectors(s.rel, v.rel).length();
        return { s, d, flux: (s.body as StarBody).star.luminosity / L_SUN / Math.max((d / AU) ** 2, 1e-12) };
      })
      .sort((a, b) => b.flux - a.flux)
      .slice(0, 2);
    const lp = light.uLightPos!.value as THREE.Vector3[];
    const lc = light.uLightColor!.value as THREE.Vector3[];
    const lr = light.uLightRadius!.value as number[];
    const sd = v.atmo.uSunDir!.value as THREE.Vector3[];
    const sc = v.atmo.uSunColor!.value as THREE.Vector3[];
    let lightSum = 0;
    for (let k = 0; k < 2; k++) {
      const r = ranked[k];
      if (!r) {
        lc[k]!.set(0, 0, 0);
        sc[k]!.set(0, 0, 0);
        continue;
      }
      const sp = (r.s.body as StarBody).star;
      lp[k]!.subVectors(r.s.rel, v.rel);
      // Exposure-compensated intensity: every world is comfortably lit, yet far ones stay a little dimmer.
      const inten = LIGHT * Math.min(1.6, Math.max(0.45, Math.pow(r.flux, 0.1))) * (k === 0 ? 1 : Math.min(1, r.flux / Math.max(ranked[0]!.flux, 1e-12) + 0.05));
      lc[k]!.set(sp.color[0], sp.color[1], sp.color[2]).multiplyScalar(inten);
      lr[k] = r.s.body.radius;
      sd[k]!.copy(lp[k]!).normalize();
      sc[k]!.copy(lc[k]!).multiplyScalar(1 / LIGHT);
      lightSum += inten;
    }

    // ---- Dot for far-away bodies: brightness from size and illuminated fraction.
    if (v.px < 2.5 && ranked[0]) {
      const toSun = tmpA.copy(lp[0]!).normalize();
      const toCam = tmpB.copy(v.rel).multiplyScalar(-1).normalize();
      const phase = 0.5 + 0.5 * toSun.dot(toCam);
      const quadPx = 3.2 * Math.max(1.1, this.engine.renderHeight / 720);
      glow.visible = true;
      (gu.uCenter!.value as THREE.Vector3).copy(v.rel);
      gu.uSize!.value = (quadPx / focal) * v.distance;
      gu.uCorona!.value = 0;
      gu.uDisc!.value = 0;
      gu.uGlare!.value = Math.min(1.6, (0.12 + v.px * v.px * 1.4) * (0.15 + 0.85 * phase) * (planet.albedo + 0.25) * lightSum * 0.3) * Math.max(0, 1 - v.px / 2.5);
    } else glow.visible = false;
    if (!v.sphere && !v.terrain) return;

    // ---- Shadow casters: parent, children and siblings that can eclipse the suns.
    const occ = light.uOccluder!.value as THREE.Vector4[];
    let n = 0;
    for (let j = 0; j < this.visuals.length && n < 4; j++) {
      if (j === index) continue;
      const other = this.visuals[j]!;
      const ob = other.body;
      if (isStar(ob)) continue;
      const related = ob.parent === index || planet.parent === j || (ob.parent === planet.parent && planet.kind === 'moon');
      if (!related) continue;
      tmpA.subVectors(other.rel, v.rel);
      occ[n++]!.set(tmpA.x, tmpA.y, tmpA.z, ob.radius);
    }
    for (; n < 4; n++) occ[n]!.set(0, 0, 0, 0);

    // ---- Rings (own rings shadow the planet; a moon sits in its parent's ring shadow rarely enough to skip).
    const axis = bodyAxisWorld(sys, planet);
    (light.uRingNormal!.value as THREE.Vector3).set(axis.x, axis.y, axis.z).normalize();
    if (planet.rings) (light.uRing!.value as THREE.Vector4).set(planet.rings.inner, planet.rings.outer, planet.rings.opacity, (planet.rings.seed % 1000) / 1000);
    else (light.uRing!.value as THREE.Vector4).set(0, 0, 0, 0);

    // ---- Atmosphere parameters.
    const atmo = planet.atmosphere;
    const a = v.atmo;
    (a.uPlanetPos!.value as THREE.Vector3).copy(v.rel);
    a.uRadius!.value = planet.radius;
    if (atmo) {
      // Keep at least a visible sliver of air from orbit: real scale heights are a fraction of a pixel.
      const H = Math.max(atmo.scaleHeight, planet.radius * 0.0022);
      const tau = 0.22 * atmo.density;
      a.uScaleHeight!.value = H;
      a.uAtmoRadius!.value = planet.radius + H * 9;
      const maxR = Math.max(atmo.rayleigh[0], atmo.rayleigh[1], atmo.rayleigh[2], 1e-3);
      (a.uBetaR!.value as THREE.Vector3).set(atmo.rayleigh[0], atmo.rayleigh[1], atmo.rayleigh[2]).multiplyScalar(tau / maxR / H);
      (a.uBetaM!.value as THREE.Vector3).set(atmo.mieColor[0], atmo.mieColor[1], atmo.mieColor[2]).multiplyScalar((0.12 * atmo.mie * atmo.density) / H);
      a.uHasAtmo!.value = 1;
    } else a.uHasAtmo!.value = 0;

    // ---- Meshes.
    if (v.sphere) {
      v.sphere.position.copy(v.rel);
      v.sphere.quaternion.copy(v.rot);
      v.sphere.scale.setScalar(planet.radius);
      const u = (v.sphere.material as THREE.ShaderMaterial).uniforms;
      (u.uBodyRot!.value as THREE.Matrix3).copy(v.rotM);
      u.uTime!.value = this.time;
      u.uDetail!.value = this.engine.tier.surfaceOctaves / 5;
    }
    if (v.terrain) {
      // Camera in the body-fixed frame.
      tmpA.copy(v.rel).multiplyScalar(-1).applyQuaternion(tmpQ.copy(v.rot).invert());
      v.terrain.update(tmpA, v.rel, v.rot, v.rotM, focal, this.engine.tier, this.time, this.engine.quality.detailScale);
    }
    if (v.ring) {
      v.ring.position.copy(v.rel);
      // Ring plane = equator: only the axis matters, not the planet's spin.
      v.ring.quaternion.setFromUnitVectors(Z_AXIS, tmpA.set(axis.x, axis.y, axis.z).normalize());
    }
    if (v.shell && atmo) {
      const R = a.uAtmoRadius!.value as number;
      v.shell.position.copy(v.rel);
      v.shell.scale.setScalar(R);
      const mat = v.shell.material as THREE.ShaderMaterial;
      const inside = v.distance < R * 1.001;
      if (isGiant(planet)) {
        // From outside draw front faces over the disc; once inside the air, switch to the far side with no depth test.
        const side = inside ? THREE.BackSide : THREE.FrontSide;
        if (mat.side !== side) {
          mat.side = side;
          mat.needsUpdate = true;
        }
        mat.depthTest = !inside;
      }
      mat.uniforms.uSamples!.value = atmoSteps;
      mat.uniforms.uTime!.value = this.time;
      (mat.uniforms.uAurora!.value as THREE.Vector4).set(axis.x, axis.y, axis.z, planet.aurora * (v.px > 40 ? 1 : 0));
      // Daylight under an atmosphere washes out the stars.
      if (inside && ranked[0]) {
        const up = tmpA.copy(v.rel).multiplyScalar(-1).normalize();
        const day = Math.min(1, Math.max(0, up.dot(sd[0]!) * 4 + 0.6));
        // (Dust and haze light up a sky as well as gas does: Mars has little air but a bright butterscotch day.)
        this.skyDimming = Math.max(this.skyDimming, day * Math.min(1, atmo.density + 0.8 * atmo.mie) * Math.min(1, (R - v.distance) / (R - planet.radius) + 0.3));
      }
    }
    if (v.clouds) {
      const H = (a.uScaleHeight!.value as number) || planet.radius * 0.002;
      const cloudR = planet.radius + Math.max(H * 0.9, planet.surface.relief * 0.55);
      v.clouds.position.copy(v.rel);
      v.clouds.quaternion.copy(v.rot);
      v.clouds.scale.setScalar(cloudR);
      const u = (v.clouds.material as THREE.ShaderMaterial).uniforms;
      (u.uBodyRot!.value as THREE.Matrix3).copy(v.rotM);
      u.uTime!.value = this.time + simTime * 2e-5;
      u.uCloudRadius!.value = cloudR;
      u.uDetail!.value = this.engine.tier.surfaceOctaves / 5;
    }
    void camera;
  }

  /** Centre of body `index` relative to the camera this frame (world axes), or null. */
  bodyRel(index: number): THREE.Vector3 | null {
    return this.visuals[index]?.rel ?? null;
  }

  /** Body under a view ray (unit direction from the camera, world axes), or −1. `minPx` is the tap tolerance in pixels. */
  pick(dir: THREE.Vector3, focal: number, minPx: number): number {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.visuals.length; i++) {
      const v = this.visuals[i]!;
      const along = v.rel.dot(dir);
      if (along <= 0) continue;
      const off = Math.sqrt(Math.max(0, v.rel.lengthSq() - along * along));
      const offPx = (off / along) * focal;
      const radiusPx = Math.max(v.px, minPx);
      if (offPx > radiusPx) continue;
      // Inside a disc: nearest wins. Otherwise: closest to the tap.
      const score = offPx <= v.px ? -1e30 + v.distance : offPx + (isStar(v.body) ? 0 : -2);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /** Push the camera out of the nearest body if it has sunk below `clearance` metres. Returns the correction (world axes) or null. */
  resolveCollision(clearance: number): THREE.Vector3 | null {
    if (this.nearestIndex < 0) return null;
    const v = this.visuals[this.nearestIndex]!;
    if (isStar(v.body) && v.body.star.type === 'blackhole') return null;
    const min = isStar(v.body) ? v.body.radius * 0.02 : clearance;
    if (this.nearestAltitude >= min) return null;
    return tmpC.copy(this.nearestUp).multiplyScalar(min - this.nearestAltitude);
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}
