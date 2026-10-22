# Daily Bible Pause content calendar

A month view of every post on YouTube (English and Russian channels), Facebook
and Instagram, published and scheduled, with a thumbnail, time and title on each
tile. Lyuba uses it for planning.

- Live page: https://claude.ai/artifact/BUdriP79dkGFDPR89MY1dt (private to Lyuba)
- Page source: `docs/content-calendar/index.html` (it only renders; the data is not in it)
- Data: the artifact's database, collection `posts`, one document per post
- Thumbnails: the artifact's asset store; local copies in `~/Desktop/Social Media/Calendar/thumbs/`

## Who writes the calendar

One writer only (from 2026-10-10): the **"Calendar" session** (local_44bbf027-2d85-47da-a007-99399f6735f4, Channel Management group; replaced the old-account session on 2026-10-20) (the session
that built this page) owns the `posts` collection. Other sessions do not write rows.
When Publishing (or any session) publishes or schedules a post, it sends that session
a short message with: story, kind/cut, platforms, status, date and time, title, links
(YouTube / Facebook / Instagram), local file path. The calendar session then makes the
thumbnail and writes the row. Analytics and other sessions send plan changes the same
way.

The recipe below is what the calendar session follows.

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
`{ url: "https://claude.ai/artifact/BUdriP79dkGFDPR89MY1dt", asset: true, file_path: "<scratchpad>/<name>.jpg" }`.
The result gives `/_blob/<id>`; that string is the row's `thumb`.
Thumbnails are vertical for everything except YouTube long forms (Shorts and all
Facebook / Instagram posts: 270x480 frame); long forms use the 16:9 cover.
A Meta reel cut from the same file as a YouTube Short reuses the Short's thumb.
Layout (Figma "A3", 2026-10-12): each week is three lanes, YouTube EN, YouTube RU and
Facebook + Instagram. A long form shows its thumbnail and working name (from `story`, plus
"LUMO" when the id has "lumo"). Below a divider come the Shorts/reels, labelled only by type
(intro / verse / insight / refl. / teaser), taken from `cut` or from the doc id. Rows with
fb+ig land in the Meta lane. A planned row on yt-en+fb+ig appears in both lanes. The title
shows on hover. Clicking a tile opens an overlay with one button per platform the cut went
to that day.

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
  "status": "scheduled", // published | scheduled | planned (in the plan, not uploaded yet)
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
  "campaign": true, // optional; hides the row (ad-campaign creatives that are not organic posts)
  "note": "redo, Meta dropped it" // optional; shown on hover and in the overlay
}
```

Planned rows use ids `plan-<story>-<kind>-<cut>-<channel>` and carry `story` + `cut`
(written on the tile, e.g. "Story A / intro"); thumb optional. When the real post is
scheduled or published, delete the `plan-` row and write the real one.

A `scheduled` row turns into a posted tile by itself once its date and time pass,
so there is no need to flip the status afterwards. Delete a row only if the
post was removed or cancelled.

## Content view and open decisions (`stories`)

The list icon in the calendar header opens "All content": one row per story (numbered in
release order, newest on top) with its thumbnail, title, passage and "done of total"
(orange until every piece is scheduled or published, then green). Opening a story shows a
table laid out as Lyuba sketched it (Oct 22): rows Long / Short / Post, columns EN and RU
(Meta reels are the EN cuts, so they sit in EN with small platform icons). Long forms show a
16:9 thumbnail with title and status, Shorts a row of vertical tiles labelled by type, posts a
square image with the format. It is built from the `posts` rows; an
orange dot marks a row still `planned`, with its due date (or "was due").

Clicking a pending cell shows where the work stopped. That comes from the collection
`stories`, one document per story, id = slug of `story` (`great-catch`, `rich-fool`,
`peters-denial`). **Each story session writes its own story document** (the only exception
to the single-writer rule, and only for this collection). Keep it current: add an item when
Lyuba has to decide something, remove it once she has.

```json
{
  "passage": "Luke 5:1–11", // optional; used until a long form with a title exists
  "todo": [
    {
      "piece": "insight", // long | intro | clip | insight | refl. | verse | post
      "lang": "both", // en | ru | both (Meta counts as en)
      "stage": "Choose the topic", // short: what is waiting on Lyuba
      "text": "Three topics for the insight Short.", // optional detail
      "options": ["Deep water", "Go away from me", "Nets that tear"], // optional: the actual choices
      "link": "https://www.figma.com/design/..." // optional: Figma cover, Claude Doc script, Studio project
    }
  ]
}
```

Write it with ArtifactData `set` (first time) or `update` with `if_version`.

## Static copy for Netlify

`build-static.py` freezes a snapshot (posts embedded, thumbnails copied, the analytics
dashboard added as `dashboard.html`) into a folder Lyuba drops into Netlify, by default
`~/Desktop/Social Media/Calendar/netlify/`. It does not update itself: rebuild and
re-drop it when she asks. Inputs: an ArtifactData `list` of `posts` saved with
`out_dir`, and a blob map `{asset id: local jpg}` (match the asset listing's sha256
against `~/Desktop/Social Media/Calendar/thumbs/`).

## Backfill status

Backfilled on 2026-10-09 back to the first post (Instagram, 2026-08-20). Known gaps:
the five Instagram-only posts of Aug 20–27 have no link (Business Suite does not
show the permalink). Carousels and ad-set rows have no duration. A few thumbnails
(Storm "fear", Pharisee "Pride", brand ads) are low-res screenshots.
