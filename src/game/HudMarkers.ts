import { CanvasTexture, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from 'three';

/**
 * A small canvas-drawn sprite floating in the cockpit (rig-local), always facing the eye, its size
 * given in CSS pixels on the screen (`w` x `h`): a phone's marker is as large as a desk's.
 */
class Marker {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private last = '';

  constructor(readonly w: number, readonly h: number, private draw: (c: CanvasRenderingContext2D, w: number, h: number, text: string) => void) {
    // (drawn at four canvas pixels per CSS pixel: sharp on a phone of three, mipmapped below)
    this.canvas.width = Math.round(w * 4);
    this.canvas.height = Math.round(h * 4);
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.minFilter = LinearMipmapLinearFilter;
    this.tex.magFilter = LinearFilter;
    // depth-tested: the cockpit's frame (nearer than the marker's 4 m) hides it, as it hides the sky
    this.mesh = new Mesh(new PlaneGeometry(1, h / w), new MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: true, depthWrite: false, toneMapped: false }));
    this.mesh.renderOrder = 999;
    this.mesh.frustumCulled = false;
  }

  set(text: string): void {
    if (text === this.last) return;
    this.last = text;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.scale(4, 4);
    this.draw(c, this.w, this.h, text);
    this.tex.needsUpdate = true;
  }

  /** Size on the screen: `cssPixel` radians per CSS pixel, the marker `dist` metres from the eye. */
  fit(cssPixel: number, dist: number): void {
    this.mesh.scale.setScalar(this.w * cssPixel * dist);
  }
}

const CYAN = 'rgba(140, 225, 255, 0.95)';
const SHADE = 'rgba(0, 8, 16, 0.55)';

/** Lines with a soft dark edge under them, so they read on a bright world as on the night. */
function stroked(c: CanvasRenderingContext2D, color: string, width: number, path: () => void): void {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = SHADE;
  c.lineWidth = width + 1.6;
  c.beginPath(); path(); c.stroke();
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath(); path(); c.stroke();
}

/**
 * Head-up display projected on the canopy: brackets round the target with its distance under them
 * (its name is the label on the sky beside it; an arrow at the edge when it is behind you), the
 * flight-path marker (where the ship is going) and a boresight (where the nose points). Lives in
 * the rig's frame, 4 m out (beyond the frame, which hides it), sized for the screen in CSS pixels.
 */
export class HudMarkers {
  readonly group = new Group();
  private target: Marker;
  private flight: Marker;
  private bore: Marker;
  private readonly R = 4;
  /** radians per CSS pixel of the view (set every frame by the game) */
  cssPixel = 0.0015;

  constructor() {
    // the brackets: four corners round a 34 px square, the distance under them
    this.target = new Marker(96, 72, (c, w, h, text) => {
      const [, dist, step] = text.split('|');
      const s = 34, x0 = (w - s) / 2, y0 = 6, k = 8;
      stroked(c, CYAN, 1.6, () => {
        for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x0 + s, y0, -1, 1], [x0, y0 + s, 1, -1], [x0 + s, y0 + s, -1, -1]]) {
          c.moveTo(x + dx * k, y); c.lineTo(x, y); c.lineTo(x, y + dy * k);
        }
      });
      // pinned at the edge of the clear part of the view: an arrow in the square, pointing the way to the target
      if (step) {
        const a = (Number(step) * Math.PI) / 12, ux = Math.cos(a), uy = Math.sin(a), cx = w / 2, cy = y0 + s / 2;
        c.fillStyle = CYAN;
        c.strokeStyle = SHADE;
        c.lineWidth = 2.4;
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(cx + ux * 10, cy + uy * 10);
        c.lineTo(cx - ux * 5 - uy * 7, cy - uy * 5 + ux * 7);
        c.lineTo(cx - ux * 2, cy - uy * 2);
        c.lineTo(cx - ux * 5 + uy * 7, cy - uy * 5 - ux * 7);
        c.closePath();
        c.stroke();
        c.fill();
      }
      c.font = '600 10.5px Inter, system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 3;
      c.strokeStyle = SHADE;
      c.strokeText(dist ?? '', w / 2, y0 + s + 11, w - 4);
      c.fillStyle = CYAN;
      c.fillText(dist ?? '', w / 2, y0 + s + 11, w - 4);
      void h;
    });
    // where the ship is going: a small circle with wings and a fin
    this.flight = new Marker(24, 24, (c, w) => {
      const m = w / 2;
      stroked(c, 'rgba(165, 255, 180, 0.92)', 1.5, () => {
        c.moveTo(m + 4.5, m); c.arc(m, m, 4.5, 0, Math.PI * 2);
        c.moveTo(m - 10, m); c.lineTo(m - 4.5, m);
        c.moveTo(m + 4.5, m); c.lineTo(m + 10, m);
        c.moveTo(m, m - 4.5); c.lineTo(m, m - 9);
      });
    });
    // where the nose points: a faint cross with a gap
    this.bore = new Marker(16, 16, (c, w) => {
      const m = w / 2;
      stroked(c, 'rgba(255, 255, 255, 0.5)', 1.2, () => {
        c.moveTo(m - 6, m); c.lineTo(m - 2, m); c.moveTo(m + 2, m); c.lineTo(m + 6, m);
        c.moveTo(m, m - 6); c.lineTo(m, m - 2); c.moveTo(m, m + 2); c.lineTo(m, m + 6);
      });
    });
    this.bore.set('+');
    this.flight.set('o');
    this.group.add(this.target.mesh, this.flight.mesh, this.bore.mesh);
    this.group.name = 'hud-markers';
    this.group.visible = false;
  }

  /**
   * `targetDirRig`: unit direction to the target in rig-local axes (null = none); `velDirRig`:
   * direction of motion (null when still). Text: "name|distance". `pin`: undefined puts a target
   * off to the side or behind at the edge of a symmetric view (a headset, which has no screen to
   * measure on); null places the brackets on the direction as it is; a number places them there
   * too, with an arrow in them pointing that way on the screen (in 15 degree steps, 0 to the
   * right, clockwise): the game has put the direction at the edge of the clear part of the view.
   */
  update(targetDirRig: Vector3 | null, text: string, velDirRig: Vector3 | null, pin?: number | null): void {
    const face = (m: Mesh, dir: Vector3) => {
      m.position.copy(dir).multiplyScalar(this.R);
      m.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir.clone().negate()));
    };
    for (const m of [this.target, this.flight, this.bore]) m.fit(this.cssPixel, this.R);
    this.bore.mesh.position.set(0, 0, -this.R);
    this.target.mesh.visible = !!targetDirRig;
    if (targetDirRig) {
      // behind or far off to the side: pin to the edge of the view, pointing the way
      const d = targetDirRig.clone();
      if (pin === undefined && d.z > -0.35) {
        const side = new Vector3(d.x, d.y, 0);
        if (side.lengthSq() < 1e-6) side.set(0, -1, 0);
        side.normalize();
        d.set(side.x * 0.55, side.y * 0.4, -0.75).normalize();
      }
      face(this.target.mesh, d);
      // (the brackets' square is centred on the target: the quad's middle sits a little lower)
      this.target.mesh.translateY(-(this.target.h / 2 - 23) * this.cssPixel * this.R);
      this.target.set(typeof pin === 'number' ? `${text}|${pin}` : text);
    }
    this.flight.mesh.visible = !!velDirRig && velDirRig.z < -0.2;
    if (velDirRig && this.flight.mesh.visible) face(this.flight.mesh, velDirRig);
  }
}
