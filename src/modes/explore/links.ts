/**
 * Share links and saved places.
 *
 * A view is stored as the camera's exact universe position and orientation
 * plus the simulation time (planets move!) and, optionally, which body of the
 * local system the camera was orbiting. Encoded as a compact URL fragment:
 *
 *   #v=1&p=<position>&q=<orientation>&t=<sim seconds>&f=<body index>&n=<name>
 */
import { type UPos, uposDecode, uposEncode } from '../../core/hp';

export interface ViewLink {
  pos: UPos;
  /** Orientation quaternion x, y, z, w. */
  quat: [number, number, number, number];
  /** Simulation time, seconds since J2000. */
  time: number;
  /** Index of the orbited body in the local star system, if any. */
  focus?: number;
  /** Display name (purely informative). */
  name?: string;
}

const Q_SCALE = 1e7;
const b36 = (n: number): string => (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toString(36);
const from36 = (s: string): number => (s.startsWith('-') ? -parseInt(s.slice(1), 36) : parseInt(s, 36));

export function encodeView(view: ViewLink): string {
  const p = new URLSearchParams();
  p.set('v', '1');
  p.set('p', uposEncode(view.pos));
  p.set('q', view.quat.map((c) => b36(c * Q_SCALE)).join('.'));
  p.set('t', b36(view.time));
  if (view.focus !== undefined && view.focus >= 0) p.set('f', String(view.focus));
  if (view.name) p.set('n', view.name.slice(0, 60));
  return p.toString();
}

export function decodeView(hash: string): ViewLink | null {
  try {
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    if (p.get('v') !== '1') return null;
    const pos = uposDecode(p.get('p') ?? '');
    const q = (p.get('q') ?? '').split('.').map((s) => from36(s) / Q_SCALE);
    const time = from36(p.get('t') ?? '');
    if (!pos || q.length !== 4 || q.some((c) => !Number.isFinite(c)) || !Number.isFinite(time)) return null;
    const len = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
    if (len < 1e-3) return null;
    const f = p.get('f');
    const focus = f !== null && /^\d+$/.test(f) ? Number(f) : undefined;
    return { pos, quat: [q[0]! / len, q[1]! / len, q[2]! / len, q[3]! / len], time, focus, name: p.get('n') ?? undefined };
  } catch {
    return null;
  }
}
