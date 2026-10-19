"""Extract attributes, features, sync notes, ability names, ranges and cooldowns from the V2 reference PDF.

Usage:
    python3 scripts/extract_v2_reference.py

Reads  Bestiary_Of_Sigillum_Character_Reference_V2.pdf
Adds   attribute / features / sync_note to each character, name / range to every ability and cooldown
       to each support ability in bestiary_reference_cards.json (matched by id, name-checked).
       range values are the ability_images/<range>.png names (null when the card shows no symbol).
       attribute (Strength / Agility / Intelligence) comes from the colour of the card's number banner.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "Bestiary_Of_Sigillum_Character_Reference_V2.pdf"
JSON_PATH = ROOT / "bestiary_reference_cards.json"

WHITE = 0xFFFFFF
RED = 0xBE1E2D
LINE_TOLERANCE = 3   # spans within this many points vertically share a line (digits sit ~1pt higher)
PARAGRAPH_GAP = 10   # line pitch is ~8pt; a bigger step starts a new paragraph
ICON_LEAD = 4        # cooldown text starts level with the top of its icon; the line above sits >=7pt higher
TWO_LINE_LEAD = 12   # a two-line cooldown may start up to one line above its icon
WOUND_FILL = (0.35, 0.22, 0.55)  # purple Wound marker, drawn inline with no text
BANNER_MAX_WIDTH, BANNER_HEIGHT = 40, (40, 90)  # the coloured number banner at each card's top-left

# Each range symbol is one embedded image, reused across the PDF (image xref -> ability_images name).
# "Any hex in a straight line" is the one-hex-gap image with a rotated "..." image laid over it.
LINE_BASE_XREF, LINE_DOTS_XREF = 1762, 1764
RANGE_BY_XREF = {
    LINE_BASE_XREF: "one_hex_gap_line",
    1768: "adjacent",
    1770: "any_hex",
    1773: "self",
    1599: "any_hex_or_self",
    1606: "adjacent_or_self",
    1603: "all_hexes_in_line",
}
RANGE_XREFS = set(RANGE_BY_XREF) | {LINE_DOTS_XREF}


def classify_range(xrefs):
    """Range name for the set of range-symbol image xrefs beside one ability header."""
    if not xrefs:
        return None
    if xrefs == {LINE_BASE_XREF, LINE_DOTS_XREF}:
        return "any_hex_in_line"
    if len(xrefs) != 1 or not xrefs <= set(RANGE_BY_XREF):
        raise ValueError(f"unrecognised range symbol images: {sorted(xrefs)}")
    return RANGE_BY_XREF[next(iter(xrefs))]


def classify_attribute(fill):
    """Attribute for a banner fill colour: red Strength, green Agility, blue Intelligence."""
    r, g, b = fill
    if r > 0.8 and g < 0.3 and b < 0.3:
        return "Strength"
    if b > 0.5 and r < 0.2:
        return "Intelligence"
    if g > 0.4 and r < 0.2 and b < 0.4:
        return "Agility"
    raise ValueError(f"unrecognised banner colour: {fill}")


def banner_attribute(drawings):
    """Attribute of a card from the filled banner shapes behind its number (the last one drawn is visible)."""
    if not drawings:
        raise ValueError("no banner found")
    return classify_attribute(max(drawings, key=lambda d: d["seqno"])["fill"])


def is_banner(drawing):
    r = drawing["rect"]
    return bool(drawing.get("fill")) and r.width < BANNER_MAX_WIDTH and BANNER_HEIGHT[0] < r.height < BANNER_HEIGHT[1]


def clean_text(text):
    text = text.replace("’", "'")
    text = re.sub(r"\s+", " ", text).strip()
    # Inline icons leave blank runs before punctuation ("Obstacle       .")
    return re.sub(r"\s+([.,)])", r"\1", text)


def clean_cooldown(text):
    return clean_text(text).rstrip(".").strip()


def merge_lines(spans):
    """Group spans into visual lines (top to bottom), joining each line's text in x order."""
    lines = []
    for s in sorted(spans, key=lambda s: s["y"]):
        if lines and abs(s["y"] - lines[-1]["y"]) <= LINE_TOLERANCE:
            lines[-1]["spans"].append(s)
        else:
            lines.append({"y": s["y"], "spans": [s]})
    for line in lines:
        line["spans"].sort(key=lambda s: s["x"])
        line["text"] = clean_text("".join(s["text"] for s in line["spans"]))
    return lines


def paragraphs(lines):
    paras, prev_y = [], None
    for line in lines:
        if prev_y is None or line["y"] - prev_y > PARAGRAPH_GAP:
            paras.append([])
        paras[-1].append(line["text"])
        prev_y = line["y"]
    return [clean_text(" ".join(p)) for p in paras]


def cooldown_text(lines, icon_y):
    """Text beside the cooldown icon (the last icon of a support ability).

    Cooldowns always start with a number; a two-line cooldown can start a line above its icon.
    """
    starts = [l["y"] for l in lines if icon_y - TWO_LINE_LEAD <= l["y"] <= icon_y + ICON_LEAD and l["text"][:1].isdigit()]
    start_y = min(starts) if starts else icon_y - ICON_LEAD
    return clean_cooldown(" ".join(l["text"] for l in lines if l["y"] >= start_y))


def insert_inline_word(text, x0, x1, icon_x, word):
    """Replace the blank run left by an inline icon (nearest icon_x within span x0..x1) with word."""
    runs = list(re.finditer(r" {3,}", text))
    if not runs:
        return text
    pos = (icon_x - x0) / (x1 - x0) * len(text)
    run = min(runs, key=lambda m: abs((m.start() + m.end()) / 2 - pos))
    return text[: run.start()] + f" {word} " + text[run.end():]


def split_sentences(text):
    return [s for s in re.split(r"(?<=\.)\s+", text) if s]


def is_header(s):
    text = s["text"].strip()
    return "Bold" in s["font"] and round(s["size"]) == 9 and text.endswith(":") and text != "Features:"


def parse_card(spans, icon_ys):
    """icon_ys: top edges of the target / effect / cooldown icons in the card's icon column."""
    card_id = next(int(s["text"]) for s in spans if s["color"] == WHITE and s["text"].strip().isdigit())
    name = next(s["text"].strip() for s in spans if round(s["size"]) == 15 and not s["text"].strip().isdigit())

    headers = sorted((s for s in spans if is_header(s)), key=lambda s: s["y"])
    features_y = next(s["y"] for s in spans if s["text"].strip() == "Features:")
    first_ability_y = headers[0]["y"]

    feature_spans = [s for s in spans if features_y < s["y"] < first_ability_y]
    plain = [s for s in feature_spans if s["color"] != RED]
    red = [s for s in feature_spans if s["color"] == RED]
    features = split_sentences(" ".join(paragraphs(merge_lines(plain))))
    sync = " ".join(paragraphs(merge_lines(red))) or None

    abilities = []
    for i, header in enumerate(headers):
        end_y = headers[i + 1]["y"] if i + 1 < len(headers) else float("inf")
        body = [s for s in spans if header["y"] < s["y"] < end_y and not is_header(s)]
        icons = sorted(y for y in icon_ys if header["y"] < y < end_y)
        ability = {"name": clean_text(header["text"]).rstrip(":"), "icon_count": len(icons)}
        if i > 0:  # support abilities: target, effect, cooldown
            if len(icons) != 3:
                raise ValueError(f"{name} / {ability['name']}: expected 3 icons, found {len(icons)}")
            ability["cooldown"] = cooldown_text(merge_lines(body), icons[-1])
        abilities.append(ability)

    return {"id": card_id, "name": name, "features": features, "sync_note": sync, "abilities": abilities}


def wound_markers(page):
    """Centres of the inline Wound markers (each drawn as a few overlapping purple strokes)."""
    centres = []
    for d in page.get_drawings():
        fill = d.get("fill")
        if not fill or any(abs(a - b) > 0.05 for a, b in zip(fill, WOUND_FILL)):
            continue
        c = ((d["rect"].x0 + d["rect"].x1) / 2, (d["rect"].y0 + d["rect"].y1) / 2)
        if not any(abs(c[0] - o[0]) < 6 and abs(c[1] - o[1]) < 6 for o in centres):
            centres.append(c)
    return centres


def extract_cards(pdf_path):
    import fitz

    cards = []
    with fitz.open(pdf_path) as doc:
        for page in doc:
            mid_x, mid_y = page.rect.width / 2, page.rect.height / 2
            quadrants = {}
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for s in line["spans"]:
                        if not s["text"].strip():
                            continue
                        x, y, x1, y1 = s["bbox"]
                        quadrants.setdefault((x >= mid_x, y >= mid_y), []).append(
                            {"x": x, "y": y, "x1": x1, "y1": y1, "text": s["text"], "color": s["color"],
                             "size": s["size"], "font": s["font"]}
                        )
            for (wx, wy) in wound_markers(page):
                for s in quadrants.get((wx >= mid_x, wy >= mid_y), []):
                    if s["x"] < wx < s["x1"] and s["y"] < wy < s["y1"]:
                        s["text"] = insert_inline_word(s["text"], s["x"], s["x1"], wx, "Wound")
            range_images = [(i["xref"], fitz.Rect(i["bbox"])) for i in page.get_image_info(xrefs=True)
                            if i["xref"] in RANGE_XREFS]
            icons = {}
            for d in page.get_drawings():
                r, fill = d["rect"], d.get("fill")
                # Red target/effect/cooldown icons; skips the target icon's inner dot and red text
                if fill and fill[0] > 0.6 and fill[1] < 0.3 and 8 <= r.width <= 16 and 8 <= r.height <= 16:
                    icons.setdefault((r.x0 >= mid_x, r.y0 >= mid_y), []).append(r)
            banners = {}
            for d in page.get_drawings():
                if is_banner(d):
                    banners.setdefault((d["rect"].x0 >= mid_x, d["rect"].y0 >= mid_y), []).append(d)
            for key, spans in quadrants.items():
                features = next((s for s in spans if s["text"].strip() == "Features:"), None)
                if features is None:
                    continue
                # The icon column sits just right of the "Features:" label's left edge
                column = [r.y0 for r in icons.get(key, []) if 0 <= r.x0 - features["x"] <= 20]
                card = parse_card(spans, column)
                headers = sorted((s for s in spans if is_header(s)), key=lambda s: s["y"])
                for ability, header in zip(card["abilities"], headers):
                    # The symbol sits at the right end of the header row
                    ability["range"] = classify_range({
                        x for x, r in range_images if abs(r.y0 - header["y"]) < 14 and 0 < r.x0 - header["x"] < 230
                    })
                card["attribute"] = banner_attribute(banners.get(key, []))
                cards.append(card)
    return sorted(cards, key=lambda c: c["id"])


def merge_into_json(data, cards):
    by_id = {c["id"]: c for c in cards}
    for ch in data["bestiary_of_sigillum"]["characters"]:
        card = by_id[ch["id"]]
        if card["name"] != ch["name"]:
            raise ValueError(f"id {ch['id']}: JSON name {ch['name']!r} != PDF name {card['name']!r}")
        support = card["abilities"][1:]
        if len(support) != len(ch["support_abilities"]):
            raise ValueError(f"{ch['name']}: support ability count mismatch")
        if "attribute" in card:
            # attribute sits right after vitality
            items = [(k, v) for k, v in ch.items() if k != "attribute"]
            at = next((i + 1 for i, (k, _) in enumerate(items) if k == "vitality"), len(items))
            items.insert(at, ("attribute", card["attribute"]))
            ch.clear()
            ch.update(items)
        ch["features"] = card["features"]
        ch["sync_note"] = card["sync_note"]

        def with_card_fields(ability, pdf_ability):
            # name first, then the existing target/effect, then range (and cooldown for support abilities)
            rest = {k: v for k, v in ability.items() if k not in ("name", "range", "cooldown")}
            merged = {"name": pdf_ability["name"], **rest, "range": pdf_ability.get("range")}
            if "cooldown" in pdf_ability:
                merged["cooldown"] = pdf_ability["cooldown"]
            return merged

        ch["core_ability"] = with_card_fields(ch["core_ability"], card["abilities"][0])
        ch["support_abilities"] = [with_card_fields(a, p) for a, p in zip(ch["support_abilities"], support)]
    return data


def main():
    data = json.loads(JSON_PATH.read_text())
    merge_into_json(data, extract_cards(PDF))
    JSON_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"Updated {JSON_PATH.name}")


if __name__ == "__main__":
    main()
