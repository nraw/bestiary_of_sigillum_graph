import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from download_ability_images import ability_file, hero_slugs, parse_abilities  # noqa: E402

INDEX_HTML = """
<a href="/en/beast/aqus.html">Aqus</a><a href="/en/beast/armus.html">x</a>
<a href="/en/beast/aqus.html">dup</a><a href="/en/1_news.html">news</a>
"""

HERO_HTML = """
<img class="imgleft" src="/en/file/239_1-1-l-beasts1image.png" alt="ARCHITECTUS" />
<h2>Abilities</h2>
<ul><li><h3><img width="170" alt="1-2" src="/en/file/237_1-2.png" /><br />TOWER BARRAGE</h3>
<ul><li>Type: Attack ability.</li><li>Cooldown: 1 turn.</li></ul></li>
<li><h3><img alt="1-3" src="/en/file/236_1-3.png" /><br />FORTIFICATION</h3><ul><li>Type: Support ability.</li></ul></li>
<li><h3><img alt="1-4" src="/en/file/238_1-4.png" /><br />RECONSTRUCTION</h3><ul><li>Type: Support ability.</li></ul></li></ul>
"""


def test_hero_slugs_unique_in_order():
    assert hero_slugs(INDEX_HTML) == ["aqus", "armus"]


def test_parse_abilities_skips_portrait_and_keeps_order():
    assert parse_abilities(HERO_HTML) == [
        {"name": "TOWER BARRAGE", "src": "/en/file/237_1-2.png", "type": "Attack"},
        {"name": "FORTIFICATION", "src": "/en/file/236_1-3.png", "type": "Support"},
        {"name": "RECONSTRUCTION", "src": "/en/file/238_1-4.png", "type": "Support"},
    ]


def test_ability_file_is_positional():
    assert ability_file("armus", 1, "/en/file/237_1-2.png") == Path("armus/1.png")