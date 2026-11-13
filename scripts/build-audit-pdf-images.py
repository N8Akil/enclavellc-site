#!/usr/bin/env python3
"""Builds the pictures the audit report PDF embeds (src/lib/audit/images/). Run from the repository root:

    python3 scripts/build-audit-pdf-images.py <folder holding cover-isis-office.jpg and cover-osiris-office.jpg>

Needs Pillow. Every output is sized to the size it is drawn at in the PDF, so the report stays light.

- mark-gold.png, mark-ink.png: the Enclave mark, from the shape (alpha) of public/night/logo-mark.png, the file the site's
  own nav masks in its colour. Gold (#E8B04B) for the dark cover pages, ink (#1A1714) for the paper pages.
- isis-office.jpg, osiris-office.jpg: the office portraits of the two AI partners, cropped around the person.
"""
import os
import sys

from PIL import Image

OUT = os.path.join('src', 'lib', 'audit', 'images')
GOLD = (0xE8, 0xB0, 0x4B)
INK = (0x1A, 0x17, 0x14)


def mark(height: int, colour, name: str) -> None:
    alpha = Image.open(os.path.join('public', 'night', 'logo-mark.png')).convert('RGBA').getchannel('A')
    alpha = alpha.crop(alpha.getbbox())
    width = round(alpha.width * height / alpha.height)
    alpha = alpha.resize((width, height), Image.LANCZOS)
    out = Image.new('RGBA', alpha.size, colour + (0,))
    out.putalpha(alpha)
    out.save(os.path.join(OUT, name), optimize=True)


def office(source_dir: str, who: str, centre_x: float, size=(620, 550)) -> None:
    im = Image.open(os.path.join(source_dir, f'cover-{who}-office.jpg')).convert('RGB')
    # the crop keeps the full height and the drawn box's aspect, centred on the person (centre_x: share of the width)
    crop_w = round(im.height * size[0] / size[1])
    left = min(max(0, round(im.width * centre_x - crop_w / 2)), im.width - crop_w)
    im = im.crop((left, 0, left + crop_w, im.height)).resize(size, Image.LANCZOS)
    im.save(os.path.join(OUT, f'{who}-office.jpg'), quality=80, optimize=True, progressive=False, subsampling=2)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    os.makedirs(OUT, exist_ok=True)
    mark(360, GOLD, 'mark-gold.png')
    mark(96, INK, 'mark-ink.png')
    office(sys.argv[1], 'isis', 0.52)
    office(sys.argv[1], 'osiris', 0.57)
    for name in sorted(os.listdir(OUT)):
        print(name, os.path.getsize(os.path.join(OUT, name)))
