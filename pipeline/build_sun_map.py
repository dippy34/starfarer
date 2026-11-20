"""The Sun's face: a whole-sphere map of the real Sun -> public/data/textures/sun.jpg.

Source: NASA/Goddard Space Flight Center Scientific Visualization Studio, "STEREO+SDO: Around the
Sun for 81 Days" (SVS 3851, T. Bridgman; public domain): 611 maps of the whole Sun, 4096 x 2048,
cylindrical-equidistant, in the extreme ultraviolet (He II 304 Å), each put together from the
three spacecraft that between them saw all of the Sun at once in April to June 2011 (STEREO-A,
STEREO-B and SDO). It is the light the well-known orange pictures of the Sun are taken in.

One frame is not enough. Where the view of one spacecraft ends and the next begins, both see the
surface at a grazing angle and the map is smeared along the longitude, worst on the side turned
away from the Earth. The maps are in Carrington longitude: the Sun turns under those seams, and
every longitude is well seen in some frame. So the map written here takes each longitude from the
frame in which it is sharpest, of three about a week apart (FRAMES): a synoptic map, as the classic
ones are assembled over a rotation. Real observations throughout, but not one instant.

Stored is the pattern only, as sqrt(p / 4) with p the brightness over the median (the frames are
display pictures in the instrument's colour table, not calibrated intensities; the app draws the
pattern in its own colours, render/StarLook.ts). The active regions, the brightest patches, are
written to the manifest: the Sun's prominences stand on them.

Run after fetch_textures.py: it extends public/data/textures/manifest.json.
"""
from __future__ import annotations

import json

import numpy as np
from PIL import Image

from common import OUT, RAW, download, write_json

Image.MAX_IMAGE_PIXELS = None
TEX = OUT / "textures"
SRC = RAW / "sun"

PAGE = "https://svs.gsfc.nasa.gov/3851"
BASE = "https://svs.gsfc.nasa.gov/vis/a000000/a003800/a003851/frames/4096x2048_2x1_30p/"
# the Sun turns once under the seams in about 218 frames: a quarter and a half turn after the first
FRAMES = (200, 255, 309)
W, H = 4096, 2048
# the brightest value stored, over the median (an active region's core)
TOP = 4.0
# the most active regions listed (two spots each: render/StarLook.ts SPOT_SLOTS)
REGIONS = 8


def smooth_wrap(a: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian smoothing of a ring of values (along the longitude)."""
    k = np.fft.rfftfreq(a.shape[-1])
    return np.fft.irfft(np.fft.rfft(a) * np.exp(-2 * (np.pi * k * sigma) ** 2), a.shape[-1])


def pattern(frame: int) -> tuple[np.ndarray, np.ndarray]:
    """A frame's brightness over its median, and how sharp it is at each longitude."""
    src = download(f"{BASE}solarSphere304A.{frame:04d}.tif", SRC / f"solarSphere304A.{frame:04d}.tif", min_size=1_000_000)
    a = np.asarray(Image.open(src).convert("RGB"), dtype=np.float32) / 255.0
    assert a.shape == (H, W, 3), a.shape
    # the colour table runs black, red, orange, yellow, white: red is at its top nearly everywhere,
    # green and then blue carry the brightness
    v = a[..., 1] + 0.5 * a[..., 2]
    p = v / np.median(v[H // 6: -H // 6])
    # smeared along the longitude, a map has lost its detail that way and kept it the other way
    mid = p[H // 4: -H // 4]
    along = np.abs(mid - np.roll(mid, 1, axis=1)).mean(axis=0)
    across = np.abs(np.diff(mid, axis=0)).mean(axis=0)
    return p, smooth_wrap(along, 60) / smooth_wrap(across, 60)


def regions(p: np.ndarray) -> list[list[float]]:
    """The active regions: latitude, longitude east and radius (degrees), brightest first."""
    scale = 4
    small = p.reshape(H // scale, scale, W // scale, scale).mean(axis=(1, 3))
    # (blurred over about a degree: a region, not its brightest thread)
    blur = smooth_wrap(smooth_wrap(small, 3).T, 3).T
    h, w = blur.shape
    deg = 180.0 / h
    lat = 90 - (np.arange(h) + 0.5) * deg
    blur[np.abs(lat) > 50] = 0
    found: list[list[float]] = []
    while len(found) < REGIONS:
        y, x = np.unravel_index(np.argmax(blur), blur.shape)
        peak = float(blur[y, x])
        if peak < 1.8:
            break
        # its size: the patch at least half-way from the quiet Sun to its peak
        reach = int(8 / deg)
        ys = np.arange(max(0, y - reach), min(h, y + reach + 1))
        xs = np.arange(x - reach, x + reach + 1) % w
        patch = blur[np.ix_(ys, xs)]
        area = float((patch > 1 + 0.5 * (peak - 1)).sum()) * deg * deg * np.cos(np.radians(lat[y]))
        found.append([round(float(lat[y]), 1), round(float((x + 0.5) * deg - 180), 1), round(float(np.clip(np.sqrt(area / np.pi), 1.5, 5.0)), 1)])
        # (the next one is at least 14 degrees away)
        clear = int(14 / deg)
        yy = np.arange(max(0, y - clear), min(h, y + clear + 1))
        xx = np.arange(x - int(clear / np.cos(np.radians(lat[y]))), x + int(clear / np.cos(np.radians(lat[y]))) + 1) % w
        blur[np.ix_(yy, xx)] = 0
    return found


def main() -> None:
    frames = [pattern(f) for f in FRAMES]
    # each longitude from the frame that is sharpest there, the change from one to the next
    # spread over a few degrees
    sharp = np.stack([s for _, s in frames]) ** 16
    weight = smooth_wrap(sharp / sharp.sum(axis=0), 30)
    weight = np.clip(weight, 0, None)
    weight /= weight.sum(axis=0)
    p = sum(w[None, :] * f for w, (f, _) in zip(weight, frames))
    for f, w, (_, s) in zip(FRAMES, weight, frames):
        print(f"  frame {f}: {w.mean() * 100:.0f} % of the map; sharpness along/across {s.min():.2f} to {s.max():.2f}")
    best = np.stack([s for _, s in frames]).max(axis=0)
    print(f"  the map: sharpness {best.min():.2f} to {best.max():.2f}; brightness 1 % {np.percentile(p, 1):.2f}, 99 % {np.percentile(p, 99):.2f}, 99.9 % {np.percentile(p, 99.9):.2f}")
    img = Image.fromarray((255 * np.sqrt(np.clip(p / TOP, 0, 1)) + 0.5).astype(np.uint8), "L")
    dest = TEX / "sun.jpg"
    img.save(dest, quality=86, optimize=True, progressive=True)
    print(f"  sun: {img.size} L -> {dest.stat().st_size / 1e3:.0f} kB")
    found = regions(p)
    print(f"  {len(found)} active regions (lat, lon, radius): {found}")

    man_path = TEX / "manifest.json"
    man = json.loads(man_path.read_text())
    man["maps"]["sun"] = {
        "file": "sun.jpg", "width": W, "height": H, "channels": "L", "lonLeft": -180,
        "credit": "NASA/Goddard Space Flight Center Scientific Visualization Studio, STEREO+SDO: Around the Sun for 81 Days "
                  "(T. Bridgman): STEREO/SECCHI EUVI and SDO/AIA at 304 Å, late April to mid May 2011",
        "source": PAGE, "license": "Public domain (U.S. Government work)",
        "note": f"brightness pattern, sqrt(p / {TOP:g}); each longitude from the sharpest of frames {', '.join(str(f) for f in FRAMES)} of the 611",
        "regions": found,
    }
    write_json(man_path, man, compact=False)


if __name__ == "__main__":
    main()
