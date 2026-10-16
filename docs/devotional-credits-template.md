# Devotional credits block (captions and descriptions)

Every published devotional carries the same credits: the film, the Bible
translation, the reflection's human source with its publication year, and an
honest line about where AI was and was not used. The point of the last line is
the distinction the owner asked for: **the words that carry meaning are human;
AI edits, voices and assembles them.**

## Short form (Instagram, Facebook, TikTok)

```
Film: The JESUS Film, Jesus Film Project
Scripture: Berean Standard Bible (public domain)
Reflection: adapted from J.C. Ryle, Expository Thoughts on the Gospels, 1858
Produced with AI help (editing, narration, assembly). The Scripture and the
reflection are human work, not AI writing.
```

## Long form (YouTube description, blog)

```
CREDITS
Film: The JESUS Film (1979), Jesus Film Project
Scripture: Luke 18:14, Berean Standard Bible (public domain)
Reflection: adapted from J.C. Ryle, "Expository Thoughts on the Gospels: Luke"
(1858), public domain

HOW THIS WAS MADE
The verse is quoted from a real Bible translation, word for word. The
reflection is adapted from a public-domain work written by a pastor in 1858;
AI shortened and modernized his sentences, it did not invent the teaching.
The narration voice is synthetic, and the editing, captions and music are
assembled by software. Nothing in the theology is generated.
```

## Rules

- Name the translation and its year or licence, so nobody has to ask whether
  the verse was paraphrased.
- Always give the reflection's author AND the year the work was published
  (the on-screen credit does the same: "Adapted from a trusted classic ·
  J.C. Ryle, 1858").
- Say what AI did in concrete verbs (edited, voiced, assembled), never "written
  by AI" and never hide it either.
- Localized cuts translate this block; the years and the source names stay.

## Full-film link with UTM (YouTube long form, first line of the description)

Agreed with Vlad on 2026-10-16. Every long-form YouTube description opens with a
link to the full film on Watch, followed by a blank line. The link carries UTM
parameters so the team can track conversions from YouTube. Shorts don't get it,
because YouTube doesn't make links clickable in Shorts descriptions.

```
EN: Watch the full film LUMO: The Gospel of Luke: https://www.jesusfilm.org/watch/lumo-the-gospel-of-luke.html/english.html?utm_source=youtube&utm_medium=video_description&utm_campaign=daily_bible_pause_en&utm_content=<story>
RU: Весь фильм LUMO «Евангелие от Луки» на русском: https://www.jesusfilm.org/watch/lumo-the-gospel-of-luke.html/russian.html?utm_source=youtube&utm_medium=video_description&utm_campaign=daily_bible_pause_ru&utm_content=<story>
```

- `utm_campaign` carries the language: `daily_bible_pause_en` or `daily_bible_pause_ru`.
- `utm_content` is the story slug in lowercase with underscores (`paralytic`,
  `widow`, `bartimaeus_lumo`). It is the same in both languages.
- The film page must match the footage:
  - JESUS film (1979): `watch/jesus.html/<language>.html`, line "Watch the full JESUS film:" / «Весь фильм «Иисус» на русском:»
  - LUMO Matthew: `watch/lumo-the-gospel-of-matthew.html/<language>.html`
