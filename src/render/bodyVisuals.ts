/**
 * Factories for the render objects of system bodies: materials + meshes for
 * stars, giants, rings, atmospheres, clouds, belts and orbit lines.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { BeltProps, PlanetBody, StarBody } from '../universe/types';
import { ATMO_FRAG, ATMO_VERT, BODY_VERT, CLOUD_FRAG, GIANT_FRAG, GLOW_FRAG, GLOW_VERT, RING_FRAG, RING_VERT, STAR_FRAG } from './bodyShaders';

export type Uniforms = Record<string, THREE.IUniform>;

const sphereGeo = new THREE.SphereGeometry(1, 64, 40);
// Orient the sphere so its poles lie on ±z (the body-fixed spin axis), not three.js' default ±y.
sphereGeo.rotateX(Math.PI / 2);
const sphereLow = new THREE.SphereGeometry(1, 28, 18);
sphereLow.rotateX(Math.PI / 2);
const quadGeo = new THREE.PlaneGeometry(2, 2);

export const unitSphere = (low = false): THREE.BufferGeometry => (low ? sphereLow : sphereGeo);
export const unitQuad = (): THREE.BufferGeometry => quadGeo;

/** Lighting / shadow uniforms shared by every lit body shader. */
export function lightUniforms(noise: THREE.Data3DTexture): Uniforms {
  return {
    uNoise: { value: noise },
    uLightPos: { value: [new THREE.Vector3(1, 0, 0), new THREE.Vector3()] },
    uLightColor: { value: [new THREE.Vector3(1, 1, 1), new THREE.Vector3()] },
    uLightRadius: { value: [1, 1] },
    uOccluder: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uRingNormal: { value: new THREE.Vector3(0, 0, 1) },
    uRing: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}

/** Atmosphere uniforms (shared between the shell and the terrain's aerial perspective). */
export function atmoUniforms(): Uniforms {
  return {
    uPlanetPos: { value: new THREE.Vector3() }, uRadius: { value: 1 }, uAtmoRadius: { value: 1.1 }, uScaleHeight: { value: 0.01 },
    uBetaR: { value: new THREE.Vector3() }, uBetaM: { value: new THREE.Vector3() }, uMieG: { value: 0.76 },
    uSunDir: { value: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 0)] }, uSunColor: { value: [new THREE.Vector3(1, 1, 1), new THREE.Vector3()] },
    uHasAtmo: { value: 0 },
  };
}

export function starMaterial(noise: THREE.Data3DTexture, star: StarBody): THREE.ShaderMaterial {
  const p = star.star;
  const giant = p.type === 'giant' || p.type === 'supergiant';
  // Photosphere brightness in HDR units: hotter stars burn brighter on screen (compressed).
  const intensity = p.type === 'whitedwarf' ? 9 : p.type === 'neutron' || p.type === 'pulsar' ? 14 : 5 + Math.min(6, Math.max(0, (p.teff - 3000) / 4000));
  return new THREE.ShaderMaterial({
    vertexShader: BODY_VERT, fragmentShader: STAR_FRAG, toneMapped: false,
    uniforms: {
      uNoise: { value: noise }, uBodyRot: { value: new THREE.Matrix3() }, uColor: { value: new THREE.Color().setRGB(p.color[0], p.color[1], p.color[2]) }, uIntensity: { value: intensity }, uTime: { value: 0 },
      // Cool stars are heavily spotted; giants have a few enormous convection cells.
      uSpots: { value: p.type === 'main' ? Math.min(1, Math.max(0.15, (6500 - p.teff) / 3500)) : giant ? 0.5 : 0 },
      uCells: { value: giant ? 0.6 : p.type === 'whitedwarf' ? 6 : 2.6 }, uDetail: { value: 1 },
    },
  });
}

export function glowMaterial(noise: THREE.Data3DTexture, color: readonly [number, number, number], seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: {
      uNoise: { value: noise }, uCenter: { value: new THREE.Vector3() }, uSize: { value: 1 }, uColor: { value: new THREE.Color().setRGB(color[0], color[1], color[2]) },
      uTime: { value: 0 }, uDisc: { value: 0.2 }, uCorona: { value: 1 }, uGlare: { value: 0 }, uSeed: { value: (seed % 1000) / 1000 },
    },
  });
}

export function giantMaterial(shared: Uniforms, planet: PlanetBody): THREE.ShaderMaterial {
  const s = planet.surface;
  return new THREE.ShaderMaterial({
    vertexShader: BODY_VERT, fragmentShader: GIANT_FRAG, toneMapped: false,
    uniforms: {
      ...shared,
      uBodyRot: { value: new THREE.Matrix3() }, uPalette: { value: s.palette.map((c) => new THREE.Vector3(c[0], c[1], c[2])) },
      uBands: { value: new THREE.Vector4(s.bands, s.bandContrast, s.storms, (s.seed % 4096) / 4096) }, uTime: { value: 0 }, uDetail: { value: 1 }, uRadius: { value: planet.radius },
      uEmission: { value: new THREE.Vector3(s.emissionColor[0], s.emissionColor[1], s.emissionColor[2]).multiplyScalar(s.emission * 1.5) },
      uAtmoColor: { value: new THREE.Vector3(...(planet.atmosphere?.rayleigh ?? [0.6, 0.7, 1])) },
    },
  });
}

export function ringMesh(shared: Uniforms, planet: PlanetBody): THREE.Mesh {
  const r = planet.rings!;
  const geo = new THREE.RingGeometry(r.inner, r.outer, 160, 1);
  const material = new THREE.ShaderMaterial({
    vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { ...shared, uColor: { value: new THREE.Color().setRGB(r.color[0], r.color[1], r.color[2]) }, uPlanetRadius: { value: planet.radius } },
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  return mesh;
}

export function atmosphereMesh(noise: THREE.Data3DTexture, atmo: Uniforms, coverDisc: boolean): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, transparent: true, depthWrite: false, toneMapped: false,
    // Giants have no aerial perspective in their surface shader, so their shell also covers the disc (front faces).
    side: coverDisc ? THREE.FrontSide : THREE.BackSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { ...atmo, uNoise: { value: noise }, uSamples: { value: 6 }, uAurora: { value: new THREE.Vector4(0, 0, 1, 0) }, uTime: { value: 0 } },
  });
  const mesh = new THREE.Mesh(unitSphere(), material);
  mesh.renderOrder = 7;
  mesh.frustumCulled = false;
  return mesh;
}

/** `shared` must hold both the lighting and the atmosphere uniforms of the body (the cloud deck sits inside its air). */
export function cloudMesh(shared: Uniforms, planet: PlanetBody): THREE.Mesh {
  const s = planet.surface;
  const material = new THREE.ShaderMaterial({
    vertexShader: BODY_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      ...shared, uBodyRot: { value: new THREE.Matrix3() }, uColor: { value: new THREE.Color().setRGB(s.cloudColor[0], s.cloudColor[1], s.cloudColor[2]) }, uCover: { value: s.clouds },
      uTime: { value: 0 }, uSeed: { value: (s.seed % 977) / 977 }, uDetail: { value: 1 }, uCloudRadius: { value: planet.radius },
    },
  });
  const mesh = new THREE.Mesh(unitSphere(), material);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}

const BELT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
uniform float uFocal;
uniform vec3 uColor;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 1.0);
  // Rocks are far below a pixel: draw each as a faint dot whose brightness falls with distance.
  float px = aSize / d * uFocal;
  gl_PointSize = clamp(px * 2.0, 1.5, 6.0);
  // From across the system the belt is only a whisper of dust; rocks brighten as you close in.
  vColor = uColor * clamp(0.04 + px * 60.0, 0.0, 1.2) * (0.6 + 0.4 * fract(aSize * 0.37));
  #include <logdepthbuf_vertex>
}`;

const BELT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = 1.0 - dot(p, p);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

/** Asteroid / debris belt: thousands of dots on slightly inclined, eccentric orbits (deterministic from the belt seed). */
export function beltPoints(belt: BeltProps): THREE.Points {
  const rng = new Rng(belt.seed);
  const pos = new Float32Array(belt.count * 3);
  const size = new Float32Array(belt.count);
  for (let i = 0; i < belt.count; i++) {
    const r = belt.inner + (belt.outer - belt.inner) * Math.sqrt(rng.next() * 0.9 + rng.next() * 0.1);
    const a = rng.range(0, Math.PI * 2);
    pos[i * 3] = r * Math.cos(a);
    pos[i * 3 + 1] = r * Math.sin(a);
    pos[i * 3 + 2] = r * belt.thickness * rng.gauss() * 0.5;
    size[i] = 2000 * Math.pow(rng.next(), 4) * 400 + 800;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: BELT_VERT, fragmentShader: BELT_FRAG, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { uFocal: { value: 1000 }, uColor: { value: new THREE.Color().setRGB(belt.color[0], belt.color[1], belt.color[2]) } },
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  return points;
}

const LINE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const LINE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(uColor * uAlpha, 1.0);
}`;

/** A faint line material (orbits, constellation figures). Additive, so alpha is just brightness. */
export function lineMaterial(color: readonly [number, number, number]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { uColor: { value: new THREE.Color().setRGB(color[0], color[1], color[2]) }, uAlpha: { value: 1 } },
  });
}

const BEAM_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying float vAlong;
varying vec3 vN;
varying vec3 vRel;
void main() {
  vAlong = position.y;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vRel = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}`;

const BEAM_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
varying float vAlong;
varying vec3 vN;
varying vec3 vRel;
void main() {
  #include <logdepthbuf_fragment>
  // Brightest along the axis (where we look through the most beam), fading with distance from the star.
  float rim = pow(abs(dot(normalize(vN), normalize(vRel))), 1.6);
  float fall = exp(-vAlong * 3.2) * smoothstep(0.0, 0.02, vAlong);
  gl_FragColor = vec4(uColor * rim * fall * 2.2, 1.0);
}`;

/** One pulsar beam: an open cone along +y (unit length; scale to taste). */
export function beamMesh(): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.11, 1, 24, 8, true);
  // Apex at the origin, opening along +y.
  geo.rotateX(Math.PI);
  geo.translate(0, 0.5, 0);
  const material = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { uColor: { value: new THREE.Color(0.55, 0.75, 1.0) } },
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  return mesh;
}
