# Daily Bible Pause content calendar

A month view of every post on YouTube (English and Russian channels), Facebook
and Instagram, published and scheduled, with a thumbnail, time and title on each
tile. Lyuba uses it for planning.

- Live page: https://claude.ai/artifact/86K6PKnMHbezT87VTdbt9J (private to Lyuba)
- Page source: `docs/content-calendar/index.html` (it only renders; the data is not in it)
- Data: the artifact's database, collection `posts`, one document per post
- Thumbnails: the artifact's asset store; local copies in `~/Desktop/Social Media/Calendar/thumbs/`

## Rule for every session that publishes or schedules

Whenever a post goes live or gets scheduled (YouTube, Facebook, Instagram), add
or update its row here in the same turn, next to the story README's
"PUBLISHED" log. Do not republish the page to add posts; write to the database.

### 1. Make a thumbnail (small JPG)

```bash
T=~/Desktop/"Social Media"/Calendar/thumbs
# long form: the chosen cover
ffmpeg -loglevel error -y -i "<story>/covers/cover_B_....jpg" -vf scale=480:-2 -q:v 4 "$T/<story>-long-en.jpg"
# short / reel: a frame from the video at ~4 s
ffmpeg -loglevel error -y -ss 4 -i "<story>/shorts/<kind>.mp4" -frames:v 1 -vf scale=270:-2 -q:v 4 "$T/<story>-<kind>.jpg"
```

Copy it into your scratchpad (uploads must come from the working directory or
the scratchpad), then upload with the Artifact tool:
`{ url: "https://claude.ai/artifact/86K6PKnMHbezT87VTdbt9J", asset: true, file_path: "<scratchpad>/<name>.jpg" }`.
The result gives `/_blob/<id>`; that string is the row's `thumb`.
Thumbnails are vertical for everything except YouTube long forms (Shorts and all
Facebook / Instagram posts: 270x480 frame); long forms use the 16:9 cover.
A Meta reel cut from the same file as a YouTube Short reuses the Short's thumb.
The tile shows only the picture, platform icons, duration, and a clock if scheduled;
the title appears on hover. Clicking a tile opens an overlay with one button per platform.

### 2. Write the row (ArtifactData)

`action: "set"`, `url` as above, `collection: "posts"`.
Doc id: `<story>-long-<channel>` for long forms, `<story>-<short|reel|post>-<cut>-<channel>`
for vertical ones (e.g. `prodigal-long-yt-ru`, `martha-short-history-yt-en`,
`martha-reel-history-meta`). Keep this pattern: vertical rows with the same date and
the same `<story>`+`<cut>` render as ONE stacked tile with an icon per platform. To
pair rows whose ids differ, give them the same `group` value.
Updating an existing row (schedule moved, now live): `get` it first and pass its
`version` as `if_version`.

```json
{
  "story": "Martha",
  "kind": "short", // long | short | reel | story | post (carousel/image)
  "platforms": ["yt-en"], // any of yt-en, yt-ru, fb, ig (FB + IG same time = one row)
  "status": "scheduled", // published | scheduled
  "date": "2026-10-07", // Europe/Sofia
  "time": "13:00", // optional, Europe/Sofia, 24 h (shown on hover only)
  "duration": "0:22", // video length m:ss, shown on the tile: ffprobe -v error -show_entries format=duration -of csv=p=0 <file>
  "title": "Martha Was Doing the Right Thing | Luke 10:38–40",
  "link": "https://youtube.com/shorts/-jIlYPvFJhw", // the post's own URL (matched to a platform by host)
  "links": {
    "fb": "https://www.facebook.com/61593746016419/posts/<id>",
    "ig": "https://www.instagram.com/reel/<code>/"
  }, // per-platform URLs, read before `link`; for a FB+IG row put the IG URL in links.ig, otherwise Instagram shows "No link yet"
  "thumb": "/_blob/<asset id>",
  "paid": true, // optional; a boosted organic post (gold dot)
  "group": "martha-history", // optional; forces rows into one stacked tile
  "campaign": true // optional; hides the row (ad-campaign creatives that are not organic posts)
}
```

A `scheduled` row turns into a posted tile by itself once its date and time pass,
so there is no need to flip the status afterwards. Delete a row only if the
post was removed or cancelled.

## Backfill status

Backfilled on 2026-10-09 back to the first post (Instagram, 2026-08-20). Known gaps:
the five Instagram-only posts of Aug 20–27 have no link (Business Suite does not
show the permalink). Carousels and ad-set rows have no duration. A few thumbnails
(Storm "fear", Pharisee "Pride", brand ads) are low-res screenshots.
