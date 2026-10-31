# Explore clips probe (U1)

Date: 2026-09-25. Plan: `docs/plans/2026-09-24-1450-feat-mobile-explore-clips-feed-plan.md`, unit U1.
Branch: `feat/mobile-explore-clips-feed`.

This document records the U1 measurements. A desktop script ran the steps that
production data can settle (steps 3 in part, 4, 5, and 6). Steps 1, 2, and 7
need a simulator or a device, so they are "not evaluated" here. The owner runs
the device passes later.

## Summary

- `Video.moments` covers most eligible videos (78.5–88.5% per language), but
  its moments do not fit R26–R27. Only 9.2% of 991 compared moments are 10–60 s
  long, and only 6.1% start at a sentence start, end at a sentence end, and are
  10–60 s long. The moments stop condition is **cleared**.
- Only 34.5–48.5% of eligible dubbed videos can supply a sentence-cut clip. The
  main cause is not bad tracks: 49–65% of eligible videos have no subtitle track
  at all on the playing dub's Video Edition.
- The largest feature-film track has 176,418 characters. At 3 bytes per
  character, that is 0.53 MB. The recommended cap for KTD20 is 1 MB.
- The English inventory at limit 1,000 is 665 KB decoded and 173 KB with
  Brotli. The server takes about 2 s at every limit. The recommended limit for
  KTD6 is 1,000.
- A 30 s window at 480p is 4.5–5.8 MB of segments. The media playlist of a
  60–95 min video adds 291–371 KB (52–66 KB with gzip).

## Environment

| Item        | Value                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Machine     | Desktop, not a device: Apple M4 Pro, macOS 26.5.1 (arm64)                                            |
| Runtime     | Node v24.14.1 (global `fetch`), `curl` for wire sizes                                                |
| Network     | Desktop broadband in New Zealand, through Cloudflare. No throttle profile.                           |
| Data source | Production admin public GraphQL, `https://admin.jesusfilm.org/api/graphql` (no token)                |
| Media       | Production subtitle files (`api-media-core.jesusfilm.org`) and Mux HLS (`stream.mux.com`)            |
| Scripts     | Scratch scripts in `/tmp/explore-u1-probe/`, not in the repository. The methods below describe them. |

Request totals: about 455 GraphQL requests, 642 subtitle requests (430 track
reads for step 5, plus 106 HEAD and 106 GET requests for feature-film tracks),
and about 205 Mux requests. At most 4 requests were in flight at one time.

Admin allows 60 accesses per public root field per minute for each caller, and
each alias counts as one access (`rateLimitConfigByField` in
`apps/admin/src/graphql/plugins/rate-limit.ts`). The first sampling run did not
know this. It sent about 190 requests in about one minute that admin rejected
with "You are trying to access 'video' too often". The paced run then sent 5 aliases
every 5.5 s and hit the limit once.

## Step 1. iOS eager mount

**Not evaluated.** This step needs a dummy Explore tab route and a cold launch
on the iPhone simulator. The probe had no simulator run.

## Step 2. Four-player start on a low-end Android phone

**Not evaluated.** This step needs an Android phone with 3 GB of RAM or less.
The probe had no device. The Android sound rule for KTD10 (a paused root player
with sound beside a feed player with sound) is also not evaluated.

## Step 3. Bytes and loops (partial)

**Method.** For three English videos, the script read the Mux master playlist
(`https://stream.mux.com/<playbackId>.m3u8`), picked the 854x480 and 1280x720
renditions, and read each media playlist. It took a 30 s window that starts at
30% of the video, and summed the sizes of every segment that overlaps the
window. It read sizes from `HEAD` responses, and read the full segment when a
`HEAD` gave no length (a CDN cache miss). The videos have no separate audio
renditions. These numbers come from segment sizes. They are not a device
measurement.

| Video (label, length)                    | Rendition | Segments (seconds covered) | Segment bytes | Manifest bytes (decoded / gzip) | Total (decoded manifests) | Media rate |
| ---------------------------------------- | --------- | -------------------------- | ------------- | ------------------------------- | ------------------------- | ---------- |
| `the-covenant` (shortFilm, 95.5 min)     | 480p      | 7 (35 s)                   | 4.48 MB       | 370.8 KB / 67.0 KB              | 4.86 MB                   | 128 KB/s   |
| `the-covenant`                           | 720p      | 7 (35 s)                   | 9.47 MB       | 373.1 KB / 66.9 KB              | 9.84 MB                   | 271 KB/s   |
| `sermon-on-the-mount-2` (segment, 219 s) | 480p      | 6 (30 s)                   | 5.57 MB       | 16.8 KB / 4.5 KB                | 5.59 MB                   | 186 KB/s   |
| `sermon-on-the-mount-2`                  | 720p      | 6 (30 s)                   | 13.91 MB      | 16.7 KB / 4.5 KB                | 13.93 MB                  | 464 KB/s   |
| `lumo-acts-8-4-14-23` (episode, 60 min)  | 480p      | 8 (32 s)                   | 5.83 MB       | 293.9 KB / 53.3 KB              | 6.12 MB                   | 182 KB/s   |
| `lumo-acts-8-4-14-23`                    | 720p      | 8 (32 s)                   | 15.05 MB      | 293.0 KB / 53.3 KB              | 15.34 MB                  | 470 KB/s   |

Manifest bytes are the master playlist plus one media playlist. Segments are 5 s
long (4 s for the LUMO episode), so a 30 s window reads 30–35 s of media.

Findings:

- The first 480p segment is 647–852 KB. With the manifests, one segment costs
  0.87–1.09 MB. KTD23's budget of about 1 MB for a clip swiped away within 2 s
  holds only if the player reads one segment in that time.
- A long video's media playlist is large: 291–371 KB decoded, or 52–66 KB with
  gzip. Mux serves gzip when the client asks for it. The probe did not check
  which players ask for gzip.
- The 480p media rate is 1.0–1.5 Mbps. The master playlists declare 1.16–1.91
  Mbps for 480p. On the throttle profile (about 1.5 Mbps down), 480p plays at
  about real time, with no margin.

**Not evaluated:** the bytes for five loops of a 30 s window, the effect of
`useCaching` on Android, and the real player reads on iOS and Android. These
need a device.

## Step 4. Moments coverage and fit

### Languages

No per-language usage data was available to the probe, so it used inventory
size. It read `watchLanguageInventory` counts for 11 large languages and chose
the five with the largest dubbed video buckets. Two of them use non-Latin
scripts.

| Language slug            | BCP-47  | Audio videos | Audio collections | Subtitle-only videos | Chosen |
| ------------------------ | ------- | ------------ | ----------------- | -------------------- | ------ |
| `english`                | en      | 1,056        | 112               | 0                    | Yes    |
| `french`                 | fr      | 704          | 80                | 16                   | Yes    |
| `spanish-latin-american` | es      | 631          | 63                | 11                   | Yes    |
| `arabic-modern-standard` | ar      | 611          | 57                | 5                    | Yes    |
| `mandarin-china`         | zh      | 561          | 64                | 0                    | Yes    |
| `portuguese-brazil`      | pt      | 532          | 61                | 5                    | No     |
| `russian`                | ru      | 532          | 61                | 8                    | No     |
| `hindi`                  | hi      | 423          | 55                | 1                    | No     |
| `indonesian-yesus`       | id      | 330          | 47                | 2                    | No     |
| `korean`                 | ko      | 319          | 42                | 1                    | No     |
| `chinese-simplified`     | zh-hans | 88           | 33                | 142                  | No     |

### Sample

For each language, the script read the inventory with the lean selection. The
pool was the `audioVideos` rows plus the `audioCollections` rows labelled
`featureFilm` or `shortFilm`. It shuffled the pool with a seeded generator and
hydrated rows in that order, 5 per request, with `video(id:)`. A row was
eligible when `preferredPlayableDub(languageSlug: <feed slug>)` returned a dub
whose `language.slug` equals the feed slug exactly and that has a stream. The
script stopped at 200 eligible rows per language.

All 1,000 hydrated rows were eligible. No `AUDIO` row fell back to another
language. The sample has 14 collection rows (for example `jesus`,
`magdalena-2`, `book-of-acts`).

### Coverage

The query was `moments(languageSlug: <BCP-47 tag>, limit: 300)` with the start
and end only. For the four non-English languages, the same request also read
`moments(languageSlug: "en")`. When the two lists are equal, the moments came
from the English fallback. A video "has timing" when at least one moment has a
start and an end.

| Language                 | Sample | Moments with timing | Language-specific | English fallback |
| ------------------------ | ------ | ------------------- | ----------------- | ---------------- |
| `english`                | 200    | 157 (78.5%)         | n/a               | n/a              |
| `french`                 | 200    | 177 (88.5%)         | 45                | 132              |
| `spanish-latin-american` | 200    | 168 (84.0%)         | 39                | 129              |
| `arabic-modern-standard` | 200    | 168 (84.0%)         | 34                | 134              |
| `mandarin-china`         | 200    | 172 (86.0%)         | 12                | 160              |

Every video with moments had timing on every moment.

### Moment lengths

| Language                 | Videos with moments | Moments | One moment only | p10 length | p50 length | p90 length | 10–60 s moments |
| ------------------------ | ------------------- | ------- | --------------- | ---------- | ---------- | ---------- | --------------- |
| `english`                | 157                 | 357     | 86              | 69.0 s     | 162.1 s    | 278.9 s    | 23 (6.4%)       |
| `french`                 | 177                 | 377     | 107             | 61.9 s     | 144.4 s    | 258.8 s    | 35 (9.3%)       |
| `spanish-latin-american` | 168                 | 332     | 102             | 67.6 s     | 137.4 s    | 261.3 s    | 24 (7.2%)       |
| `arabic-modern-standard` | 168                 | 288     | 127             | 52.2 s     | 146.0 s    | 388.0 s    | 34 (11.8%)      |
| `mandarin-china`         | 172                 | 322     | 109             | 54.0 s     | 141.6 s    | 277.7 s    | 40 (12.4%)      |

The median sampled video is 175–221 s long, so a typical video has one moment
that covers almost all of it (the median moment covers 93–99% of its video).

### Fit with R26–R27

The script compared moments with the timing track that passed in step 5, for
every video that has both (417 videos, 991 moments). The tolerance is 1.0 s.

- **Length:** the moment is 10–60 s long.
- **Start:** the moment starts within 1.0 s of a sentence start (the first cue,
  or a cue after a cue that ends a sentence).
- **End:** the moment ends within 1.0 s of a sentence end.
- **R27 end:** from the sentence start nearest the moment start, the R27 rule
  (first sentence end followed by a pause of 1.5 s or more, at 10–60 s, else the
  last sentence end in that range) gives an end within 1.0 s of the moment end.

| Check                 | Moments that pass (of 991) |
| --------------------- | -------------------------- |
| Length 10–60 s        | 91 (9.2%)                  |
| Start                 | 665 (67.1%)                |
| End                   | 634 (64.0%)                |
| Length, start and end | 60 (6.1%)                  |
| R27 end               | 22 (2.2%)                  |

Ten real videos, two per language (the first two in sample order with two or
more moments):

| Language | Video                                           | Label        | Length (s) | Moments from | Timing track                          | Moments | Median moment (s) | 10–60 s | Start | End | All three | R27 end |
| -------- | ----------------------------------------------- | ------------ | ---------- | ------------ | ------------------------------------- | ------- | ----------------- | ------- | ----- | --- | --------- | ------- |
| en       | `the-woman-at-the-well`                         | SEGMENT      | 354        | en           | feed-language: english                | 2       | 190.3             | 0       | 1     | 2   | 0         | 0       |
| en       | `82-how-much-am-i-worth`                        | EPISODE      | 283        | en           | feed-language: english                | 3       | 127.5             | 0       | 2     | 2   | 0         | 0       |
| fr       | `jesus-speaks-to-a-samaritan-woman`             | SEGMENT      | 264        | fr           | feed-language: french                 | 2       | 230.6             | 0       | 2     | 1   | 0         | 0       |
| fr       | `wedding-day`                                   | EPISODE      | 1,642      | en fallback  | feed-language: french                 | 6       | 229.8             | 0       | 3     | 5   | 0         | 0       |
| es       | `magdalena-2`                                   | FEATURE_FILM | 3,504      | es           | feed-language: spanish-latin-american | 15      | 239.9             | 0       | 10    | 11  | 0         | 0       |
| es       | `justice-it-felt-good-punching-you-in-the-face` | EPISODE      | 648        | es           | primary: english                      | 4       | 195.9             | 0       | 2     | 3   | 0         | 0       |
| ar       | `the-dropped-stitch`                            | EPISODE      | 1,413      | en fallback  | primary: english                      | 5       | 274.1             | 0       | 3     | 5   | 0         | 0       |
| ar       | `can-the-bible-be-trusted`                      | SHORT_FILM   | 179        | en fallback  | feed-language: arabic-modern-standard | 2       | 161.0             | 1       | 1     | 2   | 0         | 0       |
| zh       | `52-do-christians-just-follow-rules`            | EPISODE      | 324        | en fallback  | primary: english                      | 3       | 125.6             | 0       | 0     | 2   | 0         | 0       |
| zh       | `handiwork`                                     | EPISODE      | 1,449      | en fallback  | primary: english                      | 6       | 245.9             | 0       | 5     | 6   | 0         | 0       |

**Result.** Moment edges often sit near sentence edges (64–67%), but moments
are 2–4 minute transcript chunks, not 10–60 s clips. No moment in the ten
videos passes all three checks. Moments cannot supply R26–R27 clips.

## Step 5. Subtitle coverage and sizes

**Method.** For each video in the step 4 sample, the script read the subtitle
list on the playing dub's Video Edition. It ordered the tracks per KTD5: the
feed-language track (exact slug match), the primary track, a human-made track
(`aiGenerated: false`), then any track. It skipped tracks with no `vttSrc`, and
in each tier it preferred a human-made track. It read the tracks in that order
until one passed.

The parser is a copy of `apps/mobile/src/lib/parseVtt.ts` with the SMPTE rule
from the plan (shift one hour when the first cue starts at or after 01:00:00
and the video is shorter than one hour). The terminators are `. ! ? …`,
`。！？`, `।॥`, `؟۔`, `။`, `።`, and `։`, and a closing quote or bracket after a
terminator still ends a sentence. A track fails when fewer than 20% of its cues
end a sentence, when its last cue ends more than 5 s after the dub's
`lengthInMilliseconds`, or when it has more than 8,000 cues. A 404 or an empty
parse also fails. No track needed the SMPTE shift.

The script also computed R26–R27 windows on each passing track: a start is the
first cue or a cue after a sentence end; the end is the first sentence end at
10–60 s that a pause of 1.5 s or more follows, else the last sentence end in
that range.

### Pass rate per language

| Language                 | Sample | No track at all | Feed-language track (exact slug) | Passing track (pass rate) | Sentence-cut window found | Pass by tier: feed / primary / human / any |
| ------------------------ | ------ | --------------- | -------------------------------- | ------------------------- | ------------------------- | ------------------------------------------ |
| `english`                | 200    | 110 (55.0%)     | 89 (44.5%)                       | 88 (44.0%)                | 87 (43.5%)                | 86 / 0 / 2 / 0                             |
| `french`                 | 200    | 98 (49.0%)      | 86 (43.0%)                       | 101 (50.5%)               | 97 (48.5%)                | 84 / 15 / 2 / 0                            |
| `spanish-latin-american` | 200    | 121 (60.5%)     | 64 (32.0%)                       | 79 (39.5%)                | 77 (38.5%)                | 61 / 17 / 1 / 0                            |
| `arabic-modern-standard` | 200    | 105 (52.5%)     | 69 (34.5%)                       | 93 (46.5%)                | 90 (45.0%)                | 26 / 66 / 1 / 0                            |
| `mandarin-china`         | 200    | 129 (64.5%)     | 0 (0.0%)                         | 70 (35.0%)                | 69 (34.5%)                | 0 / 68 / 2 / 0                             |

Failed track reads, by reason:

| Language                 | Fewer than 20% sentence ends | Last cue past the dub's length | Other |
| ------------------------ | ---------------------------- | ------------------------------ | ----- |
| `english`                | 1                            | 0                              | 0     |
| `french`                 | 1                            | 3                              | 0     |
| `spanish-latin-american` | 2                            | 1                              | 0     |
| `arabic-modern-standard` | 45                           | 1                              | 0     |
| `mandarin-china`         | 0                            | 2                              | 0     |

Notes:

- Most videos without a passing track have no track at all. That verdict comes
  from the hydration; it costs no subtitle read.
- 45 of the 69 Arabic feed-language tracks fail the 20% rule. Their cues end in
  a letter, and only questions end with `؟`; the tracks rarely use a full stop.
  The primary track (mostly English) then passes for 66 videos.
- No Mandarin video has a track with the slug `mandarin-china`. Chinese tracks
  use `chinese-simplified` (50 videos) or `chinese-traditional` (21 videos).
- On passing tracks, 95.5–96.6% of sentence starts have a valid R27 end, and
  79.2–88.6% of those ends fall at a pause of 1.5 s or more. The median clip is
  24.3–29.2 s long.

### Track sizes

| Population                                                       | Tracks | p50     | p90      | Max      |
| ---------------------------------------------------------------- | ------ | ------- | -------- | -------- |
| First track read per video (step 5 sample)                       | 436    | 2.3 KB  | 10.5 KB  | 103.1 KB |
| Passing tracks (step 5 sample)                                   | 431    | 2.3 KB  | 10.3 KB  | 95.0 KB  |
| Every track on the English dub's edition of the 12 feature films | 106    | 89.7 KB | 146.8 KB | 204.6 KB |

The largest sampled track is the Amharic track of `the-covenant` (103.1 KB,
51,121 characters). The largest feature-film track is the Lingao track of
`jesus` (204,572 bytes, 176,418 characters, 2,758 cues). No track came near
8,000 cues.

The feature-film check covered only the edition that each film's English dub
plays. `jesus` has 61 tracks there, `magdalena-director-cut` has 32, and 7 of
the 12 films have none. The two longest films (`book-of-acts`, 3.2 h, and
`life-of-jesus-gospel-of-john`, 3.1 h) have no track on that edition.

## Step 6. Inventory cost

**Method.** The query was `watchLanguageInventory(languageSlug: "english",
limit: N)` with the lean KTD6 selection on `audioCollections`, `audioVideos`,
and `subtitleOnlyVideos`: `id coreId slug label availability durationSeconds
muxPlaybackId watchLanguageSlug title description`, plus `counts`. Node `fetch`
gave the decoded bytes and the parse time. `curl` without decompression gave
the wire bytes and the time to first byte. A `{ __typename }` query gave the
baseline time to first byte (0.22–0.86 s). The projection kept the audio
videos, the collection rows labelled `featureFilm` or `shortFilm`, and the
subtitle-only rows, as compact arrays with the title.

| Limit | Rows returned (collections / audio videos / subtitle-only) | Decoded bytes | Brotli wire | gzip wire | Without `description` (Brotli) | With `imageUrl` (decoded) | Time to first byte | Pool size | Pool JSON | Parse + projection (desktop median) |
| ----- | ---------------------------------------------------------- | ------------- | ----------- | --------- | ------------------------------ | ------------------------- | ------------------ | --------- | --------- | ----------------------------------- |
| 1,000 | 112 / 1,000 / 0                                            | 665.4 KB      | 172.7 KB    | 192.2 KB  | 85.7 KB                        | 799.4 KB                  | 2.2–2.7 s          | 1,011     | 174.5 KB  | 0.73 ms                             |
| 500   | 112 / 500 / 0                                              | 389.7 KB      | 89.2 KB     | 99.4 KB   | 45.4 KB                        | 461.8 KB                  | 2.2–2.5 s          | 511       | 89.8 KB   | 0.48 ms                             |
| 250   | 112 / 250 / 0                                              | 199.4 KB      | 59.5 KB     | 61.1 KB   | 26.3 KB                        | 240.1 KB                  | 2.2–3.1 s          | 261       | 45.9 KB   | 0.21 ms                             |

The counts are 112 audio collections, 1,056 audio videos, and 0 subtitle-only
videos (1,168 in total). The parse time is a desktop proxy on an Apple M4 Pro,
not a device measurement. Step 6 on a device under the throttle profile is
still open.

Findings:

- The server takes about 2 s whatever the limit. The limit changes only the
  bytes.
- Admin caps each bucket at 1,000 rows (`WATCH_LANGUAGE_INVENTORY_MAX_ITEMS_PER_BUCKET`).
  A limit of 2,000 returns 1,000. At 1,000, the English pool leaves out 56 of
  1,056 audio videos. The other four languages fit in full.
- `description` is about half of the wire bytes.
- All 112 collection rows have `durationSeconds: null`, including the 11 film
  rows that join the pool. Hydration gives the dub's `lengthInMilliseconds`.

## Step 7. Memory soak

**Not evaluated.** This step needs 100 swipes on a prototype with two players on
a device. The probe had no device.

## Decisions

- **Moments stop condition — cleared.** `Video.moments` covers most eligible
  videos (78.5–88.5% per language), but it does not fit R26–R27. Only 9.2% of
  991 moments are 10–60 s long, 6.1% pass the length, start, and end checks,
  and 2.2% end where R27 ends. The median moment is 137–162 s, and 269 of the
  417 compared videos have one moment for the whole video. Continue to U3 with
  subtitle timing (KTD5).
- **Four-player start on a low-end Android phone — not evaluated.** The probe
  had no device with 3 GB of RAM or less.
- **Product-lead rejection — not evaluated.** A probe cannot answer it.
- **A requirement needs an admin change — not evaluated.** U1 does not test the
  requirements. The probe found no requirement that needs an admin change, but
  see the Mandarin track slugs under "Findings for later units".

## Tuning inputs

### KTD24 probe budgets

| Language                 | Pass rate | Sentence-cut rate | Failed reads (of all reads) | Failed-read bytes in 200 videos | Most failed-read bytes in any 50 videos | Hydrations per sentence-cut clip |
| ------------------------ | --------- | ----------------- | --------------------------- | ------------------------------- | --------------------------------------- | -------------------------------- |
| `english`                | 44.0%     | 43.5%             | 1 of 89                     | 1.4 KB                          | 1.4 KB                                  | 2.3                              |
| `french`                 | 50.5%     | 48.5%             | 4 of 105                    | 23.3 KB                         | 16.1 KB                                 | 2.1                              |
| `spanish-latin-american` | 39.5%     | 38.5%             | 3 of 82                     | 12.0 KB                         | 11.7 KB                                 | 2.6                              |
| `arabic-modern-standard` | 46.5%     | 45.0%             | 46 of 139                   | 430.2 KB                        | 229.5 KB                                | 2.2                              |
| `mandarin-china`         | 35.0%     | 34.5%             | 2 of 72                     | 17.4 KB                         | 17.4 KB                                 | 2.9                              |

A replay of the sample order as a feed tested the "four failures in a row"
rule:

- If a video with no track counts as a failure, the rule fires for 9.4–15.9%
  of clips, although sentence-cut candidates are still in the queue.
- If only failed track reads count, the rule never fires in any language.

Recommendation: keep four failures and 1 MB of failed reads. Count only failed
track reads toward both limits, because a video with no track costs no read.
The 1 MB budget was not reached in 200 videos in any language; Arabic came
closest with 430 KB. The real cost is hydration: 2.1–2.9 hydrations per
sentence-cut clip, against admin's limit of 60 `video` accesses per minute.

### KTD20 track byte cap

- Sample p50 2.3 KB, p90 10.5 KB, max 103.1 KB.
- Largest feature-film track: 176,418 characters. At 3 bytes per character,
  that is 529,254 bytes (0.53 MB).
- The same character density on the 3.2 h `book-of-acts` gives about 0.8 MB.

Recommendation: **1 MB**. It covers the rule's 0.53 MB and a future track on
the longest film. The 1.5 MB start value is safe but looser than the data needs.

### KTD6 inventory limit

- English at 1,000: 665.4 KB decoded, 172.7 KB Brotli, about 2 s on the server.
- English at 500: 389.7 KB decoded, 89.2 KB Brotli.
- English at 250: 199.4 KB decoded, 59.5 KB Brotli.

Recommendation: **1,000**, the server's cap. The server time does not fall with
a lower limit, and 173 KB on the wire is small. If the clip screen does not
need `description` from the pool, remove it; that halves the wire bytes.

## Findings for later units

1. `Video.moments(languageSlug:)` wants a BCP-47 tag, not a Language slug.
   `moments(languageSlug: "french")` returned the English moments of
   `jesus-speaks-to-a-samaritan-woman`; `moments(languageSlug: "fr")` returned
   French moments. For the non-English feeds, 75–93% of the videos with
   moments get them from the English fallback.
2. Mandarin tracks use the slugs `chinese-simplified` and `chinese-traditional`.
   An exact slug match on `mandarin-china` never finds a track. KTD5's first
   tier is empty for Mandarin, and R13 shows no captions in the viewer's
   language. The inventory shows the same split: `mandarin-china` has 0
   subtitle-only videos, and `chinese-simplified` has 142.
3. Arabic tracks rarely end sentences with a full stop, so most fail the 20%
   rule. Timing then comes from the primary track, which is usually English.
4. About half of eligible videos have no subtitle track on the playing dub's
   edition. The queue must hydrate 2–3 candidates for each sentence-cut clip.
5. Admin allows 60 accesses per minute to each public root field for one
   caller, and each alias counts. Three `video(id:)` aliases per hydration
   request use 3 of the 60.
6. `WatchLanguageInventoryItem` has no `videoStill`. It has `imageUrl`, which
   adds 20% to the decoded bytes.
7. Inventory `label` values are camelCase (`shortFilm`); `Video.label` values
   are enum names (`SHORT_FILM`).
8. A label does not predict length: `the-covenant` is a `shortFilm` of 95.5
   min. A "short first clip" rule must read the duration, not the label.
9. `preferredPlayableDub(languageSlug:)` matched the feed slug exactly for all
   1,000 sampled `AUDIO` rows. The exact-slug check is still needed for
   subtitle-only rows, which the probe did not sample.
