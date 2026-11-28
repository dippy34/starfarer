/// <reference lib="webworker" />
import { Vector3 } from 'three';
import { type CometRow, cometElements } from '../astro/comet';
import { type OrbitalElements, keplerState } from '../astro/kepler';
import { eclToEqu } from '../core/frames';
import { AU } from '../core/units';

/**
 * Propagates every catalogued comet (JPL SBDB elements: q, e, i, node, peri, tp)
 * in double precision off the main thread. Elliptic, near-parabolic and
 * hyperbolic orbits are all handled by keplerState.
 * Output: heliocentric ICRF positions in AU (float32) and apparent total magnitudes.
 */
let elements: OrbitalElements[] = [];
let m1: Float32Array = new Float32Array(0);
let k1: Float32Array = new Float32Array(0);

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    const rows = msg.comets as CometRow[];
    elements = rows.map(cometElements);
    m1 = new Float32Array(rows.map((r) => (r[8] ?? NaN)));
    k1 = new Float32Array(rows.map((r) => (r[9] ?? 10)));
    return;
  }
  if (msg.type === 'compute') {
    const jd = msg.jd as number;
    const obs = new Vector3(msg.observer[0], msg.observer[1], msg.observer[2]); // heliocentric, m
    const n = elements.length;
    const pos = new Float32Array(n * 3);
    const mag = new Float32Array(n);
    const p = new Vector3();
    for (let i = 0; i < n; i++) {
      keplerState(elements[i], jd, p);
      eclToEqu(p);
      pos[i * 3] = p.x / AU;
      pos[i * 3 + 1] = p.y / AU;
      pos[i * 3 + 2] = p.z / AU;
      const r = p.length() / AU;
      const delta = p.distanceTo(obs) / AU;
      // Total (coma) magnitude: m = M1 + 5 log10(delta) + K1 log10(r)
      mag[i] = Number.isFinite(m1[i]) ? m1[i] + 5 * Math.log10(Math.max(delta, 1e-9)) + k1[i] * Math.log10(Math.max(r, 1e-6)) : 99;
    }
    (self as unknown as Worker).postMessage({ type: 'result', jd, pos, mag }, [pos.buffer, mag.buffer]);
  }
};
