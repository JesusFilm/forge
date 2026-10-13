#!/usr/bin/env python3
"""Check that a devotional's film captions follow the voice.

Usage: python3 -I check-film-sync.py <dir with manifest.json + the video card's clip>

Isolates the dialogue (ffmpeg dialoguenhance, centre channel), finds the
stretches where somebody speaks, and checks every caption word against them:

  - a word whose start sits inside a pause of 0.4s or more is EARLY or LATE
    (the RU Ten Lepers cue file put words 3-5s into the film's wordless
    stretches, 2026-10-13);
  - a speech burst with no word starting within 0.5s of it is UNCAPTIONED.

Exits 1 on any problem, so it can gate a render. A source pack
(`*.source/`) and a staged short (`--stage-out`) both have this layout.
"""

import array
import json
import math
import os
import subprocess
import sys

STEP = 0.05  # envelope resolution (s)
SPEECH_DB = -30  # relative to the loudest window
MIN_PAUSE = 0.4  # a gap shorter than this is breath, not a pause
TOLERANCE = 0.35  # a word may start this far into a pause (onset slop)


def envelope(clip: str) -> list[bool]:
    raw = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", clip, "-af",
            "dialoguenhance=original=0:enhance=3:voice=16,pan=mono|c0=FC,highpass=f=150",
            "-ar", "16000", "-f", "s16le", "-",
        ],
        check=True,
        capture_output=True,
    ).stdout
    a = array.array("h", raw)
    win = int(16000 * STEP)
    rms = [
        math.sqrt(sum(x * x for x in a[i : i + win]) / win)
        for i in range(0, len(a) - win, win)
    ]
    top = max(rms) or 1
    return [20 * math.log10(v / top + 1e-9) > SPEECH_DB for v in rms]


def bursts(on: list[bool]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    start = last = None
    for k, v in enumerate(on):
        t = k * STEP
        if not v:
            continue
        if start is None:
            start = t
        elif t - last > MIN_PAUSE:
            out.append((start, last + STEP))
            start = t
        last = t
    if start is not None:
        out.append((start, last + STEP))
    return [b for b in out if b[1] - b[0] > 0.15]


def main() -> int:
    d = sys.argv[1]
    m = json.load(open(os.path.join(d, "manifest.json")))
    card = next(c for c in m["cards"] if c["kind"] == "video" and c.get("subtitles"))
    clip = os.path.join(d, card["videoFile"])
    words = [
        (w, t)
        for s in card["subtitles"]
        for w, t in zip(s["text"].split(), s.get("words") or [])
        if t >= 0
    ]
    if not words:
        print("no word times on the film card")
        return 1
    speech = bursts(envelope(clip))
    problems = []
    for w, t in words:
        inside = any(a - TOLERANCE <= t <= b for a, b in speech)
        if not inside:
            nxt = min((a for a, _ in speech if a > t), default=None)
            prv = max((b for _, b in speech if b < t), default=None)
            where = (
                f"voice resumes at {nxt:.2f} ({t - nxt:+.2f}s)"
                if nxt is not None
                else f"voice ended at {prv:.2f}"
            )
            problems.append(f"  {t:7.2f}  {w:<16} in a pause; {where}")
    first, last = words[0][1], words[-1][1]
    for a, _ in speech:
        if first - 0.5 <= a <= last + 0.5 and not any(abs(t - a) <= 0.5 for _, t in words):
            problems.append(f"  {a:7.2f}  speech burst with no word starting near it")
    print(f"{len(words)} words, {len(speech)} speech bursts, {len(problems)} problem(s)")
    print("\n".join(problems))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
