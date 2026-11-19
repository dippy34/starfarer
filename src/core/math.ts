/**
 * Small dependency-free vector / quaternion helpers used by the pure
 * simulation layers (src/core, src/universe, src/data). Rendering code uses
 * three.js types; `V3` is structurally compatible with THREE.Vector3 so values
 * can cross the boundary without conversion.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Quaternion (x, y, z, w), structurally compatible with THREE.Quaternion. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const vAdd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vSub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vScale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vDot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vCross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const vLen = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vDist = (a: V3, b: V3): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
export const vLerp = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

export function vNorm(a: V3): V3 {
  const l = vLen(a);
  return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 1 };
}

/** Any unit vector perpendicular to `a` (a must be normalised). */
export function vPerp(a: V3): V3 {
  const ref = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  return vNorm(vCross(a, ref));
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const saturate = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export const quatIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

export function quatFromAxisAngle(axis: V3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
}

export function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatNorm(q: Quat): Quat {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Rotate vector v by unit quaternion q. */
export function quatRotate(q: Quat, v: V3): V3 {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

/** Row-major 3×3 matrix as a flat 9-element array. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function mat3MulV(m: Mat3, v: V3): V3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return o;
}

/** Build an orthonormal basis (rows = x, y, z axes) whose z axis is `zAxis` and whose x axis is as close as possible to `xHint`. */
export function basisFromZX(zAxis: V3, xHint: V3): Mat3 {
  const z = vNorm(zAxis);
  let x = vSub(xHint, vScale(z, vDot(xHint, z)));
  x = vLen(x) < 1e-9 ? vPerp(z) : vNorm(x);
  const y = vCross(z, x);
  return [x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z];
}
