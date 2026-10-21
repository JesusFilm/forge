#!/usr/bin/env python3
"""Turn an approved devotional script into a Shorts Studio project, 9:16.

    python3 -I make-devotional-project.py <script.json> <outDir>

Self-contained: it needs only the files of this kit (registry.json,
metrics.json, cues.json, music.json, this script). No repo, no fonts, no packages.

Writes, for the Forge Shorts MCP tools:
  create.json  the `document` for shorts.create (tracks + component
               registrations, no items: large creates fail)
  ops-N.json   `operations` for shorts.apply, 25 per file, in order
  speech.txt   what each item says and with which voice, for review

The layout is the recipe (studio-devotional-recipe.md): muted opening shots
with the kinetic captions, the stepper, the film with its numbered Scripture
scrolling, then the reflection in the owner's layout B (2026-10-21): the verse
card on top while the voice talks about it, the sentence low on the screen,
word by word in Inter, the compact source credit under it, the long form's
8 px blur behind; then the takeaway, the closing verse, the question and the
prayer.

Timings are ESTIMATED from word counts unless the script gives them
(`durSec`). After shorts.narrate, read the project and fit each item to its
audio.

script.json (see examples/paralytic-en.json):
  projectId, title, lang ("en" | "ru")
  source      the video source block from shorts.capture (videoId, dubId,
              editionId, language, subtitle, preview, export)
  opening     [{text, hero, accents, shotSec, side?, durSec?}]  3-5 lines,
              shotSec = film second of the muted shot under it
  stepSec     optional [watch, reflect, pray] step lengths (s)
  film        {startSec, endSec, speed, cues, heading}  cues = the scene's cue
              name in cues.json (lumo-luke-5-paralytic.en), or a cue-file base
              relative to script.json
  backdrops   [filmSec, …]  shots behind the reflection, in order
  backdropRate  optional, default 1.0 (slowed clips fail Studio renders)
  sourceEndSec  optional: where the film segment ends (default film.endSec)
  reflection  [{text, durSec?, voice?, highlight?, credit?, callout?}]
              one sentence each. credit = "LABEL\\nSource" (shown under the
              sentence for it and the next two). callout = {text, highlight,
              reference}: put it on every sentence that talks about the verse
              (the owner's calloutSentences rule); consecutive sentences with
              the same callout text share one card. Inner quotes ‘ ’.
  takeaway, takeawaySec?, takeawayHighlight?
  verse       {text, ref, durSec?}  ref as shown, "PSALM 103:2-3 · BSB"
  question, prayer, questionAtSec?, prayerAtSec?, prayBlockSec?
  music       a bed name from music.json ("10-qanun-strings"; never the
              previous devotional's), an asset reference, or null
  voices      optional {main, depth}: speech templates from the approved
              voice presets (everything of a speech object but `text`)
"""

import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
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
        # Layout B (owner, 2026-10-21).
        "reveal": "reveal-sans-en-v1",
        "callout": "verse-callout-ref-en-v3",
        "credit": "source-mark-compact-v2",
        "layoutB": True,
    },
    "ru": {
        "caption": "kinetic-ru-v1",
        "steps": "ИСТОРИЯ,РАЗМЫШЛЕНИЕ,МОЛИТВА",
        "say": ["Давай посмотрим.", "Давай подумаем над этой историей.", "Давай помолимся."],
        "ask": "СНАЧАЛА СПРОСИ СЕБЯ",
        "talk": "ПОГОВОРИ ОБ ЭТОМ С БОГОМ",
        "wps": 2.2,
        # No Cyrillic builds of the layout B elements fit Studio's 32 KB yet:
        # Russian keeps the earlier layout (credit above the sentence).
        "reveal": "reveal-serif-ru-v2",
        "callout": "verse-callout-ru-v1",
        "credit": "source-mark-v1",
        "layoutB": False,
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

# Layout B geometry (owner's Figma, 2026-10-21), 1080 x 1920.
SENT_SIZE, SENT_WIDTH, SENT_LH = 58, 760, 1.46
SENT_BOTTOM = 1348          # the sentence's bottom when no credit is on screen
SAFE_BOTTOM = 1440          # the credit block ends above the feed buttons
CARD_TOP, CARD_WIDTH = 296, 760
CARD_GAP = 60               # the sentence starts at least this far under the card
RULE_GAP = 44               # from the sentence's bottom to the credit's line


def f(sec):
    return max(1, round(sec * FPS))


def spoken_sec(text, wps, pause=0.35):
    return len(text.split()) / wps + pause


METRICS = json.load(open(os.path.join(HERE, "metrics.json")))


def text_width(text, size, face):
    table = METRICS[face]
    return sum(table.get(c, 0.55) for c in text) * size


def wrap_lines(text, width, size, face):
    lines, cur = 1, ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if text_width(trial, size, face) > width and cur:
            lines, cur = lines + 1, word
        else:
            cur = trial
    return lines


def card_bottom(text):
    """Where verse-callout-ref ends: its own size estimate, then the real wrap."""
    shown = f"“{text}”"
    size = 24
    for s in range(56, 24, -2):
        if math.ceil(len(shown) * 0.56 * s * 1.1 / CARD_WIDTH) * s * 1.25 <= 420:
            size = s
            break
    return CARD_TOP + 29 + 36 + wrap_lines(shown, CARD_WIDTH, size, "literata300i") * size * 1.25


def credit_height(source):
    lines = max(1, math.ceil(len(source) * 0.5 * 32 / 498))
    return 3 + 52 + 55 + 16 + 19 + 12 + lines * 40


def main():
    spec_path = sys.argv[1]
    spec = json.load(open(spec_path))
    spec_dir = os.path.dirname(os.path.abspath(spec_path))
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    lang = spec["lang"]
    L = LOCALE[lang]
    reg = {c["versionId"]: c["registration"] for c in json.load(open(os.path.join(HERE, "registry.json")))["components"]}
    used = PACKS[lang] + ["backdrop-blur-v3", "takeaway-v1", "closing-verse-v1", "pray-block-v2",
            L["caption"], "dbp-mark-v1", "film-look-v1", "step-line-v1",
            f"scripture-scroll-{lang}-v1", L["reveal"], L["callout"], L["credit"]]
    missing = [u for u in used if u not in reg]
    if missing:
        sys.exit(f"not in registry.json: {missing}")

    items, speech, warnings = [], [], []
    voices = spec.get("voices") or {}
    step_sec = spec.get("stepSec", [2.8, 2.8, 2.8])

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

    def steps(id, start, step):
        dur = f(step_sec[step])
        comp(id, "cards", start, dur, "step-line-v1",
             {"steps": L["steps"], "step": step, "moveStartSec": 0.25, "moveSec": 2.1, "centerY": 960,
              "fadeInSec": 0.3, "fadeOutSec": 0.4})
        say(id, L["say"][step], "depth")
        return dur

    t = 0
    # Opening: muted shots, one line each, voices alternating.
    for i, line in enumerate(spec["opening"]):
        dur = f(line["durSec"]) if "durSec" in line else f(max(3.0, spoken_sec(line["text"], L["wps"], 0.5)))
        video(f"open-shot-{i + 1}", t, dur, line["shotSec"], 1.0)
        comp(f"open-line-{i + 1}", "captions", t, dur, L["caption"],
             {"hero": line.get("hero", ""), "side": line.get("side", "left" if i % 2 == 0 else "right"),
              "text": line["text"], "scrim": 0.6, "accents": line.get("accents", ""), "wordTimes": "",
              "fadeOutSec": 0.35, "flashColor": "#ff7f53", "accentColor": "#f4efe8", "wordStepSec": 0.3,
              "bottomPercent": 38, "startDelaySec": 0, "keepPunctuation": True})
        say(f"open-line-{i + 1}", line["text"], "main" if i % 2 == 0 else "depth")
        t += dur
    s = steps("step-watch", t, 0)
    # Normal speed: a slowed shot right before the 1.05 film made the whole
    # Studio render fail (each rendered alone; t-hold-film-20261016).
    video("open-shot-hold", t, s, spec["opening"][-1]["shotSec"] + 3, 1.0)
    comp("look-open", "look", 0, t + s, "film-look-v1",
         {"dim": 0.25, "grade": False, "grain": 0, "warmth": 0, "vignette": False, "fadeInSec": 0.3, "fadeOutSec": 0.3})
    comp("dbp-mark-open", "brand", 0, t, "dbp-mark-v1", {"top": 230, "opacity": 0.85, "fadeInSec": 0.6, "fadeOutSec": 0.6})
    t += s

    # The film, with its own sound, and the Scripture scrolling over it.
    film = spec["film"]
    rate = film.get("speed", 1.0)
    film_dur = f((film["endSec"] - film["startSec"]) / rate)
    film_start = t
    video("film-scene", t, film_dur, film["startSec"], rate, volume=1)
    # Cue files next to the script, else the kit's cues.json (every scene
    # that has cue files, keyed by base name).
    base = film["cues"] if os.path.isabs(film["cues"]) else os.path.join(spec_dir, film["cues"])
    if os.path.exists(base + ".words.json"):
        words = json.load(open(base + ".words.json"))["cues"]
        verses = json.load(open(base + ".verses.json"))["cues"]
        vtt = open(base + ".vtt").read()
    else:
        scenes = json.load(open(os.path.join(HERE, "cues.json")))["scenes"]
        name = os.path.basename(film["cues"])
        if name not in scenes:
            sys.exit(f"no cue files for {name}: make them with make-film-cues.py (known: {', '.join(sorted(scenes))})")
        words, verses, vtt = scenes[name]["words"], scenes[name]["verses"], scenes[name]["vtt"]
    cue_text = [b.strip().split("\n")[2] for b in vtt.split("\n\n") if "-->" in b]
    start_sec = film["startSec"]
    lines = "\n".join(
        "%s|%s|%s" % (v, ",".join("%.2f" % ((w - start_sec) / rate) for w in ws), c)
        for v, ws, c in zip(verses, words, cue_text)
    )
    comp("film-scripture", "captions", t, film_dur, f"scripture-scroll-{lang}-v1",
         {"heading": film["heading"], "lines": lines, "still": False, "centerY": 960, "dim": 0.32, "fadeOutSec": 0.6})
    t += film_dur

    # The reflection.
    refl_start = t
    t += steps("step-reflect", t, 1)
    refl = spec["reflection"]
    durs = [f(x["durSec"]) if "durSec" in x else f(spoken_sec(x["text"], L["wps"])) for x in refl]
    starts = []
    for d in durs:
        starts.append(t)
        t += d
    # A credit holds for its sentence and the next two, unless another starts.
    credit_of = [None] * len(refl)
    for i, x in enumerate(refl):
        if x.get("credit"):
            for k in range(i, min(i + 3, len(refl))):
                if k > i and refl[k].get("credit"):
                    break
                credit_of[k] = i
    for i, x in enumerate(refl):
        c = x.get("callout")
        cr = credit_of[i]
        if L["layoutB"]:
            h = wrap_lines(x["text"], SENT_WIDTH, SENT_SIZE, "inter400") * SENT_SIZE * SENT_LH
            if cr is not None:
                bottom = SAFE_BOTTOM - credit_height(refl[cr]["credit"].partition("\n")[2].strip()) - RULE_GAP
            else:
                bottom = SENT_BOTTOM
            if c and bottom - h < card_bottom(c["text"]) + CARD_GAP:
                warnings.append(f"refl-{i + 1:02d}: the sentence would touch the verse card; shorten one of them")
            props = {"text": x["text"], "wordTimes": "", "highlight": x.get("highlight", ""), "fontSize": SENT_SIZE,
                     "top": round(bottom - h / 2), "width": SENT_WIDTH, "align": "center", "color": "#eae6df",
                     "accentColor": "#e6a35c", "fadeOutSec": 0.3}
        else:
            top = 1140 if c else 1040 if cr is not None else 960
            props = {"text": x["text"], "wordTimes": "", "highlight": x.get("highlight", ""), "fontSize": 60,
                     "top": top, "width": 760, "color": "#f4efe8", "fadeOutSec": 0.3}
        comp(f"refl-{i + 1:02d}", "cards", starts[i], durs[i], L["reveal"], props)
        say(f"refl-{i + 1:02d}", x["text"], x.get("voice", "main"))
    # Verse cards: one item per run of sentences with the same callout text.
    i = 0
    while i < len(refl):
        c = refl[i].get("callout")
        if not c:
            i += 1
            continue
        k = i
        while k + 1 < len(refl) and (refl[k + 1].get("callout") or {}).get("text") == c["text"]:
            k += 1
        s0, s1 = starts[i], starts[k] + durs[k]
        if L["layoutB"]:
            comp(f"verse-{i + 1:02d}", "brand", s0, s1 - s0, L["callout"],
                 {"reference": c.get("reference", ""), "opacity": 0.9, "text": c["text"], "highlight": c.get("highlight", ""),
                  "top": CARD_TOP, "width": CARD_WIDTH, "maxHeight": 420, "maxFontSize": 56, "litAtSec": 1.2,
                  "fadeOutSec": 0.5})
        else:
            comp(f"verse-{i + 1:02d}", "brand", s0, s1 - s0, L["callout"],
                 {"text": c["text"], "highlight": c.get("highlight", ""), "top": 430, "width": 860,
                  "maxHeight": 420, "maxFontSize": 56, "litAtSec": 1.2, "fadeOutSec": 0.5})
        i = k + 1
    # Source credits.
    for i, x in enumerate(refl):
        if not x.get("credit"):
            continue
        k = max(j for j in range(len(refl)) if credit_of[j] == i)
        label, _, source = x["credit"].partition("\n")
        low = label.lower()
        kind = ("commentary" if ("comment" in low or "коммент" in low)
                else "language" if ("language" in low or "язык" in low) else "history")
        s0, s1 = starts[i], starts[k] + durs[k]
        if L["layoutB"]:
            comp(f"credit-{i + 1:02d}", "credit", s0, s1 - s0, L["credit"],
                 {"kind": kind, "label": label.strip(), "source": source.strip(),
                  "top": SAFE_BOTTOM - credit_height(source.strip()), "ruleWidth": 326, "emblemSize": 55,
                  "startSec": 0.8, "fadeOutSec": 0.4})
        else:
            comp(f"credit-{i + 1:02d}", "credit", s0, s1 - s0, L["credit"],
                 {"kind": kind, "label": label.strip(), "source": source.strip(), "top": 520,
                  "emblemSize": 76, "fadeOutSec": 0.4})

    # The closing cards (owner, 2026-10-16).
    def blur(id, start, dur, a, b, ramp, scrim, grain):
        comp(id, "look", start, dur, "backdrop-blur-v3",
             {"fromPx": a, "toPx": b, "rampSec": ramp, "scrim": scrim, "grain": grain,
              "fadeInSec": 0.3, "fadeOutSec": 0.05})

    closing_start = t
    dur = f(spec["takeawaySec"]) if "takeawaySec" in spec else f(spoken_sec(spec["takeaway"], L["wps"], 1.0))
    blur("blur-takeaway", t, dur, 8, 8, 0.1, 0.42, 0)
    comp("takeaway", "cards", t, dur, "takeaway-v1",
         {"text": spec["takeaway"], "highlight": spec.get("takeawayHighlight", ""), "centerY": 900,
          "width": 820, "fontSize": 84, "color": "#e6a35c", "revealSec": round(max(1.0, dur / FPS * 0.6), 2),
          "fadeOutSec": 0.4})
    say("takeaway", spec["takeaway"], "main")
    t += dur
    v = spec["verse"]
    dur = f(v["durSec"]) if "durSec" in v else f(spoken_sec(v["text"], L["wps"], 1.2))
    blur("blur-verse", t, dur, 8, 25, 1.6, 0.46, 0.5)
    comp("closing-verse", "cards", t, dur, "closing-verse-v1",
         {"text": v["text"].strip("“”«»\""), "citation": v["ref"], "centerY": 900, "width": 820,
          "fontSize": 62, "revealSec": round(max(1.0, dur / FPS * 0.65), 2), "fadeOutSec": 0.4})
    say("closing-verse", v["text"], "main")
    t += dur

    s = steps("step-pray", t, 2)
    blur("blur-pray-step", t, s, 25, 44, round(s / FPS, 2), 0.46, 0.5)
    t += s
    q_dur = f(spec["prayerAtSec"]) if "prayerAtSec" in spec else f(spoken_sec(spec["question"], L["wps"], 1.5))
    total = f(spec["prayBlockSec"]) if "prayBlockSec" in spec else q_dur + f(spoken_sec(spec["prayer"], L["wps"], 2.0))
    blur("blur-pray", t, total, 44, 72, 2.2, 0.36, 0.5)
    comp("pray-block", "cards", t, total, "pray-block-v2",
         {"askLabel": L["ask"], "question": spec["question"], "prayLabel": L["talk"], "prayer": spec["prayer"],
          "questionAtSec": spec.get("questionAtSec", 0), "prayerAtSec": round(q_dur / FPS, 2), "left": 130,
          "top": 560, "width": 760, "fontSize": 56, "fadeOutSec": 0.8})
    say("pray-block", spec["question"] + " " + spec["prayer"], "depth")
    t += total
    end_mark = f(4)
    comp("dbp-mark-end", "brand", t, end_mark, "dbp-mark-v1", {"top": 230, "opacity": 0.85, "fadeInSec": 0.6, "fadeOutSec": 0.6})
    t += end_mark

    # Film behind everything from REFLECT to the end, cycling the shots.
    span = t - refl_start
    shots = spec["backdrops"]
    n = max(len(shots), -(-span // f(20)))
    each = -(-span // n)
    seg_end = spec.get("sourceEndSec", film["endSec"])
    # Normal speed by default: a slowed clip longer than a few seconds fails
    # the Studio render (19 s at 0.7 did, 4 s passed; 2026-10-16).
    bg_rate = spec.get("backdropRate", 1.0)
    for k in range(n):
        start = refl_start + k * each
        dur = min(each, t - start)
        at = min(shots[k % len(shots)], seg_end - dur / FPS * bg_rate - 0.1)
        video(f"backdrop-{k + 1}", start, dur, at, bg_rate)
    # The long form's portrait reflection blur (8 px, scrim 0.46). NOTE: on
    # 2026-10-21 Studio's backdrop-filter stopped reaching the video (render
    # and editor): only the scrim shows until that is fixed on Studio's side.
    blur("blur-reflection", refl_start, closing_start - refl_start, 8, 8, 0.1, 0.46, 0)
    for pack in PACKS[lang]:
        comp(pack, "fonts", 0, t, pack, {})
    # The music bed, as the local render plays it: under the opening, silent
    # while the film plays its own sound, back from REFLECT to the end, at
    # 0.2. Studio audio has no crossfade or loop, so a bed shorter than its
    # stretch repeats end to end between its sound start and its fade-out
    # (music.json); the seams are untested by ear.
    music = spec.get("music")
    if music:
        if isinstance(music, str):
            bed = json.load(open(os.path.join(HERE, "music.json")))["beds"][music]
            ref = {k: bed[k] for k in ("assetId", "versionId", "digest")}
            # The very first piece starts at the bed's own soft intro; every
            # later one starts past it and stops before the fade, so the
            # end-to-end repeats do not dip (a seam test dipped 18 dB for
            # 0.7 s when repeats restarted at the soft intro).
            first = (bed["inMs"], f((bed["loopOutMs"] - bed["inMs"]) / 1000))
            later = (bed["loopInMs"], f((bed["loopOutMs"] - bed["loopInMs"]) / 1000))
        else:
            ref, first, later = music, (0, None), (0, None)
        n = 0
        for a, b in ((0, film_start), (refl_start, t)):
            at = a
            while at < b:
                src_ms, piece = first if n == 0 else later
                d = min(piece or (b - at), b - at)
                n += 1
                items.append({"id": f"music-{n}", "trackId": "music", "startFrame": at, "durationInFrames": d,
                              "kind": "audio", "asset": ref, "sourceStartMs": src_ms, "volume": 0.2})
                at += d

    # Safe zones: top 270, bottom 1450, the like rail right of 920 in 880-1500.
    for x in items:
        # Scripture is quoted exactly, dashes and all.
        if x["id"] == "closing-verse" or x["id"].startswith("verse-") or x["id"] == "film-scripture":
            continue
        # A range of years ("1816–1900") keeps its en dash; prose never does.
        body = json.dumps({k: v for k, v in x.get("properties", {}).items() if k != "lines"}, ensure_ascii=False)
        if re.search(r"(?<!\d)[–—]|[–—](?!\d)", body):
            warnings.append(f"{x['id']} has an em or en dash")

    doc = {"version": 1, "title": spec["title"], "language": spec["source"]["language"],
           "runtimeVersion": reg["step-line-v1"]["runtimeVersion"],
           "width": W, "height": H, "fps": FPS, "durationInFrames": t,
           "tracks": [{"id": i, "kind": k} for i, k in [("fonts", "visual"), ("clips", "visual"), ("look", "visual"),
                                                         ("captions", "caption"), ("cards", "caption"),
                                                         ("brand", "caption"), ("credit", "caption"),
                                                         ("music", "audio")]],
           "components": [reg[u] for u in dict.fromkeys(used)], "items": [], "packRevisionIds": []}
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
    for w_ in warnings:
        print("warning:", w_)
    print(f"{len(items)} items, {t / FPS:.0f} s, {-(-len(ops) // 25)} ops files, {len(speech)} spoken items -> {out}")


main()
