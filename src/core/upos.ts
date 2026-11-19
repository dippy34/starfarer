import { Vector3 } from 'three';

/**
 * Universal position: each axis is a double-double (hi + lo) number of metres,
 * giving ~32 significant digits. That is enough to place a camera millimetres
 * above a planet's surface in a galaxy 100 Mpc away. Only differences between
 * two UPos values (camera-relative vectors) are ever converted to plain doubles
 * and then to float32 for the GPU — this is the "floating origin".
 */
export class UPos {
  xh = 0; xl = 0;
  yh = 0; yl = 0;
  zh = 0; zl = 0;

  static from(x: number, y: number, z: number): UPos {
    const p = new UPos();
    p.xh = x; p.yh = y; p.zh = z;
    return p;
  }

  set(x: number, y: number, z: number): this {
    this.xh = x; this.xl = 0; this.yh = y; this.yl = 0; this.zh = z; this.zl = 0;
    return this;
  }

  copy(o: UPos): this {
    this.xh = o.xh; this.xl = o.xl; this.yh = o.yh; this.yl = o.yl; this.zh = o.zh; this.zl = o.zl;
    return this;
  }

  clone(): UPos {
    return new UPos().copy(this);
  }

  /** this += (x, y, z) with error-free transformation. */
  addXYZ(x: number, y: number, z: number): this {
    ddAdd(this.xh, this.xl, x); this.xh = hi; this.xl = lo;
    ddAdd(this.yh, this.yl, y); this.yh = hi; this.yl = lo;
    ddAdd(this.zh, this.zl, z); this.zh = hi; this.zl = lo;
    return this;
  }

  addVec(v: Vector3, scale = 1): this {
    return this.addXYZ(v.x * scale, v.y * scale, v.z * scale);
  }

  /** this += o (both double-double). */
  addUPos(o: UPos): this {
    ddAddDD(this.xh, this.xl, o.xh, o.xl); this.xh = hi; this.xl = lo;
    ddAddDD(this.yh, this.yl, o.yh, o.yl); this.yh = hi; this.yl = lo;
    ddAddDD(this.zh, this.zl, o.zh, o.zl); this.zh = hi; this.zl = lo;
    return this;
  }

  /** out = this - o, as a plain double vector (exact up to the result's own precision). */
  sub(o: UPos, out = new Vector3()): Vector3 {
    out.x = ddSubToDouble(this.xh, this.xl, o.xh, o.xl);
    out.y = ddSubToDouble(this.yh, this.yl, o.yh, o.yl);
    out.z = ddSubToDouble(this.zh, this.zl, o.zh, o.zl);
    return out;
  }

  /** Lossy conversion to a plain double vector (for display / coarse maths only). */
  toVector3(out = new Vector3()): Vector3 {
    return out.set(this.xh + this.xl, this.yh + this.yl, this.zh + this.zl);
  }

  /** Linear interpolation between a and b (t in [0, 1]) computed on the difference vector. */
  static lerp(a: UPos, b: UPos, t: number, out = new UPos()): UPos {
    const d = b.sub(a, _tmp);
    return out.copy(a).addXYZ(d.x * t, d.y * t, d.z * t);
  }
}

const _tmp = new Vector3();

// Double-double arithmetic (Dekker / Knuth error-free transformations). These run for every
// object every frame, so they return through two module variables instead of allocating a pair:
// a headset frame has no time to spare for the garbage collector.
let hi = 0;
let lo = 0;

/** (hi, lo) = (ah + al) + b */
function ddAdd(ah: number, al: number, b: number): void {
  const s = ah + b;
  const bb = s - ah;
  const e = ah - (s - bb) + (b - bb) + al;
  hi = s + e;
  lo = e - (hi - s);
}

/** (hi, lo) = (ah + al) + (bh + bl) */
function ddAddDD(ah: number, al: number, bh: number, bl: number): void {
  const s = ah + bh;
  const bb = s - ah;
  const e = ah - (s - bb) + (bh - bb) + al + bl;
  hi = s + e;
  lo = e - (hi - s);
}

/** (ah + al) - (bh + bl) as one double */
function ddSubToDouble(ah: number, al: number, bh: number, bl: number): number {
  const nb = -bh;
  const s = ah + nb;
  const bb = s - ah;
  const e = ah - (s - bb) + (nb - bb);
  return s + (e + al - bl);
}
