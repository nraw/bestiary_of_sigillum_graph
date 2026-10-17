"""Split the composite reference sheets into one image per effect / ability range.

Usage:
    python3 scripts/split_reference_images.py

Reads  effect_images/effect_markers.png  -> effect_images/<effect>.png
       ability_images/ability_ranges.png -> ability_images/<range>.png
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent

# Column-major order as laid out on the sheet; names follow effects.md / the JSON "effect" values.
EFFECT_NAMES = [
    "attack_increase",
    "attack_decrease",
    "defense_increase",
    "defense_decrease",
    "control_increase",
    "control_decrease",
    "swiftness",
    "slowness",
    "flying",
    "resistance",
    "vampirism",
    "stun",
    "poison",
    "place_obstacle",
]

# Column-major order as laid out on the sheet.
ABILITY_RANGE_NAMES = [
    "self",                    # The target is the Ability bearer
    "adjacent_or_self",        # The target is in an adjacent hex or is the Ability bearer
    "any_hex",                 # The target is in any hex on the field
    "one_hex_gap_line",        # The target is 1 unoccupied hex away in a straight line
    "adjacent",                # The target is in an adjacent hex
    "all_hexes_in_line",       # The targets are in any hexes in a straight line
    "any_hex_or_self",         # The target is in any hex on the field or is the Ability bearer
    "any_hex_in_line",         # The target is in any hex in a straight line
]

HEADER_HEIGHT = 130  # sheet title + rule line
PADDING = 6


def _rgb(image):
    return np.asarray(image.convert("RGB")).astype(int)


def _column_major(boxes, split_x):
    return sorted(boxes, key=lambda b: (b[0] >= split_x, b[1]))


def detect_effect_icons(image):
    """Return (left, top, right, bottom) square boxes around each round marker icon."""
    rgb = _rgb(image)
    dark = rgb.mean(axis=2) < 120
    dark[:HEADER_HEIGHT] = False
    labels, _ = ndimage.label(ndimage.binary_closing(dark, iterations=3))
    boxes = []
    for ys, xs in ndimage.find_objects(labels):
        w, h = xs.stop - xs.start, ys.stop - ys.start
        if w < 90 or h < 90 or abs(w - h) > 15:
            continue  # text glyphs, not icons
        size = max(w, h) + 2 * PADDING
        cx, cy = (xs.start + xs.stop) // 2, (ys.start + ys.stop) // 2
        left, top = cx - size // 2, cy - size // 2
        boxes.append((left, top, left + size, top + size))
    return _column_major(boxes, image.width // 2)


def _row_bands(mask):
    rows = mask.sum(axis=1) > 2
    bands, start = [], None
    for y, on in enumerate(np.append(rows, False)):
        if on and start is None:
            start = y
        elif not on and start is not None:
            bands.append((start, y))
            start = None
    return bands


def _largest_run(on, max_gap):
    """(start, stop) of the widest run of True columns, bridging gaps up to max_gap."""
    idx = np.flatnonzero(on)
    runs, start = [], idx[0]
    for prev, cur in zip(idx, idx[1:]):
        if cur - prev > max_gap:
            runs.append((start, prev + 1))
            start = cur
    runs.append((start, idx[-1] + 1))
    return max(runs, key=lambda r: r[1] - r[0])


def _grow_right(stop, on, max_gap):
    """Extend `stop` rightward through columns in `on`, tolerating gaps up to max_gap."""
    gap = 0
    while stop < len(on) and gap <= max_gap:
        gap = 0 if on[stop] else gap + 1
        stop += 1
    return stop - gap


def detect_ability_diagrams(image):
    """Return (left, top, right, bottom) boxes around each hex diagram, excluding captions."""
    rgb = _rgb(image)
    lum = rgb.mean(axis=2)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ink = (lum < 110) | ((r - g > 60) & (r - b > 60))
    # Faded hexes (the "straight line" diagram) are only slightly darker than the parchment.
    faint = lum < np.median(lum) - 25
    split_x = image.width // 2
    boxes = []
    for x0, x1 in ((0, split_x), (split_x, image.width)):
        for top, bottom in _row_bands(ink[HEADER_HEIGHT:, x0:x1]):
            if bottom - top < 80:
                continue  # caption line
            top += HEADER_HEIGHT
            bottom += HEADER_HEIGHT
            left, right = _largest_run(ink[top:bottom, x0:x1].sum(axis=0) > 3, max_gap=30)
            # Diagrams start with a dark hatched hex on the left; fading only trails off rightward.
            right = _grow_right(right, faint[top:bottom, x0:x1].sum(axis=0) >= 2, max_gap=12)
            boxes.append((
                max(x0 + left - PADDING, 0),
                max(top - PADDING, 0),
                min(x0 + right + PADDING, image.width),
                min(bottom + PADDING, image.height),
            ))
    return _column_major(boxes, split_x)


def _circle_cutout(crop):
    mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(mask).ellipse((PADDING - 2, PADDING - 2,
                                  crop.width - PADDING + 1, crop.height - PADDING + 1), fill=255)
    out = crop.convert("RGBA")
    out.putalpha(mask)
    return out


def split_effects(sheet_path, out_dir):
    sheet = Image.open(sheet_path)
    boxes = detect_effect_icons(sheet)
    if len(boxes) != len(EFFECT_NAMES):
        raise ValueError(f"expected {len(EFFECT_NAMES)} effect icons, found {len(boxes)}")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, box in zip(EFFECT_NAMES, boxes):
        path = out_dir / f"{name}.png"
        _circle_cutout(sheet.crop(box)).save(path, optimize=True)
        written.append(path)
    return written


def split_abilities(sheet_path, out_dir):
    sheet = Image.open(sheet_path)
    boxes = detect_ability_diagrams(sheet)
    if len(boxes) != len(ABILITY_RANGE_NAMES):
        raise ValueError(f"expected {len(ABILITY_RANGE_NAMES)} ability diagrams, found {len(boxes)}")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, box in zip(ABILITY_RANGE_NAMES, boxes):
        path = out_dir / f"{name}.png"
        sheet.crop(box).convert("RGB").save(path, optimize=True)
        written.append(path)
    return written


if __name__ == "__main__":
    for path in split_effects(ROOT / "effect_images" / "effect_markers.png", ROOT / "effect_images"):
        print(path.relative_to(ROOT))
    for path in split_abilities(ROOT / "ability_images" / "ability_ranges.png", ROOT / "ability_images"):
        print(path.relative_to(ROOT))
