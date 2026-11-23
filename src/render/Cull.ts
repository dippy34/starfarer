import { Vector3, type Quaternion } from 'three';

/**
 * A view cone for cheap CPU culling of layers drawn relative to the eye (each draw call costs the
 * Quest's CPU far more than the GPU work it saves to skip): the direction the eye looks along and a
 * half-angle covering the whole view (the frame's corners, plus a margin for a headset's second
 * eye, head motion within the frame and glows that reach past their object).
 *
 * App sets VIEW_CONE once a frame; layers test bounding spheres given relative to the eye in any
 * unit (the test is scale-free).
 */
export class ViewCone {
  readonly dir = new Vector3(0, 0, -1);
  private half = Math.PI;
  /** off: everything is seen (before the first frame, and for tests) */
  enabled = false;

  /**
   * `fovY` degrees, `aspect` width/height, `marginRad` added to the corner half-angle. `shiftX` and
   * `shiftY`: how far the optical centre is off the view's middle, in half-heights of the view (the
   * frame reaches that much farther on the side it is shifted from: the corners are the far ones).
   */
  set(quat: Quaternion, fovY: number, aspect: number, marginRad: number, shiftX = 0, shiftY = 0): void {
    this.dir.set(0, 0, -1).applyQuaternion(quat);
    const t = Math.tan((fovY * Math.PI) / 360);
    const half = Math.atan(t * Math.hypot(aspect + shiftX, 1 + shiftY)) + marginRad;
    this.half = half;
    this.enabled = half < Math.PI;
  }

  /** Whether a sphere at (x, y, z) relative to the eye with radius `r` can be in view. */
  sees(x: number, y: number, z: number, r: number): boolean {
    if (!this.enabled) return true;
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d <= r) return true;
    const c = (x * this.dir.x + y * this.dir.y + z * this.dir.z) / d;
    // inside when the angle to the centre < half-angle + the sphere's angular radius
    const limit = this.half + Math.asin(r / d);
    return limit >= Math.PI || c > Math.cos(limit);
  }
}

export const VIEW_CONE = new ViewCone();
