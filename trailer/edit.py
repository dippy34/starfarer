"""The edit: captured frames, text and score into the finished video.

    python3 trailer/edit.py FRAMES_DIR SCORE.wav OUT.mp4 [--size 1080x1920] [--crf 18]

FRAMES_DIR holds one folder of frames per shot (capture.mjs). The cut, the text and the tempo are
in timeline.py. Frames are put together here with numpy (cuts, cross-fades, fades from and to
black, text over the picture, the interface shot inside a phone) and piped to ffmpeg: H.264 high
profile, yuv420p, BT.709, AAC 48 kHz stereo, +faststart, so it plays on an iPhone and in social apps.
Nothing is done to the footage itself beyond scaling it to the output size.
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from timeline import CUTS, FADE_OUT, FPS, LENGTH, TEXT  # noqa: E402


def opt(name, default):
    if f'--{name}' in sys.argv:
        i = sys.argv.index(f'--{name}')
        v = sys.argv[i + 1]
        del sys.argv[i:i + 2]
        return v
    return default


SIZE = tuple(int(x) for x in opt('size', '1080x1920').split('x'))
CRF = opt('crf', '18')
W, H = SIZE
K = W / 1080  # text and graphics are designed at 1080 wide


def font(name, px):
    path = subprocess.run(['fc-match', '-f', '%{file}', name], capture_output=True, text=True).stdout
    return ImageFont.truetype(path, round(px * K))


# ------------------------------------------------------------------------------------- text
# Safe area: nothing in the top 12 % or the bottom 20 % (social apps' own buttons cover those).
SAFE_TOP, SAFE_BOTTOM = 0.12 * H, 0.80 * H
STYLES = {
    # font, size (px at 1080 wide), letter spacing (em), line height, centre of the block (share of H)
    'line': ('Inter Display:weight=600', 74, -0.01, 1.18, 0.205),
    'low': ('Inter Display:weight=600', 74, -0.01, 1.18, 0.70),
    'top': ('Inter Display:weight=600', 66, -0.01, 1.18, 0.163),
    'title': ('Inter Display:weight=800', 132, 0.14, 1.0, 0.25),
    'tagline': ('Inter Display:weight=500', 50, 0.0, 1.3, 0.365),
    'url': ('Inter:weight=600', 62, 0.0, 1.0, 0.762),
    'name': ('Inter Display:weight=500', 50, 0.02, 1.0, 0.735),
    # over a phone's screen: on a dark plate, in the part of the sky its interface leaves clear
    'plate': ('Inter Display:weight=600', 62, -0.01, 1.18, 0.335),
    # (the same, higher: where the card of the shot grows up the screen to meet the first)
    'plate_hi': ('Inter Display:weight=600', 62, -0.01, 1.18, 0.255),
}


def draw_spaced(draw, xy, text, fnt, spacing_px, fill):
    """text with extra letter spacing (kerning kept within each pair by drawing pair advances)"""
    x, y = xy
    for i, ch in enumerate(text):
        draw.text((x, y), ch, font=fnt, fill=fill)
        nxt = text[i:i + 2]
        adv = fnt.getlength(nxt) - (fnt.getlength(text[i + 1]) if len(nxt) == 2 else 0)
        x += adv + spacing_px


def text_width(text, fnt, spacing_px):
    return fnt.getlength(text) + spacing_px * (len(text) - 1)


def render_card(style, lines):
    """an RGBA layer the size of the frame with the text on it, and a soft shadow for legibility"""
    name, px, track, lh, centre = STYLES[style]
    fnt = font(name, px)
    sp = track * px * K
    layer = Image.new('RGBA', SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    asc, desc = fnt.getmetrics()
    step = px * K * lh
    block = step * (len(lines) - 1) + asc
    y0 = centre * H - block / 2
    y0 = max(SAFE_TOP, min(y0, SAFE_BOTTOM - block - desc))
    for i, line in enumerate(lines):
        w = text_width(line, fnt, sp)
        draw_spaced(draw, ((W - w) / 2, y0 + i * step), line, fnt, sp, (255, 255, 255, 255))
    if style == 'url':
        # the call to action: in a thin outlined pill, so it reads as an address to go to
        w = max(text_width(l, fnt, sp) for l in lines)
        pad_x, pad_y = 34 * K, 20 * K
        top, bottom = y0 - pad_y + 0.12 * px * K, y0 + asc + desc * 0.4 + pad_y
        box = ((W - w) / 2 - pad_x, top, (W + w) / 2 + pad_x, bottom)
        pill = Image.new('RGBA', SIZE, (0, 0, 0, 0))
        ImageDraw.Draw(pill).rounded_rectangle(box, (bottom - top) / 2, fill=(0, 0, 0, 120), outline=(255, 255, 255, 220), width=max(2, round(3 * K)))
        layer = Image.alpha_composite(pill, layer)
        return np.asarray(layer).astype(np.float32) / 255.0
    if style.startswith('plate'):
        w = max(text_width(l, fnt, sp) for l in lines)
        pad_x, pad_y = 40 * K, 26 * K
        box = ((W - w) / 2 - pad_x, y0 - pad_y + 0.1 * px * K, (W + w) / 2 + pad_x, y0 + block + desc * 0.5 + pad_y)
        plate = Image.new('RGBA', SIZE, (0, 0, 0, 0))
        ImageDraw.Draw(plate).rounded_rectangle(box, 30 * K, fill=(8, 10, 16, 200))
        layer = Image.alpha_composite(plate, layer)
        return np.asarray(layer).astype(np.float32) / 255.0
    alpha = layer.split()[3]
    shadow = Image.new('RGBA', SIZE, (0, 0, 0, 0))
    shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(10 * K)).point(lambda v: int(v * 0.55)))
    out = Image.alpha_composite(shadow, layer)
    return np.asarray(out).astype(np.float32) / 255.0


# ------------------------------------------------------------------------------------- phone
# The interface shot is shown inside a phone: the screen's size and place in the frame.
PHONE_SCREEN_H = 0.565  # share of H (the phone ends above the bottom fifth)
PHONE_TOP = 0.22


def phone_layer(sw, sh):
    """the phone's body (RGBA, frame-sized) and where its screen goes"""
    x0 = round((W - sw) / 2)
    y0 = round(PHONE_TOP * H)
    bez = round(14 * K)
    r_screen = round(sw * 0.115)
    img = Image.new('RGBA', SIZE, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x0 - bez - 3 * K, y0 - bez - 3 * K, x0 + sw + bez + 3 * K, y0 + sh + bez + 3 * K), r_screen + bez + 3 * K, fill=(70, 72, 78, 255))
    d.rounded_rectangle((x0 - bez, y0 - bez, x0 + sw + bez, y0 + sh + bez), r_screen + bez, fill=(12, 12, 14, 255))
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), r_screen, fill=255)
    return np.asarray(img).astype(np.float32) / 255.0, (x0, y0), np.asarray(mask).astype(np.float32)[..., None] / 255.0


class Shot:
    """one captured shot: its frames, scaled to the output (or into the phone)"""

    def __init__(self, folder, shot_id):
        self.dir = os.path.join(folder, shot_id)
        self.files = sorted(f for f in os.listdir(self.dir) if f.startswith('f') and f.endswith('.png'))
        self.last = int(self.files[-1][1:5])
        info_path = os.path.join(self.dir, 'info.json')
        self.info = json.load(open(info_path)) if os.path.exists(info_path) else {}
        # (an interface shot is shown inside a phone, unless it was filmed full frame)
        self.ui = bool(self.info.get('ui')) and self.info.get('frame', 'phone') == 'phone'
        self.cache = {}
        if self.ui:
            im = Image.open(os.path.join(self.dir, self.files[0]))
            sh = round(PHONE_SCREEN_H * H)
            sw = round(sh * im.width / im.height)
            self.screen = (sw, sh)
            self.body, self.at, self.mask = phone_layer(sw, sh)
        else:
            # full frame; a screen taller than 9:16 (an iPhone's) fills the height, centred, and the
            # sides show a dark, blurred copy of it, as phones show a screen recording
            im = Image.open(os.path.join(self.dir, self.files[0]))
            sw = min(W, round(H * im.width / im.height))
            self.screen, self.at = (sw, H), ((W - sw) // 2, 0)

    def frame(self, i):
        # (frames by number: a shot may keep only parts of its run)
        i = max(0, min(i, self.last))
        if i in self.cache:
            return self.cache[i]
        name = f'f{i:04d}.png'
        if not os.path.exists(os.path.join(self.dir, name)):
            sys.exit(f'{self.dir}: no frame {i}')
        im = Image.open(os.path.join(self.dir, name)).convert('RGB')
        if self.ui:
            im = im.resize(self.screen, Image.LANCZOS)
            out = np.zeros((H, W, 3), np.float32)
            a = self.body[..., 3:4]
            out = out * (1 - a) + self.body[..., :3] * a
            x0, y0 = self.at
            sw, sh = self.screen
            scr = np.asarray(im).astype(np.float32) / 255.0
            out[y0:y0 + sh, x0:x0 + sw] = out[y0:y0 + sh, x0:x0 + sw] * (1 - self.mask) + scr * self.mask
            out = self.taps(out, i)
        elif self.screen[0] < W:
            back = im.resize((W, round(W * im.height / im.width)), Image.BILINEAR)
            top = (back.height - H) // 2
            back = back.crop((0, top, W, top + H)).filter(ImageFilter.GaussianBlur(28 * K))
            out = np.asarray(back).astype(np.float32) / 255.0 * 0.35
            x0 = self.at[0]
            out[:, x0:x0 + self.screen[0]] = np.asarray(im.resize(self.screen, Image.LANCZOS)).astype(np.float32) / 255.0
            if self.info.get('taps'):
                out = self.taps(out, i)
        else:
            if im.size != SIZE:
                im = im.resize(SIZE, Image.LANCZOS)
            out = np.asarray(im).astype(np.float32) / 255.0
            if self.info.get('taps'):
                out = self.taps(out, i)
        self.cache = {i: out}
        return out

    def taps(self, out, i):
        """where the capture tapped the screen: a ring that grows and fades, as screen recordings show touches"""
        for tap in self.info.get('taps', []):
            sw, sh = self.screen
            cx = self.at[0] + tap['x'] * sw
            cy = self.at[1] + tap['y'] * sh
            if tap.get('what') == 'drag':
                # a finger held down and moving: a steady ring where it is this frame
                if tap['frame'] != i:
                    continue
                yy, xx = np.ogrid[:H, :W]
                dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
                r = 44 * K
                ring = np.clip(1 - np.abs(dist - r) / (4 * K), 0, 1) * 0.9
                dot = np.clip((r * 0.75 - dist) / (2 * K), 0, 1) * 0.35
                # (a dark edge beside the ring: over a white knob or a bright card it still shows)
                halo = np.clip(1 - np.abs(dist - r) / (9 * K), 0, 1)[..., None] * 0.45
                a = np.maximum(ring, dot)[..., None]
                out = out * (1 - halo) * (1 - a) + a
                continue
            age = (i - tap['frame']) / FPS
            if not 0 <= age < 0.5:
                continue
            r = (22 + 30 * age) * K
            yy, xx = np.ogrid[:H, :W]
            dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
            ring = np.clip(1 - np.abs(dist - r) / (4 * K), 0, 1) * (1 - age / 0.5) * 0.9
            dot = np.clip((r * 0.75 - dist) / (2 * K), 0, 1) * 0.35 * (1 - age / 0.5)
            halo = np.clip(1 - np.abs(dist - r) / (9 * K), 0, 1)[..., None] * 0.45 * (1 - age / 0.5)
            a = np.maximum(ring, dot)[..., None]
            out = out * (1 - halo) * (1 - a) + a
        return out


def text_alpha(t, start, end, fade=0.3):
    return min(1.0, max(0.0, (t - start) / fade), max(0.0, (end - t) / fade))


def main():
    folder, score, out = sys.argv[1:4]
    shots = {c[0]: Shot(folder, c[0]) for c in CUTS}
    cards = [(s, e, style, render_card(style, lines)) for s, e, style, lines in TEXT]
    n = int(round(LENGTH * FPS))
    cmd = ['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-i', score, '-map', '0:v', '-map', '1:a',
           '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
           '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', CRF, '-maxrate', '20M', '-bufsize', '40M',
           '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
           '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-shortest', out]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for k in range(n):
        t = k / FPS
        # the shot on screen, and the one before it while a dissolve runs
        idx = max(i for i, c in enumerate(CUTS) if c[1] <= t + 1e-9)
        sid, start, end, first, trans = CUTS[idx]
        img = shots[sid].frame(first + int(round((t - start) * FPS)))
        if trans[0] == 'dissolve' and t < start + trans[1] and idx > 0:
            p = CUTS[idx - 1]
            prev = shots[p[0]].frame(p[3] + int(round((t - p[1]) * FPS)))
            w = (t - start) / trans[1]
            w = w * w * (3 - 2 * w)
            img = prev * (1 - w) + img * w
        elif trans[0] == 'fade' and t < start + trans[1]:
            img = img * ((t - start) / trans[1])
        for s, e, style, card in cards:
            a = text_alpha(t, s, e, 0.15 if style == 'name' else 0.3)
            if a > 0:
                ca = card[..., 3:4] * a
                img = img * (1 - ca) + card[..., :3] * ca
        if t > LENGTH - FADE_OUT:
            img = img * max(0.0, (LENGTH - t) / FADE_OUT) ** 1.5
        ff.stdin.write((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
        if k % 150 == 0:
            print(f'{t:5.1f} s', flush=True)
    ff.stdin.close()
    if ff.wait():
        sys.exit('ffmpeg failed')
    print(out)


if __name__ == "__main__":
    main()
