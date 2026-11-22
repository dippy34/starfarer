import { DoubleSide, Group, Matrix4, Mesh, Vector3 } from 'three';
import { COLORS, Panel } from '../vr/Panel';
import { arc, canopyFrame } from './cockpitDesign';
import { ccw, type Finish, GROUP, MeshBuilder, PATTERN, roundedPolygon, smoothPath } from './shipGeometry';
import { glassMaterial, shipMaterial } from './shipShader';

/** What the cockpit screens show (filled in by the game every few frames). */
export interface CockpitReadout {
  speed: string;
  throttle: number;        // -1..1
  /** the engine in use, shown over the throttle ('' for none) */
  drive: string;
  altitude: string;
  reference: string;
  target: string;
  targetKind: string;
  distance: string;
  eta: string;
  autopilot: 'ready' | 'flying' | 'no target';
  time: string;
  missions: string;
  hint: string;
  /** real-physics flight data (null outside the ship's physics) */
  flight: { lines: string[]; g: string; sas: string; fuel: number; clocks: string; warning: string; lock: string } | null;
}

/** A frame member as the label mask sees it: its centre line (rig-local) and half its width (m). */
export interface Member { path: Vector3[]; half: number }

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

// finishes: the frame dark anodised metal, the console soft-touch black, its details
const FRAME: Finish = { color: [0.045, 0.046, 0.05], rough: 0.26, metal: 0, pattern: PATTERN.dark };
const SILL: Finish = { color: [0.03, 0.031, 0.034], rough: 0.42, metal: 0.0, pattern: PATTERN.dark };
const CONSOLE: Finish = { color: [0.028, 0.029, 0.032], rough: 0.62, metal: 0.0, pattern: PATTERN.dark };
const BEZEL: Finish = { color: [0.06, 0.062, 0.068], rough: 0.35, metal: 0.6, pattern: PATTERN.brushed };
const LED_GREEN: Finish = { color: [0.25, 1.0, 0.55], rough: 0.3, metal: 0, pattern: PATTERN.emit, group: GROUP.cabin };
const LED_AMBER: Finish = { color: [1.0, 0.62, 0.18], rough: 0.3, metal: 0, pattern: PATTERN.emit, group: GROUP.cabin };
const LED_LINE: Finish = { color: [0.45, 0.7, 1.0], rough: 0.3, metal: 0, pattern: PATTERN.emit, group: GROUP.cabin };

/** A rounded-rectangle profile: `w` across (what the eye sees as the member's width), `d` deep. */
const profile = (w: number, d: number, r: number) => ccw(roundedPolygon([[w, -d], [w, d], [-w, d], [-w, -d]], r, 2));

/**
 * The canopy around the pilot's eye (rig-local metres, looking down -z), designed so that space
 * fills the view: a slim, dark frame (the sill, two windscreen pillars far out to the sides, the bow
 * over the windscreen, a spine overhead, a rear bow and the upper rails), lit by the star and the
 * world nearby like the ship (its rounded edges catch the light), and the glass, which shows only a
 * glint of the star, a sheen, and the dust it lights up when looking towards it. On a touch screen
 * the dashboard is only its top edge, low in the view (the instruments are the interface's card);
 * at a desk and in a headset a console under the windscreen carries three live screens.
 * It hangs off the camera rig, so in VR the head moves inside it.
 */
export class Cockpit {
  readonly group = new Group();
  readout: CockpitReadout = {
    speed: '0 m/s', throttle: 0, drive: '', altitude: '', reference: '', target: 'none', targetKind: '', distance: '', eta: '',
    autopilot: 'no target', time: '', missions: '', hint: '', flight: null,
  };
  /** the frame's members, for the names' mask */
  readonly members: Member[] = [];
  /** the top edge of the dashboard shown (rig-local): everything under it is hidden */
  edge: Vector3[] = [];
  private screens: Panel[] = [];
  private timer = 0;
  private glass: Mesh;
  private low: Mesh;
  private high: Mesh;
  private lowEdge: Vector3[] = [];
  private highEdge: Vector3[] = [];
  private frameMat = shipMaterial({ side: DoubleSide });
  private glassMat = glassMaterial();

  constructor() {
    this.group.name = 'cockpit';
    const b = new MeshBuilder();
    // the frame (`cockpitDesign.ts`): each member swept along its line, its profile across the view
    // (the up of each section is outwards, away from the eye)
    for (const m of canopyFrame()) {
      const path = smoothPath(m.pts, m.per ?? 6);
      b.sweep(path, profile(m.half, m.depth, Math.min(m.half, m.depth) * 0.7), m.sill ? SILL : FRAME, path[0].clone().normalize(), true);
      this.members.push({ path, half: m.half });
    }
    const frame = new Mesh(b.geometry(), this.frameMat);
    this.place(frame, 20);

    // the glass: a dome round the eye just outside the frame (the frame and the dashboard hide what
    // is behind them), from below the sill's line to the zenith, all round but straight behind
    {
      const g = new MeshBuilder();
      const rings: Vector3[][] = [];
      for (let i = 0; i <= 14; i++) {
        const el = (-38 + (128 * i) / 14) * (Math.PI / 180);
        const ring: Vector3[] = [];
        for (let j = 0; j <= 32; j++) {
          const az = (-150 + (300 * j) / 32) * (Math.PI / 180);
          ring.push(V(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(1.02).add(V(0, 0, -0.04)));
        }
        rings.push(ring);
      }
      g.grid(rings, { color: [0, 0, 0], rough: 0.05, metal: 0, pattern: PATTERN.glass }, false);
      this.glassMat.side = DoubleSide;
      this.glass = new Mesh(g.geometry(), this.glassMat);
      this.place(this.glass, 22);
    }

    // the dashboard on a touch screen: only its top, low under the sill (the instruments are a card)
    {
      const c = new MeshBuilder();
      const path = arc(0.83, -0.585, -72, 72, 24);
      // (sections across the arc: up is the profile's x, outwards its y)
      const top = ccw(roundedPolygon([[0.012, 0.05], [0.014, -0.02], [-0.02, -0.06], [-0.36, -0.2], [-0.4, -0.05], [-0.04, 0.06]], [0.01, 0.012, 0.015, 0.03, 0.03, 0.02], 2));
      c.sweep(path, top, CONSOLE, path[0].clone().setY(0).normalize(), true);
      this.lowEdge = path.map((p) => p.clone().setY(p.y + 0.014));
      this.low = new Mesh(c.geometry(), this.frameMat);
      this.place(this.low, 20);
    }

    // the console at a desk and in a headset: higher, its face turned to the pilot with three screens
    const left = new Panel(384, 288, 0.24, (p) => this.paintLeft(p));
    const centre = new Panel(512, 288, 0.32, (p) => this.paintCentre(p));
    const right = new Panel(384, 288, 0.24, (p) => this.paintRight(p));
    {
      const c = new MeshBuilder();
      const R = 0.66, Y = -0.21;
      const rim = arc(R, Y, -66, 66, 28);
      // the section: glareshield lip, the face sloping down towards the pilot, the underside
      const sec = ccw(roundedPolygon([[0.012, 0.075], [0.024, 0.0], [0.0, -0.05], [-0.19, -0.125], [-0.27, -0.07], [-0.27, 0.12]], [0.01, 0.016, 0.012, 0.03, 0.03, 0.02], 2));
      c.sweep(rim, sec, CONSOLE, rim[0].clone().setY(0).normalize(), true);
      // bezels round the screens, a thin light line under the lip, a few indicator lamps
      const faceAt = (u: number, a: number) => {
        // a point on the face, u from its top (0) to its bottom (1), at angle a (rad) round the eye
        const s = 0.0 - 0.19 * u, w = -0.05 - 0.075 * u;
        const radial = V(Math.sin(a), 0, -Math.cos(a));
        return V(0, Y + s, 0).addScaledVector(radial, R + w);
      };
      const faceNormal = (a: number) => {
        const n = V(0, 0.075, 0).addScaledVector(V(Math.sin(a), 0, -Math.cos(a)), -0.19);
        return n.normalize();
      };
      const lineArc = Array.from({ length: 25 }, (_, i) => { const a = (-60 + (120 * i) / 24) * (Math.PI / 180); return faceAt(0.02, a).addScaledVector(faceNormal(a), 0.002); });
      c.sweep(lineArc, ccw(roundedPolygon([[0.0016, 0.0012], [-0.0016, 0.0012], [-0.0016, -0.0012], [0.0016, -0.0012]], 0, 1)), LED_LINE, lineArc[0].clone().setY(0).normalize(), true);
      const screen = (p: Panel, deg: number, wide: number) => {
        const a = (deg * Math.PI) / 180;
        const mid = faceAt(0.5, a), n = faceNormal(a);
        const m = new Matrix4().lookAt(mid.clone().add(n), mid, V(0, 1, 0));
        m.setPosition(mid.clone().addScaledVector(n, 0.004));
        p.mesh.matrix.copy(m);
        p.mesh.matrixAutoUpdate = false;
        // a bezel: a thin brushed frame standing round the glass
        const h = (wide * p.height) / p.width;
        c.box(0, 0, -0.003, wide + 0.012, h + 0.012, 0.004, BEZEL, 0.004, m);
      };
      screen(left, -30, 0.24);
      screen(centre, 0, 0.32);
      screen(right, 30, 0.24);
      // indicator lamps along the lip's ends
      for (const s of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const a = s * (47 + k * 3.2) * (Math.PI / 180);
          const p = faceAt(0.12, a).addScaledVector(faceNormal(a), 0.002);
          c.box(p.x, p.y, p.z, 0.012, 0.006, 0.012, k % 2 ? LED_GREEN : LED_AMBER, 0.002);
        }
      }
      this.highEdge = rim.map((p) => p.clone().setY(p.y + 0.024));
      this.high = new Mesh(c.geometry(), this.frameMat);
      this.place(this.high, 20);
    }
    for (const s of [left, centre, right]) {
      // screens sit just above the console's face: depth-tested like the rest of the cockpit
      const m = s.mesh.material as { depthTest: boolean; depthWrite: boolean };
      m.depthTest = true;
      m.depthWrite = true;
      s.mesh.renderOrder = 21;
      this.group.add(s.mesh);
      this.screens.push(s);
    }
    this.setScreens(true);
    this.group.visible = false;
  }

  private place(mesh: Mesh, order: number): void {
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    this.group.add(mesh);
  }

  /** Show or hide the three screens: with them the console carrying them, without it only the dashboard's edge. */
  setScreens(on: boolean): void {
    for (const s of this.screens) s.mesh.visible = on;
    this.high.visible = on;
    this.low.visible = !on;
    this.edge = on ? this.highEdge : this.lowEdge;
  }

  /** The cabin's own lamps (0 dark .. 1) on the console and the glass's sheen. */
  setCabin(level: number): void {
    (this.frameMat.uniforms.uCh.value as number[])[0] = level;
  }

  update(dt: number): void {
    this.timer -= dt;
    if (!this.screens[0].mesh.visible) return;
    if (this.timer > 0) return;
    this.timer = 0.2;
    for (const s of this.screens) { s.dirty = true; s.update(); }
  }

  /** The glass's whole sheen (1: as designed; 0: none, e.g. for a photo). */
  setGlass(level: number): void {
    this.glassMat.uniforms.uGlass.value = level;
    this.glass.visible = level > 0;
  }

  /** A display's face: near-black glass, a hairline frame, the title small and spaced. */
  private frame(p: Panel, title: string): void {
    const c = p.ctx;
    c.clearRect(0, 0, p.width, p.height);
    const g = c.createLinearGradient(0, 0, 0, p.height);
    g.addColorStop(0, 'rgba(10, 16, 26, 0.98)');
    g.addColorStop(1, 'rgba(3, 6, 12, 0.98)');
    c.beginPath();
    c.roundRect(2, 2, p.width - 4, p.height - 4, 10);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = 'rgba(150, 190, 255, 0.28)';
    c.lineWidth = 2;
    c.stroke();
    c.save();
    c.font = `700 17px Inter, system-ui, sans-serif`;
    c.fillStyle = 'rgba(150, 175, 210, 0.85)';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '3px';
    c.fillText(title, 18, 26);
    c.restore();
    p.rect(18, 40, 36, 2, 1, 'rgba(127, 178, 255, 0.7)');
  }

  private paintLeft(p: Panel): void {
    const r = this.readout;
    this.frame(p, 'FLIGHT');
    p.text(r.speed, 18, 92, 44, '#ffffff', 700, 'left', p.width - 36);
    p.text(r.drive || 'throttle', 18, 128, 20, r.drive.startsWith('REACTIONLESS') || r.drive === 'BOOST' ? COLORS.warn : COLORS.dim, 600, 'left', p.width - 36);
    // throttle bar
    const w = p.width - 36, x0 = 18, y0 = 146;
    p.rect(x0, y0, w, 14, 7, 'rgba(255,255,255,0.06)');
    const t = Math.max(-1, Math.min(1, r.throttle));
    const mid = x0 + w / 2;
    p.rect(t >= 0 ? mid : mid + (w / 2) * t, y0, (w / 2) * Math.abs(t), 14, 7, t >= 0 ? COLORS.accent : COLORS.warn);
    p.text('altitude', 18, 210, 20, COLORS.dim, 600);
    p.text(r.altitude, 18, 246, 30, COLORS.text, 600, 'left', p.width - 36);
    if (r.flight) {
      // propellant gauge along the bottom
      p.rect(18, 262, p.width - 36, 8, 4, 'rgba(255,255,255,0.06)');
      p.rect(18, 262, (p.width - 36) * Math.max(0, Math.min(1, r.flight.fuel)), 8, 4, r.flight.fuel < 0.1 ? COLORS.warn : '#9dff8a');
    }
  }

  private paintCentre(p: Panel): void {
    const r = this.readout;
    if (r.flight) {
      // orbit screen (speed and clocks when fast): then the target line and the autopilot's state
      const f = r.flight;
      this.frame(p, 'ORBIT');
      f.lines.forEach((l, i) => p.text(l, 18, 80 + i * 34, 26, l.startsWith('IMPACT') ? COLORS.warn : COLORS.text, 600, 'left', p.width - 36));
      p.text(`${r.target}${r.distance ? ` · ${r.distance}` : ''}`, 18, 188, 20, r.target === 'none' ? COLORS.dim : COLORS.sel, 600, 'left', p.width - 36);
      const ap = r.autopilot === 'flying' ? 'AUTOPILOT FLYING' : f.lock || (r.autopilot === 'ready' ? 'AUTOPILOT READY' : 'SELECT A TARGET');
      p.rect(18, 220, p.width - 36, 46, 10, r.autopilot === 'flying' ? 'rgba(127,178,255,0.3)' : 'rgba(255,255,255,0.04)', 'rgba(127, 178, 255, 0.3)', 2);
      p.text(ap, p.width / 2, 244, 22, f.lock ? COLORS.warn : r.autopilot === 'flying' ? '#ffffff' : r.autopilot === 'ready' ? COLORS.accent : COLORS.dim, 700, 'center');
      return;
    }
    this.frame(p, 'NAVIGATION');
    p.text(r.target, 18, 84, 38, r.target === 'none' ? COLORS.dim : COLORS.sel, 700, 'left', p.width - 36);
    p.text(r.targetKind, 18, 114, 20, COLORS.dim, 500, 'left', p.width - 36);
    if (r.distance) {
      p.text(r.distance, 18, 160, 32, COLORS.text, 600, 'left', p.width - 36);
      p.text(r.eta, 18, 196, 22, COLORS.dim, 500, 'left', p.width - 36);
    }
    const ap = r.autopilot === 'flying' ? 'AUTOPILOT FLYING' : r.autopilot === 'ready' ? 'AUTOPILOT READY' : 'SELECT A TARGET';
    p.rect(18, 220, p.width - 36, 46, 10, r.autopilot === 'flying' ? 'rgba(127,178,255,0.3)' : 'rgba(255,255,255,0.04)', 'rgba(127, 178, 255, 0.3)', 2);
    p.text(ap, p.width / 2, 244, 22, r.autopilot === 'flying' ? '#ffffff' : r.autopilot === 'ready' ? COLORS.accent : COLORS.dim, 700, 'center');
  }

  private paintRight(p: Panel): void {
    const r = this.readout;
    if (r.flight) {
      const f = r.flight;
      this.frame(p, 'STATUS');
      p.text(r.reference, 18, 70, 22, COLORS.text, 600, 'left', p.width - 36);
      p.text(`${f.g} · SAS ${f.sas}`, 18, 104, 22, COLORS.text, 600, 'left', p.width - 36);
      p.text(f.clocks, 18, 138, 18, COLORS.dim, 500, 'left', p.width - 36);
      p.text(r.time, 18, 168, 18, COLORS.dim, 500, 'left', p.width - 36);
      if (f.warning) p.text(f.warning, 18, 214, 24, COLORS.warn, 700, 'left', p.width - 36);
      p.text(r.hint, 18, 270, 16, COLORS.dim, 400, 'left', p.width - 36);
      return;
    }
    this.frame(p, 'STATUS');
    p.text('near', 18, 70, 20, COLORS.dim, 600);
    p.text(r.reference, 18, 100, 28, COLORS.text, 600, 'left', p.width - 36);
    p.text('time', 18, 136, 20, COLORS.dim, 600);
    p.text(r.time, 18, 166, 24, COLORS.text, 500, 'left', p.width - 36);
    p.text('missions', 18, 204, 20, COLORS.dim, 600);
    p.text(r.missions, 18, 234, 24, COLORS.warn, 600, 'left', p.width - 36);
    p.text(r.hint, 18, 270, 16, COLORS.dim, 400, 'left', p.width - 36);
  }
}
