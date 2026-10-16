#!/usr/bin/env python3
"""Make a film scene's local cue files: <key>.<lang>.vtt, .words.json, .verses.json.

Usage:
  python3 -I make-film-cues.py <film.mp4> <startSec> <endSec> <cues.json> <outDir>

cues.json (written by hand from the text the film reads, NIV for LUMO English,
the dub's own words for Russian):

  {"key": "lumo-luke-5-paralytic", "lang": "en", "book": "Luke", "chapter": 5,
   "film": "LUMO, The Gospel of Luke 5:1-39 (Arclight 6_GOLuke2605)",
   "cues": [[17, "One day Jesus was teaching,"], [17, "and Pharisees ..."]]}

Each cue is [verse it starts in, caption text]; one cue per spoken line, about
one breath. Russian: "lang": "ru", "book": "От Луки".

How the times are found (the method of the Widow and Lepers cue files,
2026-10-13): the dialogue is isolated (dialoguenhance, centre channel), the
speech bursts are found on the envelope (-30 dB, pauses of 0.4 s or more), each
burst is transcribed alone with whisper.cpp small and DTW word times, the first
word of every burst is put on the burst start, and the whisper words are
aligned to the cue text with difflib; words whisper missed are interpolated.
The window must be the video card's window, in film seconds.

Needs ffmpeg and whisper-cli on PATH and the model at
~/Desktop/devo-data/whisper/ggml-small.bin (or WHISPER_MODEL). Afterwards run
check-film-sync.py on a render; it is the gate.
"""

import array
import csv
import datetime
import difflib
import json
import math
import os
import re
import subprocess
import sys

MODEL = os.environ.get(
    "WHISPER_MODEL", os.path.expanduser("~/Desktop/devo-data/whisper/ggml-small.bin")
)
STEP = 0.05


def bursts_of(iso):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", iso, "-af", "highpass=f=150", "-f", "s16le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    a = array.array("h", raw)
    win = int(16000 * STEP)
    rms = [math.sqrt(sum(x * x for x in a[i : i + win]) / win) for i in range(0, len(a) - win, win)]
    top = max(rms)
    out, start, last = [], None, None
    for k, v in enumerate(rms):
        if 20 * math.log10(v / top + 1e-9) <= -30:
            continue
        t = k * STEP
        if start is None:
            start = t
        elif t - last > 0.4:
            out.append((start, last + STEP))
            start = t
        last = t
    if start is not None:
        out.append((start, last + STEP))
    return [b for b in out if b[1] - b[0] > 0.15]


def main():
    film, t0, t1, cues_path, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4], sys.argv[5]
    spec = json.load(open(cues_path))
    key, lang, cues = spec["key"], spec.get("lang", "en"), spec["cues"]
    work = os.path.join(out, f".work-{key}-{lang}")
    os.makedirs(work, exist_ok=True)

    iso = os.path.join(work, "iso.wav")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", str(t0), "-to", str(t1), "-i", film, "-af",
         "dialoguenhance=original=0:enhance=3:voice=16,pan=mono|c0=FC", "-ar", "16000", "-ac", "1", iso],
        check=True,
    )
    bursts = bursts_of(iso)
    words = []
    for i, (s, e) in enumerate(bursts):
        s0 = max(0, s - 0.1)
        bw = os.path.join(work, f"b{i:02d}.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(s0), "-to", str(e + 0.2), "-i", iso, bw], check=True)
        subprocess.run(
            ["whisper-cli", "-m", MODEL, "-f", bw, "-l", lang, "-ml", "1", "-sow", "-dtw", "small",
             "-nfa", "-ocsv", "-of", bw[:-4]],
            capture_output=True,
            check=True,
        )
        bwords = [
            (t0 + s0 + int(r["start"]) / 1000, r["text"].strip())
            for r in csv.DictReader(open(bw[:-4] + ".csv"))
            if r["text"].strip()
        ]
        if bwords:
            bwords[0] = (t0 + s, bwords[0][1])
        print(f"burst {t0 + s:7.2f}-{t0 + e:7.2f}: " + " ".join(w for _, w in bwords))
        words += bwords
    bursts = [(t0 + s, t0 + e) for s, e in bursts]

    def norm(w):
        return re.sub(r"[^\w']", "", w.lower())

    ww = [(t, norm(w)) for t, w in words if norm(w) and not re.search(r"foreign|speaking|language|music", w, re.I)]
    sw = [(ci, norm(w)) for ci, (_, c) in enumerate(cues) for w in c.split() if norm(w)]
    times = [None] * len(sw)
    sm = difflib.SequenceMatcher(a=[w for _, w in sw], b=[w for _, w in ww], autojunk=False)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            times[blk.a + k] = ww[blk.b + k][0]
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "replace" and i2 - i1 == j2 - j1:
            for k in range(i2 - i1):
                times[i1 + k] = ww[j1 + k][0]
    known = [i for i, t in enumerate(times) if t is not None]
    if not known:
        sys.exit("whisper matched no cue word: check the window and the language")
    for i, t in enumerate(times):
        if t is not None:
            continue
        p = max((j for j in known if j < i), default=None)
        n = min((j for j in known if j > i), default=None)
        if p is None:
            times[i] = times[n] - 0.3 * (n - i)
        elif n is None:
            times[i] = times[p] + 0.3 * (i - p)
        else:
            times[i] = times[p] + (times[n] - times[p]) * (i - p) / (n - p)
        print("interpolated:", sw[i][1])
    per = [[] for _ in cues]
    for (ci, _), t in zip(sw, times):
        per[ci].append(round(t, 2))

    def ts(x):
        return f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{x % 60:06.3f}"

    def burst_end(t):
        for s, e in bursts:
            if s - 0.05 <= t <= e + 0.05:
                return e
        return t + 0.5

    today = datetime.date.today().isoformat()
    method = (
        "whisper.cpp small -dtw small per speech burst on the isolated dialogue "
        f"(dialoguenhance centre channel), first word on the burst start, {today}"
    )
    lines = ["WEBVTT", "", f"NOTE {spec.get('film', key)}, {lang}.", f"NOTE Timings: {method}.", ""]
    for i, (_, c) in enumerate(cues):
        st = per[i][0] - 0.05
        en = burst_end(per[i][-1])
        if i + 1 < len(cues):
            en = min(en, per[i + 1][0] - 0.15)
        lines += [str(i + 1), f"{ts(st)} --> {ts(en)}", c, ""]
        print(f"{st:7.2f}-{en:7.2f} {c}")
    base = os.path.join(out, f"{key}.{lang}")
    open(base + ".vtt", "w").write("\n".join(lines))
    json.dump(
        {"note": f"Per-cue word start times (s), {method}, aligned to the cue words with difflib.", "cues": per},
        open(base + ".words.json", "w"),
        indent=2,
        ensure_ascii=False,
    )
    json.dump(
        {"note": f"Verse each caption cue starts in, {today}.", "book": spec["book"],
         "chapter": spec["chapter"], "cues": [v for v, _ in cues]},
        open(base + ".verses.json", "w"),
        indent=2,
        ensure_ascii=False,
    )
    print(f"wrote {base}.vtt / .words.json / .verses.json (scratch in {work}, delete it)")


main()
