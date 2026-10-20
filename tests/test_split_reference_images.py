import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import split_reference_images as sri  # noqa: E402

EFFECT_SHEET = ROOT / "effect_images" / "effect_markers_v2.png"
ABILITY_SHEET = ROOT / "ability_images" / "ability_ranges.png"


def overlaps(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


@pytest.fixture(scope="module")
def effect_boxes():
    return sri.detect_effect_icons(Image.open(EFFECT_SHEET))


@pytest.fixture(scope="module")
def ability_boxes():
    return sri.detect_ability_diagrams(Image.open(ABILITY_SHEET))


def test_name_lists_are_unique():
    assert len(set(sri.EFFECT_NAMES)) == len(sri.EFFECT_NAMES) == 16
    assert len(set(sri.ABILITY_RANGE_NAMES)) == len(sri.ABILITY_RANGE_NAMES) == 8


def test_effect_names_include_silence_and_web_in_sheet_order():
    # Right column: ... Poison (cooldown), Silence, Occupied hex (obstacle), Web.
    assert sri.EFFECT_NAMES[12:] == ["poison", "silence", "place_obstacle", "web"]


def test_detects_one_square_box_per_effect_icon(effect_boxes):
    assert len(effect_boxes) == 16
    for left, top, right, bottom in effect_boxes:
        w, h = right - left, bottom - top
        assert 140 <= w <= 175 and 140 <= h <= 175
        assert abs(w - h) <= 2


def test_effect_boxes_are_column_major(effect_boxes):
    left_col, right_col = effect_boxes[:8], effect_boxes[8:]
    assert all(b[2] < 865 for b in left_col)
    assert all(b[0] > 865 for b in right_col)
    for col in (left_col, right_col):
        tops = [b[1] for b in col]
        assert tops == sorted(tops)


def test_detects_eight_ability_diagrams_without_captions(ability_boxes):
    assert len(ability_boxes) == 8
    for left, top, right, bottom in ability_boxes:
        # Diagrams are 1-4 hexes wide and one or two hex rows tall; captions excluded.
        assert 90 <= bottom - top <= 200
        assert 100 <= right - left <= 460


def test_ability_line_diagram_keeps_faded_hexes(ability_boxes):
    # Right column, second row: four hexes fading out to the right edge (~x=1185).
    assert ability_boxes[5][2] >= 1180


def test_ability_diagram_ignores_stray_specks(ability_boxes):
    # Left column, third row: a small "‹" scuff sits at x~155, left of the first hex (~x=215).
    assert ability_boxes[2][0] >= 200


def test_boxes_do_not_overlap(effect_boxes, ability_boxes):
    for boxes in (effect_boxes, ability_boxes):
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                assert not overlaps(a, b)


def test_split_writes_named_effect_icons_with_transparent_corners(tmp_path):
    written = sri.split_effects(EFFECT_SHEET, tmp_path)
    assert [p.stem for p in written] == sri.EFFECT_NAMES
    for path in written:
        icon = Image.open(path)
        assert icon.mode == "RGBA"
        assert icon.getpixel((0, 0))[3] == 0
        cx, cy = icon.width // 2, icon.height // 2
        assert icon.getpixel((cx, cy))[3] == 255


def test_split_writes_named_ability_diagrams(tmp_path):
    written = sri.split_abilities(ABILITY_SHEET, tmp_path)
    assert [p.stem for p in written] == sri.ABILITY_RANGE_NAMES
    for path in written:
        assert Image.open(path).size[0] >= 100
