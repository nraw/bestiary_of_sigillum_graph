"""Draw the site icons and the social share image from the header sigil.

Usage:
    python3 scripts/build_site_images.py

Writes favicon.svg, favicon.ico (16/32/48), icons/icon-{32,192,512}.png,
       icons/apple-touch-icon.png (180) and icons/og-image.png (1200x630, Open Graph / Twitter card).
The sigil is the header's: a ring with two crossed diamonds (40-unit viewBox, see index.html).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"

BG = (14, 11, 9)
CRIMSON = (139, 30, 51)
GOLD = (217, 168, 78)
GOLD_BRIGHT = (242, 199, 107)
TEXT_MUTED = (185, 167, 140)

# Header sigil, 40-unit space
DIAMONDS = [[(20, 3), (24, 20), (20, 37), (16, 20)], [(3, 20), (20, 16), (37, 20), (20, 24)]]
RING_R = 17

# Icon geometry, 64-unit space: rounded tile, sigil scaled 1.5x about the centre
ICON_SCALE = 1.5
ICON_RING_WIDTH = 3.2
FAVICON_SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="g" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#5A1422"/><stop offset="100%" stop-color="#0E0B09"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <g transform="translate(32 32) scale({ICON_SCALE}) translate(-20 -20)">
    <circle cx="20" cy="20" r="{RING_R}" fill="none" stroke="#D9A84E" stroke-width="{ICON_RING_WIDTH / ICON_SCALE:.3f}"/>
    <path d="M20 3 L24 20 L20 37 L16 20 Z M3 20 L20 16 L37 20 L20 24 Z" fill="#F2C76B"/>
  </g>
</svg>
"""


def radial(size, centre, radius, inner, outer):
    """A radial gradient from inner (at centre) to outer (at radius and beyond)."""
    w, h = size
    mask = Image.radial_gradient("L").resize((int(radius * 2), int(radius * 2)))
    layer = Image.new("RGB", size, outer)
    glow = Image.new("RGB", mask.size, inner)
    # PIL's gradient only reaches 255 in the corners (radius * sqrt 2): rescale so it fades out at the radius
    alpha = Image.eval(mask, lambda v: 255 - min(255, round(v * 1.4142)))
    layer.paste(glow, (int(centre[0] - radius), int(centre[1] - radius)), alpha)
    return layer


def draw_sigil(draw, centre, scale, ring_width, ring=GOLD, star=GOLD_BRIGHT):
    cx, cy = centre
    at = lambda p: (cx + (p[0] - 20) * scale, cy + (p[1] - 20) * scale)
    r = RING_R * scale
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ring, width=round(ring_width))
    for diamond in DIAMONDS:
        draw.polygon([at(p) for p in diamond], fill=star)


def icon(px):
    """The favicon tile at px x px (drawn 8x and downsampled)."""
    s = px * 8
    unit = s / 64
    tile = radial((s, s), (s / 2, s * 0.42), s * 0.65, (90, 20, 34), BG)
    draw = ImageDraw.Draw(tile)
    draw_sigil(draw, (s / 2, s / 2), ICON_SCALE * unit, ICON_RING_WIDTH * unit)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=14 * unit, fill=255)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(tile, (0, 0), mask)
    return out.resize((px, px), Image.LANCZOS)


def font(name, size, index=0):
    for path in (f"/System/Library/Fonts/Supplemental/{name}", f"/System/Library/Fonts/{name}"):
        if Path(path).exists():
            return ImageFont.truetype(path, size, index=index)
    return ImageFont.load_default(size)


def portrait(name, d):
    img = Image.open(ROOT / "hero_images" / f"{name}.png").convert("RGBA")
    w, h = img.size
    img = img.crop((0, 0, w, w)).resize((d, d), Image.LANCZOS)
    mask = Image.new("L", (d * 4, d * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, d * 4 - 1, d * 4 - 1], fill=255)
    out = Image.new("RGBA", (d, d), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask.resize((d, d), Image.LANCZOS))
    return out


def og_image():
    W, H = 1200, 630
    img = radial((W, H), (W * 0.5, H * 0.18), 760, (70, 16, 26), BG).convert("RGBA")
    # Faint large sigil watermark behind the title
    mark = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_sigil(ImageDraw.Draw(mark), (W / 2, 250), 15, 6, ring=GOLD + (34,), star=GOLD + (22,))
    img.alpha_composite(mark.filter(ImageFilter.GaussianBlur(1)))

    draw = ImageDraw.Draw(img)
    draw.rectangle([18, 18, W - 19, H - 19], outline=GOLD + (110,), width=2)
    draw.rectangle([28, 28, W - 29, H - 29], outline=GOLD + (50,), width=1)
    draw_sigil(draw, (W / 2, 96), 1.9, 3)

    title = font("Didot.ttc", 88)
    sub = font("Baskerville.ttc", 40)
    small = font("Baskerville.ttc", 30, index=1)

    def centred(y, text, f, fill):
        w = draw.textlength(text, font=f)
        draw.text(((W - w) / 2, y), text, font=f, fill=fill)

    centred(150, "BESTIARY OF SIGILLUM", title, GOLD_BRIGHT)
    centred(262, "Companion", sub, GOLD)
    centred(322, "Draft assistant · Hero synergy graph · Reference cards", small, TEXT_MUTED)

    heroes = ["architectus", "aqus", "fidea", "malleus", "tempus", "toxicum", "equita"]
    d, gap = 112, 26
    x = (W - (len(heroes) * d + (len(heroes) - 1) * gap)) / 2
    y = 420
    for name in heroes:
        if not (ROOT / "hero_images" / f"{name}.png").exists():
            continue
        draw.ellipse([x - 4, y - 4, x + d + 3, y + d + 3], fill=CRIMSON, outline=GOLD, width=3)
        img.alpha_composite(portrait(name, d), (int(x), y))
        x += d + gap
    return img.convert("RGB")


def main():
    ICONS.mkdir(exist_ok=True)
    (ROOT / "favicon.svg").write_text(FAVICON_SVG)
    icon(256).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    for px in (32, 192, 512):
        icon(px).save(ICONS / f"icon-{px}.png", optimize=True)
    # iOS masks its own corners: give it the full square
    full = icon(180)
    square = Image.new("RGBA", full.size, BG + (255,))
    square.alpha_composite(full)
    square.convert("RGB").save(ICONS / "apple-touch-icon.png", optimize=True)
    og_image().save(ICONS / "og-image.png", optimize=True)

if __name__ == "__main__":
    main()
