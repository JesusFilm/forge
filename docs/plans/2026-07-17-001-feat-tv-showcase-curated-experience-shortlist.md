---
title: "TV Showcase Curated Experience - Curation Shortlist"
type: feat
date: "2026-07-17"
topic: tv-showcase-curated-experience
artifact_contract: ce-curation-shortlist/v1
status: proposed-picks-pending-owner-signoff
source_plan: docs/plans/2026-07-17-001-feat-tv-showcase-curated-experience-plan.md
---

# TV Showcase Curated Experience - Curation Shortlist

Groundwork for the `tv-showcase` curated Experience (plan U7) and for feat-263's
automated assembly (R13). Every number here is a one-off read-only snapshot of
admin's production Postgres taken **2026-07-17**; re-run the queries in
[Method](#1-method) to refresh. The catalog is live, so counts drift.

The picks in [section 5](#5-proposed-picks-pending-owner-sign-off) are **proposed
only — final picks pending owner (urim) sign-off per R12.**

---

## 1. Method

### Data source and safety

Read-only session against admin's production Postgres (`DATABASE_URL`), never the
local admin UI (KTD-8). Every session opened with:

```sql
SET default_transaction_read_only = on;
SET statement_timeout = '30s';
```

Only `SELECT` ran. Nothing was written; nothing lands in `apps/admin`.

### Eligibility filters

- **Playable dub** (the reel's playability contract, matching the shipped
  `video_dub` filter): `published = true AND hls IS NOT NULL AND hls <> '' AND
deleted_at IS NULL`. Duration comes from `video_dub.duration` (seconds,
  authoritative — never Mux).
- **Live video:** `video.deleted_at IS NULL`. All 996 videos carrying a playable
  dub also have `published_at` set, so no separate publish filter was needed.
- **English identity:** the `language` row with `slug = 'english'`
  (`id = cmokkxw5v03uyqsccis58pea6`, `bcp47 = en`). English-dub columns key on
  that `language_id`.
- **English title:** picked from `video_locale` where
  `language_slug = 'english' OR locale = 'en'`, preferring `status = 'published'`.

### Felt-need signal metric — English transcripts only

Felt needs live on `video_transcript_chunk.felt_needs` (`text[]`). The critical
data shape: **transcripts exist per language**, and a handful of flagship videos
(JESUS-film segments) carry transcripts in **~2,100 languages each**. Counting
felt-need chunks across all languages therefore inflates raw counts ~2,100x for
those few videos and buries everything else — the all-language total is 170,800
felt-need chunks, but that is dominated by mega-multilingual videos.

**Chosen basis: English transcripts only (`video_transcript_chunk.language =
'en'`).** This is the single reproducible, non-double-counted per-video signal,
it aligns with the showcase's English anchor, and it covers **641 of 667
(96%)** felt-need videos. The felt-need vocabulary is the same 12 English label
strings regardless of transcript language, so the labels stay comparable. The 26
videos with no English transcript drop out of ranking (acceptable — the
centerpiece and the office-default both anchor on English).

Per candidate video and felt need:

- `fn_chunks` — English chunks tagged with that felt need
- `total_en_chunks` — the video's total English chunks
- `share = fn_chunks / total_en_chunks` — thematic focus on that need

English transcripts are short (most videos hold 1-3 English chunks; a full
feature holds up to ~176), so `fn_chunks` is a coarse count, not a fine score —
it separates "clearly about this need" from "mentions it once," which is what a
curator shortlist needs.

### Ranking — short-form weighted

Within each felt need, candidates are ordered by:

```
ORDER BY (label IN ('segment','shortFilm','episode','trailer')) DESC,  -- short-form first
         fn_chunks DESC,                                               -- signal strength
         share DESC,                                                   -- thematic focus
         dur ASC NULLS LAST                                            -- excerpt-friendly
```

Short-form-first directly implements R2/KTD-8's "weighted toward short-form."
DB label enums are camelCase: `segment`, `shortFilm`, `episode` are the
short-form set present in the data; `featureFilm` (only 8 videos carry felt
needs) sorts last. `trailer`, `collection`, `series` never appear among
felt-need videos (they have no transcripts).

### The full ranking query

```sql
WITH en AS (
  SELECT t.video_id, c.id AS chunk_id, c.felt_needs
  FROM video_transcript t
  JOIN video_transcript_chunk c ON c.transcript_id = t.id
  WHERE c.language = 'en'
),
en_tot AS (
  SELECT video_id, count(*) AS total_en_chunks FROM en GROUP BY video_id
),
en_fn AS (
  SELECT e.video_id, fn, count(*) AS fn_chunks
  FROM en e, unnest(e.felt_needs) AS fn
  GROUP BY e.video_id, fn
),
playable AS (
  SELECT video_id,
    count(*) AS playable_dubs,
    bool_or(language_id = 'cmokkxw5v03uyqsccis58pea6') AS has_eng,
    max(duration) FILTER (WHERE language_id = 'cmokkxw5v03uyqsccis58pea6') AS eng_dur,
    max(duration) AS any_dur
  FROM video_dub
  WHERE published AND hls IS NOT NULL AND hls <> '' AND deleted_at IS NULL
  GROUP BY video_id
),
cand AS (
  SELECT f.fn, v.slug, v.core_id, v.label, v.no_index,
    p.playable_dubs, p.has_eng,
    COALESCE(p.eng_dur, p.any_dur) AS dur,
    f.fn_chunks, t.total_en_chunks,
    round(f.fn_chunks::numeric / NULLIF(t.total_en_chunks, 0), 3) AS share,
    (v.label IN ('segment','shortFilm','episode','trailer')) AS short_form,
    vl.title
  FROM en_fn f
  JOIN en_tot t ON t.video_id = f.video_id
  JOIN video v ON v.id = f.video_id AND v.deleted_at IS NULL
  JOIN playable p ON p.video_id = v.id AND p.playable_dubs >= 1
  LEFT JOIN LATERAL (
    SELECT title FROM video_locale
    WHERE video_id = v.id AND (language_slug = 'english' OR locale = 'en')
      AND deleted_at IS NULL AND title IS NOT NULL
    ORDER BY (status = 'published') DESC NULLS LAST LIMIT 1
  ) vl ON true
),
ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY fn
    ORDER BY short_form DESC, fn_chunks DESC, share DESC, dur ASC NULLS LAST
  ) AS rnk
  FROM cand
)
SELECT fn, rnk, slug, core_id, label, dur, playable_dubs, has_eng,
       fn_chunks, total_en_chunks, share, no_index, title
FROM ranked WHERE rnk <= 8 ORDER BY fn, rnk;
```

Centerpiece and stat-line queries are inlined in
[section 4](#4-centerpiece-candidates) and [section 6](#6-stat-line-inputs).

---

## 2. Extraction quality sample

The plan requires sampling extraction quality **before** trusting the tags
(Dependencies/Assumptions). Eight random English chunks were pulled for three
felt needs spanning the volume range — Fear/Power (largest), Loneliness
(mid), Security (smallest):

```sql
SELECT left(c.text, 180) AS text_snip,
       left(coalesce(c.content_summary, ''), 120) AS summary,
       array_to_string(c.felt_needs, '|') AS felt
FROM video_transcript_chunk c
WHERE c.language = 'en' AND '<FELT NEED>' = ANY(c.felt_needs)
ORDER BY random() LIMIT 8;
```

Representative hits:

- **Fear/Power** — _"Fear has a nasty habit of getting in the way. It can hold
  you back from pursuing your dreams..."_ (`Fear/Power|Love|Security`); a chunk
  on Jesus performing miracles; _"...the effect of sin in using power and
  influence over others..."_ (`Fear/Power|Guilt/Righteousness|Hope|Love|Significance`).
- **Loneliness** — _"I felt like God abandoned me. That he left me completely on
  my own..."_ (`Loneliness`); _"...comparing myself to others. I was really
  struggling with who I was..."_ (`Hope|Loneliness`).
- **Security** — _"I kept them safe by the power of your name... not one of them
  was lost..."_ (`Acceptance|Fear/Power|Guilt/Righteousness|Security`); _"...find
  a safe place to hide you in. I know a real safe place..."_
  (`Security|Significance`).

**Verdict: the extractions are sane and usable.** Every sampled tag was
on-theme, multi-tagging is coherent (a chunk about fear-and-rescue legitimately
carries both `Fear/Power` and `Security`), and no obvious mislabels appeared.
Two caveats recorded for feat-263, neither blocking:

1. **`content_summary` is not a summary** — it mirrors the leading ~120
   characters of `text` verbatim in every sampled row. Treat it as a text
   preview, not a distilled summary.
2. **English transcripts are short**, so per-video felt-need counts are small
   (mostly 1-3). Fine for a shortlist; feat-263 may want the multi-language
   corpus with per-language de-duplication rather than English-only.

---

## 3. Ranked candidates per felt need

All 12 extraction values have **8+ eligible candidates each — none are empty.**
Top 8 per need shown (query returns more). `dur` is the English dub duration in
seconds (`s`); `dubs` is playable-dub count; `eng` = English dub playable;
`chunks` = `fn_chunks / total_en_chunks`; `share` = thematic focus. All rows had
`no_index = false`.

### Fear/Power (73,767 all-lang chunk-hits — strongest need)

| #   | slug                              | core_id                | label   | dur (s) | dubs | eng | chunks | share | title                               |
| --- | --------------------------------- | ---------------------- | ------- | ------- | ---- | --- | ------ | ----- | ----------------------------------- |
| 1   | growing-in-christ                 | 1_wjv_05-0-0           | episode | 1757    | 123  | yes | 20/24  | 0.833 | Growing In Christ                   |
| 2   | 82-how-much-am-i-worth            | 7_0-nfs0802            | episode | 283     | 18   | yes | 15/15  | 1.000 | 8.2 How Much Am I Worth?            |
| 3   | 83-what-holds-us-captive          | 7_0-nfs0803            | episode | 436     | 18   | yes | 15/20  | 0.750 | 8.3 What Holds Us Captive?          |
| 4   | bp-4-divine-council               | 11_SpiritualBeings0804 | episode | 380     | 18   | yes | 12/12  | 1.000 | 4. Divine Council                   |
| 5   | 33-do-the-facts-stack-up          | 7_0-nfs0303            | episode | 287     | 18   | yes | 10/15  | 0.667 | 3.3 Do The Facts Stack Up?          |
| 6   | 12-is-god-in-the-details          | 7_0-nfs0102            | episode | 287     | 18   | yes | 10/15  | 0.667 | 1.2 Is God in the Details?          |
| 7   | 23-why-should-i-believe-the-bible | 7_0-nfs0203            | episode | 302     | 18   | yes | 10/15  | 0.667 | 2.3 Why Should I Believe the Bible? |
| 8   | bp-8-new-humanity                 | 11_SpiritualBeings0808 | episode | 308     | 18   | yes | 9/9    | 1.000 | 8. The New Humanity                 |

### Forgiveness (70,491)

| #   | slug                                          | core_id      | label     | dur (s) | dubs | eng | chunks | share | title                                            |
| --- | --------------------------------------------- | ------------ | --------- | ------- | ---- | --- | ------ | ----- | ------------------------------------------------ |
| 1   | 52-do-christians-just-follow-rules            | 7_0-nfs0502  | episode   | 322     | 18   | yes | 15/15  | 1.000 | 5.2 Do Christians Just Follow Rules?             |
| 2   | are-you-ready-to-take-the-next-step-episode-9 | 7_0-nfs09    | shortFilm | 185     | 18   | yes | 10/10  | 1.000 | Are You Ready to Take The Next Step? (Episode 9) |
| 3   | 81-can-jesus-affect-my-life                   | 7_0-nfs0801  | episode   | 285     | 18   | yes | 10/15  | 0.667 | 8.1 Can Jesus Affect My Life?                    |
| 4   | assurance-of-salvation                        | 1_wjv_01-0-0 | episode   | 1466    | 123  | yes | 10/15  | 0.667 | Assurance Of Salvation                           |
| 5   | how-can-i-tell-others-episode-10              | 7_0-nfs10    | shortFilm | 501     | 18   | yes | 10/25  | 0.400 | How Can I Tell Others? (Episode 10)              |
| 6   | 63-will-it-all-be-worth-it                    | 7_0-nfs0603  | episode   | 303     | 18   | yes | 8/12   | 0.667 | 6.3 Will It All Be Worth It?                     |
| 7   | living-as-a-disciple-of-jesus                 | 1_fj_4-0-0   | episode   | 1202    | 22   | yes | 6/16   | 0.375 | Living as a Disciple of Jesus                    |
| 8   | invitation-to-know-jesus-personally           | 1_jf6161-0-0 | segment   | 341     | 2261 | yes | 5/6    | 0.833 | Invitation to Know Jesus Personally              |

### Love (57,231)

| #   | slug                               | core_id     | label   | dur (s) | dubs | eng | chunks | share | title                                |
| --- | ---------------------------------- | ----------- | ------- | ------- | ---- | --- | ------ | ----- | ------------------------------------ |
| 1   | 13-what-does-this-life-mean        | 7_0-nfs0103 | episode | 286     | 18   | yes | 15/15  | 1.000 | 1.3 What Does This Life Mean?        |
| 2   | 52-do-christians-just-follow-rules | 7_0-nfs0502 | episode | 322     | 18   | yes | 15/15  | 1.000 | 5.2 Do Christians Just Follow Rules? |
| 3   | prayer-talking-to-god              | 1_fj_3-0-0  | episode | 1130    | 22   | yes | 10/14  | 0.714 | Prayer, Talking to God               |
| 4   | 51-what-is-authentic-faith         | 7_0-nfs0501 | episode | 282     | 18   | yes | 10/15  | 0.667 | 5.1 What is Authentic Faith?         |
| 5   | 81-can-jesus-affect-my-life        | 7_0-nfs0801 | episode | 285     | 18   | yes | 10/15  | 0.667 | 8.1 Can Jesus Affect My Life?        |
| 6   | 73-can-i-belong-in-church          | 7_0-nfs0703 | episode | 289     | 18   | yes | 10/15  | 0.667 | 7.3 Can I Belong In Church?          |
| 7   | 62-why-did-it-happen-to-me         | 7_0-nfs0602 | episode | 321     | 18   | yes | 10/15  | 0.667 | 6.2 Why Did It Happen to Me?         |
| 8   | 43-is-it-ok-to-doubt               | 7_0-nfs0403 | episode | 323     | 17   | yes | 10/15  | 0.667 | 4.3 Is It OK To Doubt?               |

### Guilt/Righteousness (49,404)

| #   | slug                                          | core_id                   | label     | dur (s) | dubs | eng | chunks | share | title                                            |
| --- | --------------------------------------------- | ------------------------- | --------- | ------- | ---- | --- | ------ | ----- | ------------------------------------------------ |
| 1   | 41-what-was-jesus-really-like                 | 7_0-nfs0401               | episode   | 308     | 18   | yes | 15/15  | 1.000 | 4.1 What Was Jesus Really Like?                  |
| 2   | 83-what-holds-us-captive                      | 7_0-nfs0803               | episode   | 436     | 18   | yes | 15/20  | 0.750 | 8.3 What Holds Us Captive?                       |
| 3   | are-you-ready-to-take-the-next-step-episode-9 | 7_0-nfs09                 | shortFilm | 185     | 18   | yes | 10/10  | 1.000 | Are You Ready to Take The Next Step? (Episode 9) |
| 4   | 71-why-are-churches-so-messed-up              | 7_0-nfs0701               | episode   | 255     | 18   | yes | 10/15  | 0.667 | 7.1 Why Are Churches So Messed Up?               |
| 5   | 81-can-jesus-affect-my-life                   | 7_0-nfs0801               | episode   | 285     | 18   | yes | 10/15  | 0.667 | 8.1 Can Jesus Affect My Life?                    |
| 6   | growing-in-christ                             | 1_wjv_05-0-0              | episode   | 1757    | 123  | yes | 10/24  | 0.417 | Growing In Christ                                |
| 7   | dont-hold-your-breath                         | 2_0-Dont-Hold-Your-Breath | shortFilm | 936     | 2    | yes | 7/7    | 1.000 | Don't Hold Your Breath                           |
| 8   | origins-of-christmas--episode-1               | 7_0-ncs01                 | episode   | 506     | 2    | yes | 6/8    | 0.750 | Origins of Christmas - (Episode 1)               |

### Significance (48,746)

| #   | slug                                          | core_id                | label     | dur (s) | dubs | eng | chunks | share | title                                            |
| --- | --------------------------------------------- | ---------------------- | --------- | ------- | ---- | --- | ------ | ----- | ------------------------------------------------ |
| 1   | 83-what-holds-us-captive                      | 7_0-nfs0803            | episode   | 436     | 18   | yes | 20/20  | 1.000 | 8.3 What Holds Us Captive?                       |
| 2   | 63-will-it-all-be-worth-it                    | 7_0-nfs0603            | episode   | 303     | 18   | yes | 12/12  | 1.000 | 6.3 Will It All Be Worth It?                     |
| 3   | bp-1-god                                      | 11_SpiritualBeings0801 | episode   | 490     | 17   | yes | 12/15  | 0.800 | 1. God                                           |
| 4   | are-you-ready-to-take-the-next-step-episode-9 | 7_0-nfs09              | shortFilm | 185     | 18   | yes | 10/10  | 1.000 | Are You Ready to Take The Next Step? (Episode 9) |
| 5   | 12-is-god-in-the-details                      | 7_0-nfs0102            | episode   | 287     | 18   | yes | 10/15  | 0.667 | 1.2 Is God in the Details?                       |
| 6   | 73-can-i-belong-in-church                     | 7_0-nfs0703            | episode   | 289     | 18   | yes | 10/15  | 0.667 | 7.3 Can I Belong In Church?                      |
| 7   | 23-why-should-i-believe-the-bible             | 7_0-nfs0203            | episode   | 302     | 18   | yes | 10/15  | 0.667 | 2.3 Why Should I Believe the Bible?              |
| 8   | 22-how-can-i-trust-what-the-bible-says        | 7_0-nfs0202            | episode   | 311     | 18   | yes | 10/15  | 0.667 | 2.2 How Can I Trust What the Bible Says?         |

### Hope (27,251)

| #   | slug                                   | core_id     | label     | dur (s) | dubs | eng | chunks | share | title                                    |
| --- | -------------------------------------- | ----------- | --------- | ------- | ---- | --- | ------ | ----- | ---------------------------------------- |
| 1   | how-can-i-tell-others-episode-10       | 7_0-nfs10   | shortFilm | 501     | 18   | yes | 20/25  | 0.800 | How Can I Tell Others? (Episode 10)      |
| 2   | 63-will-it-all-be-worth-it             | 7_0-nfs0603 | episode   | 303     | 18   | yes | 12/12  | 1.000 | 6.3 Will It All Be Worth It?             |
| 3   | who-is-god                             | 1_fj_1-0-0  | episode   | 1079    | 22   | yes | 12/12  | 1.000 | Who Is God?                              |
| 4   | 61-where-was-god                       | 7_0-nfs0601 | episode   | 282     | 18   | yes | 10/15  | 0.667 | 6.1 Where Was God?                       |
| 5   | 73-can-i-belong-in-church              | 7_0-nfs0703 | episode   | 289     | 18   | yes | 10/15  | 0.667 | 7.3 Can I Belong In Church?              |
| 6   | 22-how-can-i-trust-what-the-bible-says | 7_0-nfs0202 | episode   | 311     | 18   | yes | 10/15  | 0.667 | 2.2 How Can I Trust What the Bible Says? |
| 7   | 62-why-did-it-happen-to-me             | 7_0-nfs0602 | episode   | 321     | 18   | yes | 10/15  | 0.667 | 6.2 Why Did It Happen to Me?             |
| 8   | 43-is-it-ok-to-doubt                   | 7_0-nfs0403 | episode   | 323     | 17   | yes | 10/15  | 0.667 | 4.3 Is It OK To Doubt?                   |

### Acceptance (22,040)

| #   | slug                        | core_id      | label   | dur (s) | dubs | eng | chunks | share | title                         |
| --- | --------------------------- | ------------ | ------- | ------- | ---- | --- | ------ | ----- | ----------------------------- |
| 1   | assurance-of-salvation      | 1_wjv_01-0-0 | episode | 1466    | 123  | yes | 13/15  | 0.867 | Assurance Of Salvation        |
| 2   | 21-was-jesus-the-real-deal  | 7_0-nfs0201  | episode | 330     | 18   | yes | 10/15  | 0.667 | 2.1 Was Jesus the Real Deal?  |
| 3   | 83-what-holds-us-captive    | 7_0-nfs0803  | episode | 436     | 18   | yes | 10/20  | 0.500 | 8.3 What Holds Us Captive?    |
| 4   | walking-in-the-spirit       | 1_wjv_04-0-0 | episode | 1466    | 123  | yes | 10/20  | 0.500 | Walking In The Spirit         |
| 5   | growing-in-christ           | 1_wjv_05-0-0 | episode | 1757    | 123  | yes | 10/24  | 0.417 | Growing In Christ             |
| 6   | fellowship-of-believers     | 1_wjv_02-0-0 | episode | 1536    | 123  | yes | 8/18   | 0.444 | Fellowship Of Believers       |
| 7   | 81-can-jesus-affect-my-life | 7_0-nfs0801  | episode | 285     | 18   | yes | 5/15   | 0.333 | 8.1 Can Jesus Affect My Life? |
| 8   | 32-what-happened-next       | 7_0-nfs0302  | episode | 288     | 14   | yes | 5/15   | 0.333 | 3.2 What Happened Next?       |

### Loneliness (14,061)

| #   | slug                                   | core_id                | label     | dur (s) | dubs | eng | chunks | share | title                                    |
| --- | -------------------------------------- | ---------------------- | --------- | ------- | ---- | --- | ------ | ----- | ---------------------------------------- |
| 1   | 61-where-was-god                       | 7_0-nfs0601            | episode   | 282     | 18   | yes | 10/15  | 0.667 | 6.1 Where Was God?                       |
| 2   | 83-what-holds-us-captive               | 7_0-nfs0803            | episode   | 436     | 18   | yes | 10/20  | 0.500 | 8.3 What Holds Us Captive?               |
| 3   | living-as-a-disciple-of-jesus          | 1_fj_4-0-0             | episode   | 1202    | 22   | yes | 6/16   | 0.375 | Living as a Disciple of Jesus            |
| 4   | vr-missionary-extended-version         | 2_VirtualMissionaryExt | shortFilm | 676     | 1    | yes | 5/6    | 0.833 | VR Missionary (Extended Version)         |
| 5   | 81-can-jesus-affect-my-life            | 7_0-nfs0801            | episode   | 285     | 18   | yes | 5/15   | 0.333 | 8.1 Can Jesus Affect My Life?            |
| 6   | 33-do-the-facts-stack-up               | 7_0-nfs0303            | episode   | 287     | 18   | yes | 5/15   | 0.333 | 3.3 Do The Facts Stack Up?               |
| 7   | 22-how-can-i-trust-what-the-bible-says | 7_0-nfs0202            | episode   | 311     | 18   | yes | 5/15   | 0.333 | 2.2 How Can I Trust What the Bible Says? |
| 8   | coffee-shop                            | 2_0-Coffee-Shop        | shortFilm | 613     | 2    | yes | 4/6    | 0.667 | Coffee Shop                              |

### Anxiety (11,669)

| #   | slug                                | core_id        | label     | dur (s) | dubs | eng | chunks | share | title                                  |
| --- | ----------------------------------- | -------------- | --------- | ------- | ---- | --- | ------ | ----- | -------------------------------------- |
| 1   | growing-in-christ                   | 1_wjv_05-0-0   | episode   | 1757    | 123  | yes | 10/24  | 0.417 | Growing In Christ                      |
| 2   | prayer-talking-to-god               | 1_fj_3-0-0     | episode   | 1130    | 22   | yes | 6/14   | 0.429 | Prayer, Talking to God                 |
| 3   | assurance-of-salvation              | 1_wjv_01-0-0   | episode   | 1466    | 123  | yes | 6/15   | 0.400 | Assurance Of Salvation                 |
| 4   | 82-how-much-am-i-worth              | 7_0-nfs0802    | episode   | 283     | 18   | yes | 5/15   | 0.333 | 8.2 How Much Am I Worth?               |
| 5   | the-meaning-of-christmas--episode-3 | 7_0-ncs03      | episode   | 420     | 2    | yes | 4/8    | 0.500 | The Meaning of Christmas - (Episode 3) |
| 6   | brothers                            | 2_0-Brothers   | shortFilm | 480     | 15   | yes | 4/8    | 0.500 | Brothers                               |
| 7   | the-unexpected-christmas--episode-2 | 7_0-ncs02      | episode   | 555     | 2    | yes | 4/10   | 0.400 | The Unexpected Christmas - (Episode 2) |
| 8   | teaching-about-prayer-and-faith-2   | 1_wl604421-0-0 | segment   | 134     | 246  | yes | 2/2    | 1.000 | Teaching About Prayer and Faith        |

### Honor/Shame (6,822)

| #   | slug                        | core_id                | label     | dur (s) | dubs | eng | chunks | share | title                         |
| --- | --------------------------- | ---------------------- | --------- | ------- | ---- | --- | ------ | ----- | ----------------------------- |
| 1   | 81-can-jesus-affect-my-life | 7_0-nfs0801            | episode   | 285     | 18   | yes | 15/15  | 1.000 | 8.1 Can Jesus Affect My Life? |
| 2   | yhwh-lord                   | 11_Shema0206           | episode   | 221     | 19   | yes | 6/9    | 0.667 | YHWH / LORD                   |
| 3   | god-rescue-plan             | 2_0-GodsRescuePlan     | shortFilm | 177     | 30   | yes | 4/4    | 1.000 | God's Rescue Plan             |
| 4   | sharing-the-news            | 1_riv_12-0-0           | episode   | 1507    | 39   | yes | 4/7    | 0.571 | Sharing the News              |
| 5   | tümlükden-nura              | 2_0-Tumlukden          | shortFilm | 801     | 8    | yes | 4/12   | 0.333 | Tümlükden Nura                |
| 6   | who-is-god                  | 1_fj_1-0-0             | episode   | 1079    | 22   | yes | 4/12   | 0.333 | Who Is God?                   |
| 7   | meod-strength               | 11_Shema0606           | episode   | 257     | 19   | yes | 3/9    | 0.333 | Meod / Strength               |
| 8   | bp-4-divine-council         | 11_SpiritualBeings0804 | episode   | 380     | 18   | yes | 3/12   | 0.250 | 4. Divine Council             |

### Depression (2,160 — weak signal)

| #   | slug                      | core_id           | label     | dur (s) | dubs | eng | chunks | share | title                       |
| --- | ------------------------- | ----------------- | --------- | ------- | ---- | --- | ------ | ----- | --------------------------- |
| 1   | yakhal-hope               | 11_Advent0104     | episode   | 255     | 41   | yes | 6/9    | 0.667 | Yakhal / Hope               |
| 2   | chara-joy                 | 11_Advent0304     | episode   | 253     | 41   | yes | 3/9    | 0.333 | Chara / Joy                 |
| 3   | mary-recalls-simeon-words | 1_wl604435-0-0    | segment   | 48      | 246  | yes | 2/2    | 1.000 | Mary Recalls Simeon's Words |
| 4   | simeon-prophecy           | 1_wl604411-0-0    | segment   | 64      | 246  | yes | 2/2    | 1.000 | Simeon's Prophecy           |
| 5   | 10-church                 | 8_NBC10           | episode   | 100     | 42   | yes | 2/2    | 1.000 | 10. Church                  |
| 6   | burial-of-jesus-2         | 1_wl604438-0-0    | segment   | 141     | 246  | yes | 2/2    | 1.000 | Burial of Jesus             |
| 7   | song-of-the-reeds         | 2_0-SongOfReeds   | shortFilm | 179     | 8    | yes | 2/2    | 1.000 | Song of the Reeds           |
| 8   | the-four-perfect-love     | 2_FourPerfectLove | shortFilm | 237     | 2    | yes | 2/2    | 1.000 | A Perfect Love              |

### Security (1,139 — weakest signal)

| #   | slug                     | core_id             | label     | dur (s) | dubs | eng | chunks | share | title                      |
| --- | ------------------------ | ------------------- | --------- | ------- | ---- | --- | ------ | ----- | -------------------------- |
| 1   | 83-what-holds-us-captive | 7_0-nfs0803         | episode   | 436     | 18   | yes | 5/20   | 0.250 | 8.3 What Holds Us Captive? |
| 2   | who-is-god               | 1_fj_1-0-0          | episode   | 1079    | 22   | yes | 4/12   | 0.333 | Who Is God?                |
| 3   | growing-in-christ        | 1_wjv_05-0-0        | episode   | 1757    | 123  | yes | 4/24   | 0.167 | Growing In Christ          |
| 4   | 6-being-made-new         | 8_NBC06             | episode   | 79      | 42   | yes | 2/2    | 1.000 | 6. Being Made New          |
| 5   | prayer-for-the-games     | 4_PrayerForOlympics | shortFilm | 99      | 3    | yes | 2/2    | 1.000 | Prayer for The Games       |
| 6   | 7-living-for-god         | 8_NBC07             | episode   | 101     | 42   | yes | 2/2    | 1.000 | 7. Living for God          |
| 7   | born-to-play             | 2_0-BornToPlay      | shortFilm | 132     | 14   | yes | 2/2    | 1.000 | Born to Play               |
| 8   | episode-6                | 2_FileZero06-0-0    | episode   | 166     | 13   | yes | 2/2    | 1.000 | Episode 6                  |

---

## 4. Centerpiece candidates

R4 requires the language-chapter centerpiece to have **≥ 9 playable dubs
including English** and enough runtime for the extended ~90s hop window plus a
~5s credits tail (so `dur ≥ ~120s` is the safe bar). Query — all videos, not
just felt-need ones:

```sql
WITH playable AS (
  SELECT video_id,
    count(*) AS playable_dubs,
    bool_or(language_id = 'cmokkxw5v03uyqsccis58pea6') AS has_eng,
    max(duration) FILTER (WHERE language_id = 'cmokkxw5v03uyqsccis58pea6') AS eng_dur
  FROM video_dub
  WHERE published AND hls IS NOT NULL AND hls <> '' AND deleted_at IS NULL
  GROUP BY video_id
)
SELECT v.slug, v.core_id, v.label, p.playable_dubs, p.eng_dur, v.no_index
FROM playable p
JOIN video v ON v.id = p.video_id AND v.deleted_at IS NULL
WHERE p.has_eng AND p.eng_dur >= 120
ORDER BY p.playable_dubs DESC LIMIT 15;
```

The catalog is spectacularly deep here: JESUS-film segments each carry **2,264
playable dubs**. Top 10 (all `no_index = false`, all English playable):

| #   | slug                                          | core_id      | label       | playable dubs | eng dur         | title                                         |
| --- | --------------------------------------------- | ------------ | ----------- | ------------- | --------------- | --------------------------------------------- |
| 1   | jesus                                         | 1_jf-0-0     | featureFilm | 2281          | 7674s (2:07:54) | JESUS                                         |
| 2   | jesus-feeds-5000                              | 1_jf6121-0-0 | segment     | 2264          | 150s (2:30)     | Jesus Feeds 5,000                             |
| 3   | jesus-proclaims-fulfillment-of-the-scriptures | 1_jf6106-0-0 | segment     | 2264          | 187s (3:07)     | Jesus Proclaims Fulfillment of the Scriptures |
| 4   | sinful-woman-forgiven                         | 1_jf6114-0-0 | segment     | 2264          | 177s (2:57)     | Sinful Woman Forgiven                         |
| 5   | healing-of-the-demoniac                       | 1_jf6120-0-0 | segment     | 2264          | 136s (2:16)     | Healing of the Demoniac                       |
| 6   | baptism-of-jesus-by-john                      | 1_jf6104-0-0 | segment     | 2264          | 227s (3:47)     | Baptism of Jesus by John                      |
| 7   | jairus-daughter-brought-back-to-life          | 1_jf6109-0-0 | segment     | 2264          | 135s (2:15)     | Jairus's Daughter Brought Back to Life        |
| 8   | miraculous-catch-of-fish                      | 1_jf6108-0-0 | segment     | 2264          | 121s (2:01)     | Miraculous Catch of Fish                      |
| 9   | disciples-chosen                              | 1_jf6110-0-0 | segment     | 2264          | 191s (3:11)     | Disciples Chosen                              |
| 10  | sermon-on-the-mount-2                         | 1_jf6112-0-0 | segment     | 2264          | 219s (3:39)     | Sermon on the Mount                           |
| —   | birth-of-jesus                                | 1_jf6102-0-0 | segment     | 2264          | 223s (3:43)     | Birth of Jesus                                |
| —   | the-devil-tempts-jesus                        | 1_jf6105-0-0 | segment     | 2264          | 142s (2:22)     | The Devil Tempts Jesus                        |

`birth-of-jesus` and `the-devil-tempts-jesus` are included below the top 10
because they are strong editorial candidates (both 2,264 dubs).

**Any JESUS-film segment satisfies R4 with enormous headroom** — 2,264 dubs is
~250x the 9-dub floor, and the ~120-227s runtimes clear the 90s + 5s window
(excerpt starts ~15% in for long-form, so a 223s segment ends its hop window near
~120s, well before its own tail). The full `jesus` feature (2,281 dubs, 128 min)
also qualifies but is an unwieldy single asset; a self-contained segment is
cleaner for the extended excerpt.

---

## 5. Proposed picks — pending owner sign-off

**Proposed only — final picks pending owner (urim) sign-off per R12.** This is a
13-chapter skeleton: all 12 felt-need chapters (3 excerpts each) plus one
language chapter with the centerpiece. Constraints honored: the centerpiece is
**not** double-booked as an ordinary pick; **no video repeats across chapters**
(36 distinct ordinary videos + 1 centerpiece); short-form and visual variety are
preferred. This lands the loop in the 20-35 minute band's lower-middle (~12
chapters × 3 × ~30s excerpts + cards + interstitials + ~90s centerpiece).

### Reel order and picks

Reel order interleaves the strongest needs early and mixes tone. Each chapter's
`title` is the felt-need name (curator may soften wording); `subtitle` is
optional curator free text.

| #   | Chapter (felt need)        | Pick 1                              | Pick 2                                        | Pick 3                                 |
| --- | -------------------------- | ----------------------------------- | --------------------------------------------- | -------------------------------------- |
| 1   | Fear/Power                 | 82-how-much-am-i-worth              | bp-4-divine-council                           | 33-do-the-facts-stack-up               |
| 2   | Forgiveness                | 52-do-christians-just-follow-rules  | are-you-ready-to-take-the-next-step-episode-9 | invitation-to-know-jesus-personally    |
| 3   | Love                       | 13-what-does-this-life-mean         | 51-what-is-authentic-faith                    | 62-why-did-it-happen-to-me             |
| 4   | Loneliness                 | 61-where-was-god                    | coffee-shop                                   | living-as-a-disciple-of-jesus          |
| 5   | Hope                       | how-can-i-tell-others-episode-10    | 43-is-it-ok-to-doubt                          | 22-how-can-i-trust-what-the-bible-says |
| 6   | Guilt/Righteousness        | 41-what-was-jesus-really-like       | 71-why-are-churches-so-messed-up              | dont-hold-your-breath                  |
| 7   | Significance               | 83-what-holds-us-captive            | bp-1-god                                      | 63-will-it-all-be-worth-it             |
| 8   | Acceptance                 | assurance-of-salvation              | 21-was-jesus-the-real-deal                    | 32-what-happened-next                  |
| 9   | Anxiety                    | brothers                            | prayer-talking-to-god                         | the-meaning-of-christmas--episode-3    |
| 10  | Honor/Shame                | 81-can-jesus-affect-my-life         | god-rescue-plan                               | yhwh-lord                              |
| 11  | Depression                 | yakhal-hope                         | chara-joy                                     | song-of-the-reeds                      |
| 12  | Security                   | who-is-god                          | born-to-play                                  | prayer-for-the-games                   |
| L   | **Language** (centerpiece) | **birth-of-jesus** _(1_jf6102-0-0)_ | —                                             | —                                      |

### Language chapter (the centerpiece chapter)

- **Centerpiece: `birth-of-jesus`** (`1_jf6102-0-0`), segment, **2,264 playable
  dubs including English**, **223s (3:43)**.
- Rationale: universally recognizable, visually rich (nativity), abundant
  headroom over the 9-dub floor and the 90s window. Marked with
  `categoryLabel: showcase-languages` (KTD-7); `subtitle` states the
  language-count claim (e.g., "Now told in {N} languages").
- **Alternates** (any qualifies; all 2,264 dubs): `sermon-on-the-mount-2`
  (219s), `baptism-of-jesus-by-john` (227s), `jesus-proclaims-fulfillment-of-the-scriptures`
  (187s).

### Curator notes

- **Excerpt windows:** short-form picks (177-555s) suit the 20-40s window
  starting near the top; long-form picks (`growing-in-christ`, `who-is-god`,
  `prayer-talking-to-god`, `living-as-a-disciple-of-jesus`, `dont-hold-your-breath`,
  1000-1757s) take the ~15%-in start. Verify each excerpt lands on visually
  strong footage before locking (R2).
- **Single-dub caveat:** a couple of high-share short films have thin dub
  coverage (`coffee-shop` 2 dubs, `vr-missionary-extended-version` 1 dub). Their
  ordinary excerpts fall back to English when the viewer's language has no dub
  (R6) — acceptable, but the curator may prefer swapping in an 18-dub `nfs`
  episode for broader viewer-language coverage.
- **Christmas material** (`the-meaning-of-christmas--episode-3`,
  `origins-of-christmas--episode-1`) is thin on dubs (2 each) but seasonally
  strong; keep as swap options.

---

## 6. Stat-line inputs found in data

**Database-derived; ministry-official numbers to be confirmed by curator (R5).**
These are what the DB can source for the `showcase-stats` section. The
authoritative ministry figures (e.g. the "50-60 felt needs" and total-catalog
claims) differ and are a curator task.

| Stat                                     | Value (2026-07-17) | Note                                |
| ---------------------------------------- | ------------------ | ----------------------------------- |
| Videos with ≥ 1 playable dub             | **996**            | all are published                   |
| Total playable dubs (audio tracks)       | **175,126**        | across all videos                   |
| Distinct audio languages (playable dubs) | **2,300**          | `distinct language_id`              |
| Distinct subtitle languages              | **99**             | `video_subtitle`, non-empty vtt/srt |
| Felt-need extraction categories          | **12**             | the extraction vocabulary size      |

Query:

```sql
SELECT
  (SELECT count(DISTINCT d.video_id) FROM video_dub d
     WHERE d.published AND d.hls IS NOT NULL AND d.hls <> '' AND d.deleted_at IS NULL)
    AS videos_with_playable_dub,
  (SELECT count(*) FROM video_dub d
     WHERE d.published AND d.hls IS NOT NULL AND d.hls <> '' AND d.deleted_at IS NULL)
    AS total_playable_dubs,
  (SELECT count(DISTINCT d.language_id) FROM video_dub d
     WHERE d.published AND d.hls IS NOT NULL AND d.hls <> '' AND d.deleted_at IS NULL
       AND d.language_id IS NOT NULL)
    AS distinct_audio_languages,
  (SELECT count(DISTINCT s.language_id) FROM video_subtitle s
     WHERE s.deleted_at IS NULL
       AND ((s.vtt_src IS NOT NULL AND s.vtt_src <> '') OR (s.srt_src IS NOT NULL AND s.srt_src <> ''))
       AND s.language_id IS NOT NULL)
    AS distinct_subtitle_languages,
  (SELECT count(*) FROM (SELECT DISTINCT unnest(felt_needs)
     FROM video_transcript_chunk WHERE felt_needs <> '{}') z)
    AS felt_need_categories;
```

**Curator guidance for R5:**

- The **12 extraction categories** are _not_ the "50-60 felt needs" ministry
  claim — they are the internal search-extraction vocabulary. The stat card's
  felt-need number must come from the ministry-official source, not this DB.
- The catalog-size claim JFP publishes (e.g. "2,000+ titles") differs from the
  996 "videos with a playable dub" here; pick the number that matches the claim's
  intent and cite its source.
- Audio-language (2,300) and subtitle-language (99) counts are solid,
  DB-authoritative starting points but should still be confirmed against the
  ministry's published figures before appearing on-screen.

---

## Anomalies and risks surfaced

1. **Mega-multilingual double-counting (handled).** A few flagship videos carry
   transcripts in ~2,100 languages (`video_transcript.language` has 2,127
   distinct values; the top videos have 2,098-2,116), which is why all-language
   felt-need chunk totals reach 170,800. The English-only basis neutralizes this;
   feat-263 must apply the same per-language de-duplication or it will rank
   JESUS-film segments into every need.
2. **`content_summary` is a text preview, not a summary** — it mirrors the
   leading chunk text. Don't build feat-263 UI expecting a distilled summary
   there.
3. **English transcripts are short** (mostly 1-3 chunks/video), making
   `fn_chunks` coarse. Adequate for a shortlist; a finer feat-263 score may need
   the multi-language corpus.
4. **Depression (2,160) and Security (1,139) are the weakest needs** — candidates
   lean on tiny 2/2-chunk segments with `share = 1.0` that are technically
   "100% about the need" only because their English transcript is two chunks
   long. Their picks are the least defensible; the curator should eyeball these
   two chapters hardest, or consider dropping them to stay within 10 strong
   chapters if the excerpts don't land.
5. **`nfs` series dominance.** The "New Faith" series (`7_0-nfs*`, ~5-min
   episodes, 17-18 dubs) supplies most top candidates across needs. Within a
   chapter the viewer sees variety; across the reel the visual identity may feel
   repetitive. Short-film and JESUS-film picks were interleaved to counter this.
