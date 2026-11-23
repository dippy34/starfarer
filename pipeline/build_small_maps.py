"""Small copies of the worlds' maps, for when a world is far off: public/data/textures/<map>_1k.jpg

    python3 -I pipeline/build_small_maps.py [textures dir]

Each map of the manifest (colour, night, clouds, relief; not the Sun's face, which is drawn only
near it) gets a copy 1,024 x 512 px, made from the map itself (Lanczos), and the manifest says so
(`small`). A world far behind the explorer keeps only that copy on the GPU (render/Bodies.ts: a
4,096 x 2,048 map is some 43 MB there with its mip levels, the copy under 3 MB); its full maps come
back as it comes near, the copy shown meanwhile.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

W, H = 1024, 512
SKIP = {"sun"}


def main() -> None:
    tex = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "public" / "data" / "textures"
    manifest = json.loads((tex / "manifest.json").read_text())
    total = 0
    for key, info in manifest["maps"].items():
        if key in SKIP:
            continue
        src = tex / info["file"]
        dest = tex / f"{key}_1k.jpg"
        img = Image.open(src)
        img.load()
        small = img.resize((W, H), Image.Resampling.LANCZOS)
        # (relief maps carry heights in their channels: no chroma subsampling to blur them into each other)
        small.save(dest, "JPEG", quality=90, subsampling=0 if info.get("channels", "").startswith("relief") else 2, optimize=True)
        info["small"] = {"file": dest.name, "width": W, "height": H}
        total += dest.stat().st_size
        print(f"  {key}: {img.size[0]}x{img.size[1]} {img.mode} -> {dest.name} ({dest.stat().st_size / 1e3:.0f} kB)")
    (tex / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"{total / 1e6:.2f} MB of small maps")


if __name__ == "__main__":
    main()
