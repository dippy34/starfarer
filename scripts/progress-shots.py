#!/usr/bin/env python3
"""
Add an update's pictures to the progress page (public/mc-a76557970f/, "Pictures"): the newest first.

    python3 -I scripts/progress-shots.py --title "A slim card" --kind live --link https://... \\
        --caption "Before" a.png --caption "After" b.png

Each picture is made a JPEG no wider than 960 px (a phone's screen, sharp), saved as
public/mc-a76557970f/shots/<id>-<n>.jpg, and listed in public/mc-a76557970f/shots/manifest.json. Only the
newest KEEP updates are kept, and their files: the site has to stay under GitHub Pages' 1 GB.

--kind: live (on the site now), team (the cheap team's work, waiting for review) or tests.
"""
import argparse
import datetime
import json
import os
import re
import sys

from PIL import Image

KEEP = 12           # updates kept on the page
MAX_W = 960         # px
QUALITY = 76
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'mc-a76557970f', 'shots')
Image.MAX_IMAGE_PIXELS = 40_000_000  # refuse anything absurd


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--title', required=True)
    ap.add_argument('--kind', choices=['live', 'team', 'tests'], required=True)
    ap.add_argument('--text', default='', help='one or two plain sentences under the title')
    ap.add_argument('--link', default='')
    ap.add_argument('--caption', action='append', default=[], help='one per picture, in order')
    ap.add_argument('images', nargs='+')
    a = ap.parse_args()
    if a.link and not a.link.startswith('https://'):
        sys.exit('--link must be an https:// address')
    if a.caption and len(a.caption) != len(a.images):
        sys.exit('give one --caption per picture, or none')

    os.makedirs(ROOT, exist_ok=True)
    path = os.path.join(ROOT, 'manifest.json')
    entries = json.load(open(path)) if os.path.exists(path) else []
    now = datetime.datetime.now(datetime.timezone.utc)
    uid = now.strftime('%Y%m%d-%H%M%S') + '-' + re.sub(r'[^a-z0-9]+', '-', a.title.lower()).strip('-')[:32]

    pics = []
    for i, src in enumerate(a.images):
        with Image.open(src) as im:
            im = im.convert('RGB')
            if im.width > MAX_W:
                im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
            name = f'{uid}-{i + 1}.jpg'
            im.save(os.path.join(ROOT, name), 'JPEG', quality=QUALITY, optimize=True, progressive=True)
            pics.append({'src': name, 'w': im.width, 'h': im.height, 'caption': a.caption[i] if a.caption else ''})

    entries.insert(0, {'id': uid, 'at': now.isoformat(timespec='seconds'), 'kind': a.kind, 'title': a.title,
                       'text': a.text, 'link': a.link, 'pictures': pics})
    entries = entries[:KEEP]
    with open(path, 'w') as f:
        json.dump(entries, f, indent=1, ensure_ascii=False)
        f.write('\n')
    keep = {p['src'] for e in entries for p in e['pictures']} | {'manifest.json'}
    for name in os.listdir(ROOT):
        if name not in keep:
            os.remove(os.path.join(ROOT, name))
    size = sum(os.path.getsize(os.path.join(ROOT, n)) for n in os.listdir(ROOT))
    print(f'{uid}: {len(pics)} pictures; {len(entries)} updates, {size / 1e6:.1f} MB in public/mc-a76557970f/shots')


if __name__ == '__main__':
    main()
