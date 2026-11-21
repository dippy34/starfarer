"""Contact sheets: frames of shot folders, or of a finished video at one frame per second.

    python3 trailer/sheet.py out.png DIR [DIR ...] [--every N] [--width 180]
    python3 trailer/sheet.py out.png --video file.mp4 [--width 180]

Each tile is labelled (folder and frame, or the video's time code).
"""
import glob
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def opt(name, default):
    if f'--{name}' in sys.argv:
        i = sys.argv.index(f'--{name}')
        v = sys.argv[i + 1]
        del sys.argv[i:i + 2]
        return v
    return default


def video_frames(path, width):
    """One frame per second (the frame at each whole second), scaled to `width`."""
    info = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                           '-of', 'csv=p=0', path], capture_output=True, text=True, check=True).stdout.strip().split(',')
    w, h = int(info[0]), int(info[1])
    hh = round(h * width / w)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'fps=1:start_time=0:round=down,scale={width}:{hh}',
                          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    n = len(raw) // (width * hh * 3)
    arr = np.frombuffer(raw, np.uint8)[:n * width * hh * 3].reshape(n, hh, width, 3)
    return [(Image.fromarray(a), f'{i // 60}:{i % 60:02d}') for i, a in enumerate(arr)]


def main():
    width = int(opt('width', 180))
    every = int(opt('every', 1))
    video = opt('video', None)
    out = sys.argv[1]
    tiles = []
    if video:
        tiles = video_frames(video, width)
    else:
        for d in sys.argv[2:]:
            files = sorted(glob.glob(os.path.join(d, 'f*.png')))[::every]
            for f in files:
                im = Image.open(f).convert('RGB')
                im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
                tiles.append((im, f'{os.path.basename(d)} {os.path.basename(f)[1:-4]}'))
    if not tiles:
        sys.exit('nothing to show')
    cols = min(len(tiles), 8)
    rows = (len(tiles) + cols - 1) // cols
    tw, th = tiles[0][0].size
    pad, label = 6, 18
    sheet = Image.new('RGB', (cols * (tw + pad) + pad, rows * (th + label + pad) + pad), (40, 40, 44))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(subprocess.run(['fc-match', '-f', '%{file}', 'Inter:weight=500'], capture_output=True, text=True).stdout, 12)
    for i, (im, text) in enumerate(tiles):
        x = pad + (i % cols) * (tw + pad)
        y = pad + (i // cols) * (th + label + pad)
        sheet.paste(im.resize((tw, th)), (x, y + label))
        draw.text((x + 2, y + 2), text, fill=(230, 230, 230), font=font)
    sheet.save(out)
    print(out, sheet.size, len(tiles), 'tiles')


main()
