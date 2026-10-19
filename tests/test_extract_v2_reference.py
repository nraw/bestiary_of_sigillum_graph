import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import extract_v2_reference as ev2  # noqa: E402

PDF = ROOT / "Bestiary_Of_Sigillum_Character_Reference_V2.pdf"
BLACK, RED, WHITE = 0x231F20, 0xBE1E2D, 0xFFFFFF


def span(x, y, text, color=BLACK, size=8.0, font="HighTowerText-Reg"):
    return {"x": x, "y": y, "text": text, "color": color, "size": size, "font": font}


def test_clean_text_collapses_icon_gaps_and_spaces():
    assert ev2.clean_text("Obstacle       .") == "Obstacle."
    assert ev2.clean_text("  Attack:  1 . ") == "Attack: 1."
    assert ev2.clean_text("target’s") == "target's"


def test_merge_lines_joins_spans_on_same_baseline_in_x_order():
    spans = [
        span(157, 227, " per Catapult Tower"),
        span(114, 227, "Attack: "),
        span(139, 226, "0 + 1", font="ArialMT"),
        span(114, 235, "control."),
    ]
    lines = ev2.merge_lines(spans)
    assert [l["text"] for l in lines] == ["Attack: 0 + 1 per Catapult Tower", "control."]


def test_paragraphs_split_on_vertical_gap():
    lines = [
        {"y": 206, "text": "Any enemy in any hex in a straight"},
        {"y": 214, "text": "path from Architectus."},
        {"y": 227, "text": "Attack: 1."},
        {"y": 306, "text": "3."},
    ]
    assert ev2.paragraphs(lines) == [
        "Any enemy in any hex in a straight path from Architectus.",
        "Attack: 1.",
        "3.",
    ]


def test_cooldown_lines_are_those_level_with_or_below_the_cooldown_icon():
    # Carnifex: the effect runs right down to the cooldown with no paragraph gap
    lines = [
        {"y": 747.5, "text": "Carnifex, then replace all its positive"},
        {"y": 754.5, "text": "effects with contrary negative."},
        {"y": 763.6, "text": "5 (3 if the target had any effect)."},
    ]
    assert ev2.cooldown_text(lines, icon_y=762.2) == "5 (3 if the target had any effect)"


def test_cooldown_spanning_two_lines_with_centred_icon():
    lines = [
        {"y": 290, "text": "Effect."},
        {"y": 300, "text": "5 - 1 per allied character"},
        {"y": 308, "text": "in a Mountain hex."},
    ]
    assert ev2.cooldown_text(lines, icon_y=303) == "5 - 1 per allied character in a Mountain hex"


def test_two_line_cooldown_with_icon_level_with_second_line():
    # Lignum / Limp Hands: the icon sits beside the second line
    lines = [
        {"y": 1030, "text": "Attack Decrease."},
        {"y": 1052, "text": "4 - 1 per target's ally in adjacent hexes"},
        {"y": 1060, "text": "to target."},
    ]
    assert ev2.cooldown_text(lines, icon_y=1056) == "4 - 1 per target's ally in adjacent hexes to target"


def test_insert_inline_word_fills_the_blank_run_under_the_icon():
    text = " per       on Iratus."
    assert ev2.insert_inline_word(text, 129.9, 188.6, 148.6, "Wound") == " per Wound on Iratus."


def test_insert_inline_word_picks_the_blank_run_nearest_the_icon():
    text = "a      b      c"
    assert ev2.insert_inline_word(text, 0, 150, 115, "X") == "a      b X c"


def test_strip_cooldown_drops_trailing_period_only():
    assert ev2.clean_cooldown("3.") == "3"
    assert ev2.clean_cooldown("5 - 1 per allied character in a Mountain hex.") == (
        "5 - 1 per allied character in a Mountain hex"
    )


def synthetic_card():
    return [
        span(104, 65, "1", color=WHITE, size=10, font="Arial-BoldMT"),
        span(129, 64, "ARCHITECTUS", size=15, font="HighTowerText-Bold"),
        span(147, 87, "5", size=15, font="ArialMT"),
        span(94, 125, "Features:", size=10, font="HighTowerText-Bold"),
        span(94, 136, "Blocks movement."),
        span(94, 144, "Repairs castle damage."),
        span(94, 152, "Architectus needs ", color=RED, font="HighTowerText-Bold"),
        span(94, 160, "sync with its core attack.", color=RED, font="HighTowerText-Bold"),
        span(97, 193, "TOWER BARRAGE:", size=9, font="HighTowerText-Bold"),
        span(114, 206, "Any enemy."),
        span(114, 227, "Attack: 1."),
        span(97, 252, "FORTIFICATION:", size=9, font="HighTowerText-Bold"),
        span(114, 264, "Any adjacent hex."),
        span(114, 288, "Obstacle       ."),
        span(114, 306, "3", font="ArialMT"),
        span(118, 307, "."),
        span(97, 328, "RECONSTRUCTION:", size=9, font="HighTowerText-Bold"),
        span(114, 342, "Allied Castle."),
        span(114, 366, "Decrease 1 Damage point."),
        span(114, 384, "5 - 1", font="ArialMT"),
        span(130, 385, " per allied character in a Mountain hex. "),
    ]


# Top edge of the target / effect / cooldown icons in the left-hand icon column
SYNTHETIC_ICONS = [209, 228, 267, 286, 306, 344, 363, 383]


def test_parse_card_extracts_features_sync_and_cooldowns():
    card = ev2.parse_card(synthetic_card(), SYNTHETIC_ICONS)
    assert card["id"] == 1
    assert card["name"] == "ARCHITECTUS"
    assert card["features"] == ["Blocks movement.", "Repairs castle damage."]
    assert card["sync_note"] == "Architectus needs sync with its core attack."
    assert [a["name"] for a in card["abilities"]] == ["TOWER BARRAGE", "FORTIFICATION", "RECONSTRUCTION"]
    assert "cooldown" not in card["abilities"][0]
    assert card["abilities"][1]["cooldown"] == "3"
    assert card["abilities"][2]["cooldown"] == "5 - 1 per allied character in a Mountain hex"


def test_features_label_is_never_an_ability_header_even_at_ability_header_size():
    spans = [dict(s, size=9) if s["text"] == "Features:" else s for s in synthetic_card()]
    card = ev2.parse_card(spans, SYNTHETIC_ICONS)
    assert [a["name"] for a in card["abilities"]] == ["TOWER BARRAGE", "FORTIFICATION", "RECONSTRUCTION"]


def test_parse_card_without_sync_note_gives_none():
    spans = [s for s in synthetic_card() if s["color"] != RED]
    assert ev2.parse_card(spans, SYNTHETIC_ICONS)["sync_note"] is None


def test_merge_into_json_adds_fields_by_id_and_rejects_name_mismatch():
    data = {"bestiary_of_sigillum": {"characters": [
        {"id": 1, "name": "ARCHITECTUS", "core_ability": {"target": "t"},
         "support_abilities": [{"target": "a"}, {"target": "b"}]},
    ]}}
    card = ev2.parse_card(synthetic_card(), SYNTHETIC_ICONS)
    ev2.merge_into_json(data, [card])
    ch = data["bestiary_of_sigillum"]["characters"][0]
    assert ch["features"] == ["Blocks movement.", "Repairs castle damage."]
    assert ch["sync_note"].startswith("Architectus needs")
    assert [s["cooldown"] for s in ch["support_abilities"]] == ["3", "5 - 1 per allied character in a Mountain hex"]

    card["name"] = "ARMUS"
    with pytest.raises(ValueError):
        ev2.merge_into_json(data, [card])


def test_classify_range_maps_icon_images_to_ability_range_names():
    assert ev2.classify_range({ev2.LINE_BASE_XREF}) == "one_hex_gap_line"
    assert ev2.classify_range({ev2.LINE_BASE_XREF, ev2.LINE_DOTS_XREF}) == "any_hex_in_line"
    assert ev2.classify_range({1768}) == "adjacent"
    assert ev2.classify_range(set()) is None


def test_classify_range_rejects_unknown_or_ambiguous_icons():
    with pytest.raises(ValueError):
        ev2.classify_range({99999})
    with pytest.raises(ValueError):
        ev2.classify_range({1768, 1770})


def test_range_names_match_the_split_ability_images():
    import split_reference_images as sri
    assert set(ev2.RANGE_BY_XREF.values()) | {"any_hex_in_line"} == set(sri.ABILITY_RANGE_NAMES)


def test_merge_into_json_adds_names_and_ranges_to_core_and_support_abilities():
    data = {"bestiary_of_sigillum": {"characters": [
        {"id": 1, "name": "ARCHITECTUS", "core_ability": {"target": "t"},
         "support_abilities": [{"target": "a"}, {"target": "b"}]},
    ]}}
    card = ev2.parse_card(synthetic_card(), SYNTHETIC_ICONS)
    for a, r in zip(card["abilities"], ["any_hex_in_line", "adjacent", None]):
        a["range"] = r
    ev2.merge_into_json(data, [card])
    ch = data["bestiary_of_sigillum"]["characters"][0]
    assert ch["core_ability"]["name"] == "TOWER BARRAGE"
    assert ch["core_ability"]["range"] == "any_hex_in_line"
    assert [s["name"] for s in ch["support_abilities"]] == ["FORTIFICATION", "RECONSTRUCTION"]
    assert [s["range"] for s in ch["support_abilities"]] == ["adjacent", None]


@pytest.fixture(scope="module")
def pdf_cards():
    return ev2.extract_cards(PDF)


def test_real_pdf_has_36_cards_each_with_features_and_two_cooldowns(pdf_cards):
    assert sorted(c["id"] for c in pdf_cards) == list(range(1, 37))
    for c in pdf_cards:
        assert c["features"], c["name"]
        assert len(c["abilities"]) == 3, c["name"]
        assert all(a.get("cooldown") for a in c["abilities"][1:]), c["name"]


def test_real_pdf_every_support_ability_has_three_icons(pdf_cards):
    for c in pdf_cards:
        assert [a["icon_count"] for a in c["abilities"][1:]] == [3, 3], c["name"]


def test_real_pdf_known_values(pdf_cards):
    by_id = {c["id"]: c for c in pdf_cards}
    arch, ball = by_id[1], by_id[4]
    assert arch["features"] == ["Blocks movement.", "Repairs castle damage."]
    assert arch["sync_note"] == "Architectus needs Catapult Tower control to sync with its core attack."
    assert [a["cooldown"] for a in arch["abilities"][1:]] == ["3", "5 - 1 per allied character in a Mountain hex"]
    assert ball["features"] == ["Big single-target damage.", "Repositions enemies."]
    assert [a["cooldown"] for a in ball["abilities"][1:]] == ["4 (3 if Ballistarius is in a Mountain hex)", "4"]
    assert by_id[2]["sync_note"] is None
    assert by_id[15]["abilities"][2]["cooldown"] == "3 - 1 per Wound on Iratus"
    assert by_id[25]["abilities"][2]["cooldown"] == "2 + 1 per Wound on Vinctum"
    assert by_id[23]["abilities"][2]["cooldown"] == "4 - 1 per target's ally in adjacent hexes to target"
    assert by_id[36]["abilities"][1]["cooldown"] == "2 + 1 for each of Clamoris's allies affected by this Ability"
    carnifex = next(c for c in pdf_cards if c["name"] == "CARNIFEX")
    assert carnifex["abilities"][2]["cooldown"] == "5 (3 if the target had any effect)"


def test_real_pdf_ranges(pdf_cards):
    by_name = {a["name"]: a["range"] for c in pdf_cards for a in c["abilities"]}
    assert len(by_name) == 108
    assert by_name["TOWER BARRAGE"] == "any_hex_in_line"
    assert by_name["DASH"] == "one_hex_gap_line"
    assert by_name["MECHANICAL HAND"] == "one_hex_gap_line"
    assert by_name["FORTIFICATION"] == "adjacent"
    assert by_name["OPTICAL SIGHT"] == "self"
    assert by_name["NOSEDIVE"] == "all_hexes_in_line"
    assert by_name["SHIELD OF THE FOREST"] == "any_hex_or_self"
    assert by_name["TIME LOOP"] == "adjacent_or_self"
    assert by_name["FLUIDITY"] == "any_hex"
    assert by_name["RECONSTRUCTION"] is None  # targets the castle: no range symbol on the card
    assert sum(r is None for r in by_name.values()) == 26


def test_classify_attribute_maps_banner_fills_to_attributes():
    assert ev2.classify_attribute((0.93, 0.11, 0.14)) == "Strength"
    assert ev2.classify_attribute((0.05, 0.58, 0.27)) == "Agility"
    assert ev2.classify_attribute((0.0, 0.44, 0.31)) == "Agility"  # Eresida's darker green
    assert ev2.classify_attribute((0.0, 0.36, 0.62)) == "Intelligence"
    with pytest.raises(ValueError):
        ev2.classify_attribute((0.5, 0.5, 0.5))


def test_banner_attribute_uses_the_fill_drawn_last():
    # Some banners are a red base with the real colour painted over it
    drawings = [{"seqno": 2, "fill": (0.0, 0.36, 0.62)}, {"seqno": 1, "fill": (0.93, 0.11, 0.14)}]
    assert ev2.banner_attribute(drawings) == "Intelligence"
    with pytest.raises(ValueError):
        ev2.banner_attribute([])


def test_merge_into_json_adds_attribute():
    data = {"bestiary_of_sigillum": {"characters": [
        {"id": 1, "name": "ARCHITECTUS", "core_ability": {"target": "t"},
         "support_abilities": [{"target": "a"}, {"target": "b"}]},
    ]}}
    card = ev2.parse_card(synthetic_card(), SYNTHETIC_ICONS)
    card["attribute"] = "Strength"
    ev2.merge_into_json(data, [card])
    assert data["bestiary_of_sigillum"]["characters"][0]["attribute"] == "Strength"


def test_real_pdf_attributes(pdf_cards):
    from collections import Counter
    by_name = {c["name"]: c["attribute"] for c in pdf_cards}
    assert Counter(by_name.values()) == {"Strength": 12, "Agility": 12, "Intelligence": 12}
    # Header colours on the community combinations sheet
    assert by_name["AQUS"] == by_name["TEMPUS"] == by_name["ERESIDA"] == by_name["EQUITA"] == "Agility"
    assert by_name["SAXUM"] == by_name["BREWUS"] == by_name["MECHANICUS"] == "Strength"
    assert by_name["FRIGUS"] == by_name["MAGNUS"] == by_name["ILLESEBRA"] == by_name["LIBRORUM"] == "Intelligence"
