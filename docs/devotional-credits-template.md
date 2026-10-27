# Devotional credits block (captions and descriptions)

Every published devotional carries the same credits: the film, the Bible
translation and the reflection's human source with its publication year.

**No AI line in social copy (owner, 2026-10-23).** Captions and descriptions on
YouTube, Facebook and Instagram do NOT carry an AI disclaimer ("Produced with AI
help...", "HOW THIS WAS MADE", «Сделано с помощью ИИ», «КАК ЭТО СДЕЛАНО»). Lyuba
checked that the platforms do not require it for this content, and it may hurt
reach. The YouTube "altered or synthetic content" question stays **No** (no
realistic depiction of real people or events).

## Short form (Instagram, Facebook, TikTok)

```
Film: The JESUS Film, Jesus Film Project
Scripture: Berean Standard Bible (public domain)
Reflection: adapted from J.C. Ryle, Expository Thoughts on the Gospels, 1858
```

## Long form (YouTube description, blog)

```
CREDITS
Film: The JESUS Film (1979), Jesus Film Project
Scripture: Luke 18:14, Berean Standard Bible (public domain)
Reflection: adapted from J.C. Ryle, "Expository Thoughts on the Gospels: Luke"
(1858), public domain
```

## Rules

- Name the translation and its year or licence, so nobody has to ask whether
  the verse was paraphrased.
- Always give the reflection's author AND the year the work was published
  (the on-screen credit does the same: "Adapted from a trusted classic ·
  J.C. Ryle, 1858").
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

## Parallel passages line (YouTube long form, from 2026-10-22)

Lyuba's decision via Analytics, 2026-10-22. When the same story is told in
another Gospel, add one short line under the main description text (after the
📖 passage line). It helps passage searches ("matthew 20", "mark 10"). Only
passages that tell the SAME event; no thematic links, no long lists (YouTube's
misleading-metadata policy). BSB versification; Russian book names in RU.
Skip it when the story is in one Gospel only (Prodigal, Widow of Nain,
Zacchaeus, Persistent Widow, Rich Fool, Ten Lepers, Good Samaritan, Martha).

```
EN: Also in Matthew 20:29–34 and Mark 10:46–52.
RU: Эта история есть также у Матфея (20:29–34) и Марка (10:46–52).
```

## Search rules for long-form titles, descriptions and covers (from 2026-10-27)

Lyuba's decision via Analytics, 2026-10-27. Search brought 25% of EN views in
the week of Oct 20 (up from 7% lifetime), but long forms get few views because
people search the story's common name, not our hook. The content stays the
same; only the words around it change. Applies to EN and RU long forms.

1. **Find the search phrase.** Type the story name into YouTube search and take
   the most common autocomplete phrase that honestly describes our video. Skip
   phrases about songs, The Chosen, kids' cartoons or other people. Analytics
   can run this check for any story on request.
   Seen Oct 23: "woman with the issue of blood", "jairus daughter", "peter
   denies jesus 3 times", "why did peter deny jesus", "parable of the lost
   sheep", "faith of the centurion"; RU «исцеление кровоточивой женщины»,
   «иисус воскрешает дочь иаира», «отречение петра», «вера сотника»,
   «от луки 8 глава».
2. **Title** = `<search phrase + our hook> | <passage>`, with the phrase in the
   first ~40 characters (phone cut-off). If the phrase is itself a question
   ("Why did Peter deny Jesus"), the title is that question. Every word must be
   literally true to the passage, and the video must answer what the title
   asks. RU passage as «От Луки 8:43–48».
   - EN: never "devotional" in the title (search reads it as songs); never
     "The Chosen".
   - RU: never start with «Почему Пётр…» (search goes to Peter the Great);
     never «сотник» without «вера/слуга сотника».
   ```
   EN: The Woman with the Issue of Blood: Why Jesus Stopped | Luke 8:43–48
   EN: Why Did Peter Deny Jesus Three Times? | Luke 22:54–62
   EN: The Faith of the Centurion That Amazed Jesus | Luke 7:1–10
   RU: Отречение Петра: почему он отрёкся трижды | От Луки 22:54–62
   RU: Вера сотника, которой удивился Иисус | От Луки 7:1–10
   ```
3. **First two description lines** (after the full-film Watch link): the search
   phrase, other common names of the story, the passage, then the
   parallel-passages line. RU must include «Евангелие от Луки, глава N».
   Use "explained" / «толкование» only if the video actually explains the
   passage. No keyword lists.
   ```
   EN: The woman with the issue of blood (the bleeding woman in the Bible) touched the hem of Jesus' garment and was healed. A 5-minute reflection on Luke 8:43–48 with the LUMO film.
       Also in Matthew 9:20–22 and Mark 5:25–34.
   RU: Исцеление кровоточивой женщины: она коснулась края одежды Иисуса и исцелилась. Пятиминутное размышление над Евангелием от Луки, глава 8 (8:43–48), по фильму LUMO.
       Эта история есть также у Матфея (9:20–22) и Марка (5:25–34).
   ```
4. **Cover text** is for recognition, not search: 2–4 words, does not repeat
   the title, the passage label stays.
