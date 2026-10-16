"""Build the font subsets the Studio components embed.

Studio components cannot load font files and must stay under 32768 bytes, so
each one embeds a small WOFF2 subset as base64. Sources are the Literata
variable fonts already in the repo (src/devotional/teaser-fonts-data.ts),
extracted to fonts/src/ (git-ignored) and instanced here.

    python3 subset-fonts.py   # needs: pip install fonttools brotli
"""
import base64, os, re
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "..", "..", "packages", "shorts-compositions", "src", "devotional", "teaser-fonts-data.ts")
SRC = os.path.join(HERE, "fonts", "src")
OUT = os.path.join(HERE, "fonts")

ASCII = "".join(chr(c) for c in range(32, 127))
TYPO = "‘’“”—–…·«»"
CYR = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"
CYR += CYR.lower()


def extract():
    os.makedirs(SRC, exist_ok=True)
    text = open(DATA).read()
    for name in ("LITERATA_VAR_TTF_BASE64", "LITERATA_ITALIC_VAR_TTF_BASE64"):
        path = os.path.join(SRC, name.replace("_TTF_BASE64", "").lower() + ".ttf")
        if os.path.exists(path):
            continue
        m = re.search(name + r'\s*=\s*\n?\s*"([A-Za-z0-9+/=]+)"', text)
        open(path, "wb").write(base64.b64decode(m.group(1)))


def make(src, axes, chars, out):
    f = TTFont(os.path.join(SRC, src))
    f = instancer.instantiateVariableFont(f, axes)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.hinting = False
    opts.desubroutinize = True
    opts.layout_features = ["kern", "liga"]
    opts.notdef_outline = True
    s = subset.Subsetter(opts)
    s.populate(text=chars)
    s.subset(f)
    f.flavor = "woff2"
    path = os.path.join(OUT, out)
    f.save(path)
    print(out, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    extract()
    make("literata_var.ttf", {"wght": 400, "opsz": 36}, ASCII + TYPO, "literata400-latin.woff2")
    make("literata_var.ttf", {"wght": 400, "opsz": 36}, CYR + ASCII + TYPO, "literata400-cyrillic.woff2")
    make("literata_italic_var.ttf", {"wght": 400, "opsz": 36}, ASCII + TYPO, "literata400i-latin.woff2")
    make("literata_italic_var.ttf", {"wght": 400, "opsz": 36}, CYR + ASCII + TYPO, "literata400i-cyrillic.woff2")
