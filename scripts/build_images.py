"""Builds the README images in docs/images/ from the raw frames that e2e/capture.spec.ts records.

Usage:  python scripts/build_images.py <raw dir> <out dir>     (`npm run capture` runs both steps)
Needs:  Pillow (pip install pillow)

Each raw frame is the app window plus, on the Signals tab, the TradingView view: a separate web view that the window
capture leaves out, pasted back here at its bounds. Outputs: hero.png, signals.png (a crop) and calculator.png as
compressed PNGs at most 1600 px wide, and demo.gif at 1200 px wide with one shared palette.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    raise SystemExit('build_images.py needs Pillow: pip install pillow')

STILL_WIDTH = 1600
GIF_WIDTH = 1200
PNG_LIMIT = 600_000
GIF_LIMIT = 4_000_000
GREEN = (0, 200, 5)
GIF_POINTER = 1.4  # the GIF's pointer is drawn larger than a normal one, so it reads at GIF size

# The arrow pointer, tip at (0, 0), in window pixels.
ARROW = [(0, 0), (0, 17), (4.2, 13.2), (7, 19.6), (9.7, 18.4), (6.9, 12.2), (12.2, 12.2)]


def composite(raw: Path, frame: dict, cache: dict) -> Image.Image:
    """The window image with the TradingView view pasted at its bounds (scaled like the window)."""
    view = frame.get('view')
    key = (frame['window'], view['file'] if view else None)
    if key in cache:
        return cache[key]
    img = Image.open(raw / frame['window']).convert('RGB')
    if view:
        scale = img.width / cache['size'][0]
        b = view['bounds']
        left, top = round(b['x'] * scale), round(b['y'] * scale)
        size = (round(b['width'] * scale), round(b['height'] * scale))
        pane = Image.open(raw / view['file']).convert('RGB')
        if pane.size != size:
            pane = pane.resize(size, Image.Resampling.LANCZOS)
        img.paste(pane, (left, top))
    cache[key] = img
    return img


def fit(img: Image.Image, width: int) -> Image.Image:
    if img.width <= width:
        return img
    return img.resize((width, round(img.height * width / img.width)), Image.Resampling.LANCZOS)


def pointer_sprite(k: float, click: bool) -> tuple[Image.Image, tuple[int, int]]:
    """An anti-aliased arrow (and a green ring on a click), drawn 4x larger and scaled down. Returns (sprite, tip offset)."""
    ss = 4 * k
    pad = 18 if click else 2
    w, h = round((12.2 + 2 * pad + 4) * ss), round((19.6 + 2 * pad + 4) * ss)
    big = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    ox, oy = (pad + 2) * ss, (pad + 2) * ss
    if click:
        r = 13 * ss
        d.ellipse((ox - r, oy - r, ox + r, oy + r), fill=GREEN + (60,), outline=GREEN + (230,), width=round(2.2 * ss))
    pts = [(ox + x * ss, oy + y * ss) for x, y in ARROW]
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(0, 0, 0, 255), width=max(1, round(1.3 * ss)))
    small = big.resize((max(1, round(w / 4)), max(1, round(h / 4))), Image.Resampling.LANCZOS)
    return small, (round(ox / 4), round(oy / 4))


def draw_pointer(img: Image.Image, at: list[float], k: float, click: bool, size: float = 1.0) -> Image.Image:
    """The pointer with its tip at `at` (window pixels); `k` = image pixels per window pixel."""
    sprite, (tx, ty) = pointer_sprite(k * size, click)
    out = img.convert('RGBA')
    out.alpha_composite(sprite, (round(at[0] * k) - tx, round(at[1] * k) - ty))
    return out.convert('RGB')


def save_png(img: Image.Image, path: Path) -> int:
    """Lossless when it fits the size limit, else 256 colors (then fewer) until it does."""
    img.save(path, optimize=True)
    for colors in (256, 192, 128):
        if path.stat().st_size <= PNG_LIMIT:
            break
        img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)
    return path.stat().st_size


def build_still(raw: Path, out: Path, name: str, shot: dict, cache: dict) -> None:
    img = composite(raw, shot, cache)
    scale = img.width / cache['size'][0]
    if shot.get('cursor'):
        img = draw_pointer(img, shot['cursor'], scale, False)
    crop = shot.get('crop')
    if crop:
        img = img.crop((round(crop['x'] * scale), round(crop['y'] * scale),
                        round((crop['x'] + crop['width']) * scale), round((crop['y'] + crop['height']) * scale)))
    img = fit(img, STILL_WIDTH)
    size = save_png(img, out / f'{name}.png')
    print(f'{name}.png  {img.width}x{img.height}  {size / 1000:.0f} KB')


def build_gif(raw: Path, out: Path, frames: list[dict], cache: dict, colors: int = 256) -> int:
    width, height = cache['size']
    k = GIF_WIDTH / width
    small: dict = {}
    images, durations = [], []
    for f in frames:
        key = (f['window'], f['view']['file'] if f.get('view') else None)
        if key not in small:
            small[key] = fit(composite(raw, f, cache), GIF_WIDTH)
        img = small[key]
        if f.get('cursor'):
            img = draw_pointer(img, f['cursor'], k, bool(f.get('click')), GIF_POINTER)
        images.append(img)
        durations.append(max(20, int(f['ms'])))
    # one palette for every frame (no flicker, and unchanged areas stay identical between frames): built from a strip of
    # every distinct screen plus a pointer
    keys = list(small)
    sample = [small[x] for x in keys[:: max(1, len(keys) // 16)]] + [images[-1]]
    strip = Image.new('RGB', (GIF_WIDTH, sum(s.height for s in sample)))
    y = 0
    for s in sample:
        strip.paste(s, (0, y))
        y += s.height
    palette = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    quantized = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]
    path = out / 'demo.gif'
    quantized[0].save(path, save_all=True, append_images=quantized[1:], duration=durations, loop=0, optimize=False, disposal=1)
    size = path.stat().st_size
    print(f'demo.gif  {GIF_WIDTH}x{round(height * k)}  {len(frames)} frames  {sum(durations) / 1000:.1f} s  {colors} colors  '
          f'{size / 1_000_000:.2f} MB')
    return size


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        raise SystemExit('usage: python scripts/build_images.py <raw dir> <out dir>')
    raw, out = Path(argv[1]), Path(argv[2])
    manifest = json.loads((raw / 'manifest.json').read_text(encoding='utf-8'))
    out.mkdir(parents=True, exist_ok=True)
    cache: dict = {'size': manifest['size']}
    for name, shot in manifest['stills'].items():
        build_still(raw, out, name, shot, cache)
    for colors in (256, 160, 96):
        if build_gif(raw, out, manifest['gif'], cache, colors) <= GIF_LIMIT:
            break
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
