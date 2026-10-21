"""Split the Watch Montserrat variable font into unicode-range subsets.

Usage (from apps/web, needs `pip install fonttools brotli`):
    python3 scripts/subset-watch-font.py

Writes src/fonts/montserrat-{latin,cyrillic,rest}.woff2 and prints the exact
`unicode-range` for each file. Paste those into src/lib/watch-font.ts; next/font
only accepts literal options. The three sets are disjoint apart from combining
marks, and together cover every code point of the source font, so no glyph is
lost: a page downloads only the files whose characters it renders.

Every subset carries every combining mark the font has. The browser shapes a
base letter and its marks with one font, and a font only "has" the code points
in its unicode-range. If a mark lived only in another subset, a cluster such as
M + U+0327 (Marshallese), decomposed Vietnamese, or Bulgarian о + U+0300 would
match no subset and render whole in a system font.

The name table is kept in full: it carries the SIL Open Font License notice
(name IDs 13 and 14) that the OFL requires with every copy, and the designer
credits.
"""

import subprocess
from pathlib import Path

from fontTools.ttLib import TTFont

SOURCE = Path("public/fonts/Montserrat-VariableFont_wght.woff2")
OUT = Path("src/fonts")


def span(a, b):
    return set(range(a, b + 1))


# Google Fonts' `latin` subset, plus the arrows and symbols Watch chrome uses.
LATIN = (
    span(0x0000, 0x00FF)
    | {0x0131, 0x0152, 0x0153, 0x02BB, 0x02BC, 0x02C6, 0x02DA, 0x02DC}
    | {0x0304, 0x0308, 0x0329, 0x20AC, 0x2122, 0x2212, 0x2215, 0x2248}
    | {0xFEFF, 0xFFFD}
    | span(0x2000, 0x206F)
    | span(0x2190, 0x2195)
)
# Google Fonts' `cyrillic` and `cyrillic-ext` subsets.
CYRILLIC = (
    {0x0301, 0x2116, 0x20B4}
    | span(0x0400, 0x052F)
    | span(0x1C80, 0x1C8A)
    | span(0x2DE0, 0x2DFF)
    | span(0xA640, 0xA69F)
    | span(0xFE2E, 0xFE2F)
)
COMBINING = span(0x0300, 0x036F) | span(0x1DC0, 0x1DFF)


def ranges(codepoints):
    out, run = [], []
    for cp in sorted(codepoints):
        if run and cp == run[-1] + 1:
            run.append(cp)
            continue
        if run:
            out.append(run)
        run = [cp]
    if run:
        out.append(run)
    return ", ".join(
        f"U+{r[0]:04X}" if len(r) == 1 else f"U+{r[0]:04X}-{r[-1]:04X}" for r in out
    )


def main():
    cmap = set(TTFont(SOURCE).getBestCmap())
    marks = cmap & COMBINING
    latin = (cmap & LATIN) | marks
    cyrillic = ((cmap & CYRILLIC) - latin) | marks
    rest = (cmap - latin - cyrillic) | marks
    assert latin | cyrillic | rest == cmap
    OUT.mkdir(exist_ok=True)
    for name, codepoints in (("latin", latin), ("cyrillic", cyrillic), ("rest", rest)):
        target = OUT / f"montserrat-{name}.woff2"
        subprocess.run(
            [
                "pyftsubset",
                str(SOURCE),
                f"--unicodes={ranges(codepoints)}",
                "--layout-features=*",
                "--name-IDs=*",
                "--flavor=woff2",
                f"--output-file={target}",
            ],
            check=True,
        )
        print(f"{name}: {target.stat().st_size} B\n  {ranges(codepoints)}")


if __name__ == "__main__":
    main()
