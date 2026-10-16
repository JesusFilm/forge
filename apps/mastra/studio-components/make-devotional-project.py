#!/usr/bin/env python3
"""Turn an approved devotional script into a Shorts Studio project, 9:16.

    python3 -I apps/mastra/studio-components/make-devotional-project.py <script.json> <outDir>

Writes, for the Forge Shorts MCP tools:
  create.json  the `document` for shorts.create (tracks + component
               registrations, no items: large creates fail)
  ops-N.json   `operations` for shorts.apply, 25 per file, in order
  speech.txt   what each item says and with which voice, for review

The layout is docs/studio-devotional-recipe.md: muted opening shots with the
kinetic captions, the stepper, the film with its numbered Scripture
scrolling, slow film behind the reflection (one word-by-word sentence at a
time, the verse callout while it is talked about, the insight's credit), the
takeaway, the closing verse, the question and the prayer.

Timings are ESTIMATED from word counts (the narration does not exist yet).
After shorts.narrate, read the project and fit each item to its audio.

script.json (every path relative to the repo root; see
studio-components/examples/widow-en.json):
  projectId, title, lang ("en" | "ru")
  source      the video source block from shorts.capture (videoId, dubId,
              editionId, language, subtitle, preview, export)
  opening     [{text, hero, accents, shotSec}]  3-5 lines, shotSec = film
              second of the muted shot under it
  film        {startSec, endSec, speed, cues, heading}  cues = cue-file base
              (…/lumo-luke-18-widow.en), heading = "Luke 18:1-8"
  backdrops   [filmSec, …]  slow shots behind the reflection, in order
  sourceEndSec  optional: where the film segment ends (default film.endSec);
              no shot is placed past it
  reflection  [{text, highlight?, credit?, callout?: {text, highlight}}]
              one sentence each; a callout stays up over consecutive
              sentences that carry the same callout text
  takeaway, question, prayer   strings
  takeawayHighlight  optional phrase of the takeaway set in italic
  verse       {text, ref}  ref as shown, "ROMANS 12:12 · BSB"
  music       asset reference {assetId, versionId, digest} or null
  voices      optional {main, depth}: speech templates from the approved
              voice presets (everything of a speech object but `text`);
              with them the ops carry set-speech, without them only
              speech.txt is written
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FPS = 30
W, H = 1080, 1920

LOCALE = {
    "en": {
        "caption": "Caption-orange",
        "steps": "WATCH,REFLECT,PRAY",
        "say": ["Let's watch.", "Let's look more closely at what this story means.", "Let's pray."],
        "ask": "FIRST, ASK YOURSELF",
        "talk": "TALK TO GOD ABOUT IT",
        "wps": 2.6,
    },
    "ru": {
        "caption": "kinetic-ru-v1",
        "steps": "ИСТОРИЯ,РАЗМЫШЛЕНИЕ,МОЛИТВА",
        "say": ["Давай посмотрим.", "Давай подумаем над этой историей.", "Давай помолимся."],
        "ask": "СНАЧАЛА СПРОСИ СЕБЯ",
        "talk": "ПОГОВОРИ ОБ ЭТОМ С БОГОМ",
        "wps": 2.2,
    },
}


PACKS = {
    "en": ["font-sourceserif300i-latin-v1", "font-literata400-latin-v1", "font-literata400i-latin-v1",
           "font-literata500-latin-v1", "font-literata500i-latin-v1", "font-inter600caps-latin-v1"],
    "ru": ["font-literata400-latin-v1", "font-literata400-cyrillic-v1", "font-literata400i-latin-v1",
           "font-literata400i-cyrillic-v1", "font-literata500-latin-v1", "font-literata500-cyrillic-v1",
           "font-literata500i-latin-v1", "font-literata500i-cyrillic-v1", "font-inter600caps-latin-v1",
           "font-inter600caps-cyrillic-v1"],
}


def f(sec):
    return max(1, round(sec * FPS))


def spoken_sec(text, wps, pause=0.35):
    return len(text.split()) / wps + pause


def main():
    spec = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    lang = spec["lang"]
    L = LOCALE[lang]
    reg = {c["versionId"]: c["registration"] for c in json.load(open(os.path.join(HERE, "registry.json")))["components"]}
    used = PACKS[lang] + ["backdrop-blur-v3", "takeaway-v1", "closing-verse-v1", "pray-block-v1",
            L["caption"], "dbp-mark-v1", "film-look-v1", "step-line-v1",
            f"scripture-scroll-{lang}-v1", f"reveal-serif-{lang}-v2", f"verse-callout-{lang}-v1"]
    missing = [u for u in used if u not in reg]
    if missing:
        sys.exit(f"not in registry.json: {missing}")

    items, speech = [], []
    voices = spec.get("voices") or {}

    def say(item_id, text, voice):
        speech.append((item_id, voice, text))

    def video(id, start, dur, film_sec, rate, volume=0):
        src = dict(spec["source"])
        src["startMs"] = int(film_sec * 1000)
        src["endMs"] = int((film_sec + dur / FPS * rate) * 1000) + 1
        items.append({"id": id, "trackId": "clips", "startFrame": start, "durationInFrames": dur, "kind": "video",
                      "focus": {"x": 0.5, "y": 0.5}, "source": src, "volume": volume,
                      **({"playbackRate": rate} if rate != 1 else {})})

    def comp(id, track, start, dur, vid, props):
        items.append({"id": id, "trackId": track, "startFrame": start, "durationInFrames": dur, "kind": "component",
                      "componentVersionId": vid, "properties": props})

    def text(id, track, start, dur, body, y, size=30, color="#f2c46b", weight=600, family="Inter"):
        items.append({"id": id, "trackId": track, "startFrame": start, "durationInFrames": dur,
                      "transform": {"x": 0, "y": y, "scaleX": 1, "scaleY": 1, "rotation": 0, "opacity": 1},
                      "kind": "text", "text": body,
                      "properties": {"color": color, "fontSize": size, "fontFamily": family, "fontWeight": weight,
                                     "align": "center", "shadow": True, "shadowBlur": 16, "shadowOffset": 2,
                                     "entrance": "fade", "exit": "fade", "entranceFrames": 12, "exitFrames": 12}})

    def reveal(id, start, dur, body, top=960, size=60, highlight=""):
        comp(id, "cards", start, dur, f"reveal-serif-{lang}-v2",
             {"text": body, "wordTimes": "", "highlight": highlight, "fontSize": size, "top": top,
              "width": 760, "color": "#f4efe8", "fadeOutSec": 0.3})

    def steps(id, start, step):
        dur = f(2.8)
        comp(id, "cards", start, dur, "step-line-v1",
             {"steps": L["steps"], "step": step, "moveStartSec": 0.25, "moveSec": 2.1, "centerY": 960,
              "fadeInSec": 0.3, "fadeOutSec": 0.4})
        say(id, L["say"][step], "depth")
        return dur

    t = 0
    # Opening: muted shots, one line each, voices alternating.
    for i, line in enumerate(spec["opening"]):
        dur = f(max(3.0, spoken_sec(line["text"], L["wps"], 0.5)))
        video(f"open-shot-{i + 1}", t, dur, line["shotSec"], 1.0)
        comp(f"open-line-{i + 1}", "captions", t, dur, L["caption"],
             {"hero": line.get("hero", ""), "side": "left" if i % 2 == 0 else "right", "text": line["text"],
              "scrim": 0.6, "accents": line.get("accents", ""), "wordTimes": "", "fadeOutSec": 0.35,
              "flashColor": "#ff7f53", "accentColor": "#f4efe8", "wordStepSec": 0.3, "bottomPercent": 38,
              "startDelaySec": 0, "keepPunctuation": True})
        say(f"open-line-{i + 1}", line["text"], "main" if i % 2 == 0 else "depth")
        t += dur
    # The stepper over the last opening shot, held.
    s = steps("step-watch", t, 0)
    video("open-shot-hold", t, s, spec["opening"][-1]["shotSec"] + 3, 0.5)
    comp("look-open", "look", 0, t + s, "film-look-v1",
         {"dim": 0.25, "grade": False, "grain": 0, "warmth": 0, "vignette": False, "fadeInSec": 0.3, "fadeOutSec": 0.3})
    comp("dbp-mark-open", "brand", 0, t, "dbp-mark-v1", {"top": 230, "opacity": 0.85, "fadeInSec": 0.6, "fadeOutSec": 0.6})
    t += s

    # The film, with its own sound, and the Scripture scrolling over it.
    film = spec["film"]
    rate = film.get("speed", 1.0)
    film_dur = f((film["endSec"] - film["startSec"]) / rate)
    video("film-scene", t, film_dur, film["startSec"], rate, volume=1)
    base = os.path.join(REPO, film["cues"])
    words = json.load(open(base + ".words.json"))["cues"]
    verses = json.load(open(base + ".verses.json"))["cues"]
    vtt = open(base + ".vtt").read()
    cue_text = [b.strip().split("\n")[2] for b in vtt.split("\n\n") if "-->" in b]
    lines = "\n".join(
        f"{v}|{','.join(f'{(w - film['startSec']) / rate:.2f}' for w in ws)}|{c}"
        for v, ws, c in zip(verses, words, cue_text)
    )
    comp("film-scripture", "captions", t, film_dur, f"scripture-scroll-{lang}-v1",
         {"heading": film["heading"], "lines": lines, "still": False, "centerY": 960, "dim": 0.32, "fadeOutSec": 0.6})
    t += film_dur

    # Reflection over slow film.
    refl_start = t
    s = steps("step-reflect", t, 1)
    t += s
    callout_open = None
    for i, sent in enumerate(spec["reflection"]):
        dur = f(spoken_sec(sent["text"], L["wps"]))
        c = sent.get("callout")
        if c and (not callout_open or callout_open[1]["text"] != c["text"]):
            callout_open = [t, c]
        if not c:
            callout_open = None
        reveal(f"refl-{i + 1:02d}", t, dur, sent["text"], top=1140 if c else 960, highlight=sent.get("highlight", ""))
        say(f"refl-{i + 1:02d}", sent["text"], "main")
        if c:
            # One callout item spans the run of sentences that carry it.
            start = callout_open[0]
            id = f"callout-{start}"
            items[:] = [x for x in items if x["id"] != id]
            comp(id, "brand", start, t + dur - start, f"verse-callout-{lang}-v1",
                 {"text": c["text"], "highlight": c.get("highlight", ""), "top": 430, "width": 860,
                  "maxHeight": 420, "maxFontSize": 56, "litAtSec": 1.2, "fadeOutSec": 0.5})
        elif sent.get("credit"):
            text(f"credit-{i + 1:02d}", "brand", t, min(dur, f(5)), sent["credit"], -560)
        t += dur
    # The closing cards (owner, 2026-10-16): the takeaway in large gold over a
    # light blur, the verse in italic over a deepening blur, then PRAY, then
    # the question and the prayer together, left-aligned, over a heavy blur.
    def blur(id, start, dur, a, b, ramp, scrim, grain):
        comp(id, "look", start, dur, "backdrop-blur-v3",
             {"fromPx": a, "toPx": b, "rampSec": ramp, "scrim": scrim, "grain": grain,
              "fadeInSec": 0.3, "fadeOutSec": 0.05})

    closing_start = t
    dur = f(spoken_sec(spec["takeaway"], L["wps"], 1.0))
    blur("blur-takeaway", t, dur, 8, 8, 0.1, 0.42, 0)
    comp("takeaway", "cards", t, dur, "takeaway-v1",
         {"text": spec["takeaway"], "highlight": spec.get("takeawayHighlight", ""), "centerY": 900,
          "width": 820, "fontSize": 84, "color": "#e6a35c", "revealSec": max(1.0, dur / FPS * 0.6), "fadeOutSec": 0.4})
    say("takeaway", spec["takeaway"], "main")
    t += dur
    v = spec["verse"]
    dur = f(spoken_sec(v["text"], L["wps"], 1.2))
    blur("blur-verse", t, dur, 8, 25, 1.6, 0.46, 0.5)
    comp("closing-verse", "cards", t, dur, "closing-verse-v1",
         {"text": v["text"].strip("“”«»\""), "citation": v["ref"], "centerY": 900, "width": 820,
          "fontSize": 62, "revealSec": max(1.0, dur / FPS * 0.65), "fadeOutSec": 0.4})
    say("closing-verse", v["text"], "main")
    t += dur

    s = steps("step-pray", t, 2)
    blur("blur-pray-step", t, s, 25, 44, s / FPS, 0.46, 0.5)
    t += s
    q_dur = f(spoken_sec(spec["question"], L["wps"], 1.5))
    p_dur = f(spoken_sec(spec["prayer"], L["wps"], 2.0))
    blur("blur-pray", t, q_dur + p_dur, 44, 72, 2.2, 0.36, 0.5)
    comp("pray-block", "cards", t, q_dur + p_dur, "pray-block-v1",
         {"askLabel": L["ask"], "question": spec["question"], "prayLabel": L["talk"], "prayer": spec["prayer"],
          "questionAtSec": 0, "prayerAtSec": round(q_dur / FPS, 2), "left": 130, "top": 560, "width": 760,
          "fontSize": 56, "fadeOutSec": 0.8})
    # One item, one voice: question then prayer. After narration, set
    # prayerAtSec to where the prayer starts in the audio.
    say("pray-block", spec["question"] + " " + spec["prayer"], "depth")
    t += q_dur + p_dur
    end_mark = f(4)
    comp("dbp-mark-end", "brand", t, end_mark, "dbp-mark-v1", {"top": 230, "opacity": 0.85, "fadeInSec": 0.6, "fadeOutSec": 0.6})
    t += end_mark

    # Slow film behind everything from REFLECT to the end, cycling the shots.
    span = t - refl_start
    shots = spec["backdrops"]
    n = max(len(shots), -(-span // f(20)))
    each = -(-span // n)
    # A shot never runs past the end of the film segment (sourceEndSec,
    # default the scene's end): it starts earlier instead.
    seg_end = spec.get("sourceEndSec", film["endSec"])
    for k in range(n):
        start = refl_start + k * each
        dur = min(each, t - start)
        at = min(shots[k % len(shots)], seg_end - dur / FPS * 0.7 - 0.1)
        video(f"backdrop-{k + 1}", start, dur, at, 0.7)
    comp("look-reflection", "look", refl_start, closing_start - refl_start, "film-look-v1",
         {"dim": 0.45, "grade": False, "grain": 0, "warmth": 0, "vignette": False, "fadeInSec": 0.3, "fadeOutSec": 0.3})
    # Font packs: faces the closing components name, over the whole video.
    for pack in PACKS[lang]:
        comp(pack, "fonts", 0, t, pack, {})
    if spec.get("music"):
        items.append({"id": "music", "trackId": "music", "startFrame": 0, "durationInFrames": t, "kind": "audio",
                      "asset": spec["music"], "sourceStartMs": 0, "volume": 0.18})

    # Safe zones: top 270, bottom 1450, the like rail right of 920 in 880-1500.
    for x in items:
        y = x.get("transform", {}).get("y")
        if y is not None and not (270 - 960 + 40 <= y <= 1450 - 960 - 40):
            print(f"warning: {x['id']} at y {y} is near the safe-zone edge")
        # A range of years ("1816–1900") keeps its en dash; prose never does.
        if re.search(r"(?<!\d)[–—]|[–—](?!\d)", json.dumps(x, ensure_ascii=False)):
            print(f"warning: {x['id']} has an em or en dash")

    # Studio names languages in full ("english"), as shorts.capture does.
    doc = {"version": 1, "title": spec["title"], "language": spec["source"]["language"], "runtimeVersion": reg["step-line-v1"]["runtimeVersion"],
           "width": W, "height": H, "fps": FPS, "durationInFrames": t,
           "tracks": [{"id": i, "kind": k} for i, k in [("fonts", "visual"), ("clips", "visual"), ("look", "visual"), ("captions", "caption"),
                                                         ("cards", "caption"), ("brand", "caption"), ("music", "audio")]],
           "components": [reg[u] for u in used], "items": [], "packRevisionIds": []}
    json.dump(doc, open(os.path.join(out, "create.json"), "w"), ensure_ascii=False, indent=1)
    ops = [{"kind": "insert-item", "item": x} for x in items]
    if voices:
        for item_id, voice, body in speech:
            ops.append({"kind": "set-speech", "itemId": item_id, "speech": {**voices[voice], "text": body}})
    for k in range(0, len(ops), 25):
        json.dump(ops[k : k + 25], open(os.path.join(out, f"ops-{k // 25}.json"), "w"), ensure_ascii=False)
    with open(os.path.join(out, "speech.txt"), "w") as fh:
        for item_id, voice, body in speech:
            fh.write(f"{item_id}\t{voice}\t{body}\n")
    print(f"{len(items)} items, {t / FPS:.0f} s, {-(-len(ops) // 25)} ops files, {len(speech)} spoken items -> {out}")


main()
