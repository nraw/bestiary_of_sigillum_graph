"""Download every hero's ability icons from bestiary.online.

Usage:
    python3 scripts/download_ability_images.py

Reads  https://www.bestiary.online/en/2_heroes.html and each /en/beast/<hero>.html linked from it
Writes hero_ability_images/<hero>/<n>.png (n = order on the hero page: 1 core, 2-3 support)
       hero_ability_images/manifest.json  {hero: [{name, type, file, source}]}
"""
import json
import re
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "hero_ability_images"
BASE_URL = "https://www.bestiary.online"
INDEX_URL = f"{BASE_URL}/en/2_heroes.html"
DELAY = 0.5  # seconds between requests, as in download_heroes.sh


def hero_slugs(index_html):
    return list(dict.fromkeys(re.findall(r'href="/en/beast/([\w-]+)\.html"', index_html)))


def ability_file(hero, n, src):
    """Positional, so the site can find an icon without matching the website's ability names to the JSON's."""
    return Path(hero) / f"{n}{Path(src).suffix or '.png'}"


class _AbilityParser(HTMLParser):
    """Each ability is <h3><img src=...><br/>NAME</h3> followed by a list whose items include 'Type: X ability.'"""

    def __init__(self):
        super().__init__()
        self.abilities = []
        self._in_h3 = False
        self._in_li = False
        self._li_text = ""

    def handle_starttag(self, tag, attrs):
        if tag == "h3":
            self._in_h3 = True
            self.abilities.append({"name": "", "src": None, "type": None})
        elif tag == "img" and self._in_h3 and self.abilities[-1]["src"] is None:
            self.abilities[-1]["src"] = dict(attrs).get("src")
        elif tag == "li":
            self._in_li, self._li_text = True, ""

    def handle_endtag(self, tag):
        if tag == "h3":
            self._in_h3 = False
            self.abilities[-1]["name"] = " ".join(self.abilities[-1]["name"].split())
        elif tag == "li" and self._in_li:
            self._in_li = False
            match = re.match(r"\s*Type:\s*(\w+)", self._li_text)
            if match and self.abilities and self.abilities[-1]["type"] is None:
                self.abilities[-1]["type"] = match.group(1)

    def handle_data(self, data):
        if self._in_h3:
            self.abilities[-1]["name"] += data
        if self._in_li:
            self._li_text += data


def parse_abilities(hero_html):
    parser = _AbilityParser()
    parser.feed(hero_html)
    return [a for a in parser.abilities if a["src"]]


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def main():
    manifest = {}
    for hero in hero_slugs(fetch(INDEX_URL).decode("utf-8")):
        time.sleep(DELAY)
        abilities = parse_abilities(fetch(f"{BASE_URL}/en/beast/{hero}.html").decode("utf-8"))
        (OUT / hero).mkdir(parents=True, exist_ok=True)
        manifest[hero] = []
        for n, ability in enumerate(abilities, 1):
            file = ability_file(hero, n, ability["src"])
            time.sleep(DELAY)
            (OUT / file).write_bytes(fetch(BASE_URL + ability["src"]))
            manifest[hero].append({"name": ability["name"], "type": ability["type"],
                                   "file": file.as_posix(), "source": BASE_URL + ability["src"]})
        print(f"{hero}: {len(abilities)} abilities")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
