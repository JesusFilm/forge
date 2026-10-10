---
id: "feat-405"
title: "Watch video image display order"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-08-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "graphql"
  - "watch-page"
---

## Problem

Watch series and media collection cards can render a stale-looking still frame
when a video has multiple `VideoImage` rows. Admin returned non-deleted image
rows without a deterministic display preference, while Web treated
`images[0]` as the visible thumbnail source. Production exposed this on
Conversation Starters: most updated short-film cards showed
`mobileCinematicHigh`, but `Good` still rendered `videoStill`.

## Entry Points — Read These First

1. `apps/admin/src/services/video.service.ts` — Watch route snapshot image
   projection for series children and parents.
2. `apps/admin/src/graphql/loaders.ts` — `videoImagesByVideoId` loader used by
   block resolvers.
3. `apps/admin/src/graphql/types/blocks.ts` — MediaCollection linked-video
   image resolver.
4. `apps/admin/src/services/watch-search.service.ts` — search result image
   hydration.
5. `apps/web/src/lib/episode-image.ts` — Web's `images[0]` episode-card image
   selection.

## Grep These

- `videoImagesByVideoId`
- `imageRowsForSnapshot`
- `selectRenderableVideoImage`
- `bestVideoImageUrl`
- `resolveEpisodeImageUrl`

## What To Build

1. Add a single Admin helper that sorts `VideoImage` candidates by display
   preference: `mobileCinematicHigh`, then `mobileCinematicLow`, then
   `videoStill`, then `thumbnail`, then `url`.
2. Use the helper for Watch route snapshots, block image hydration, and Watch
   search image hydration.
3. Keep per-row URL fallback behavior unchanged where consumers already had
   their own fallback order.
4. Add regression coverage for still-first input rows returning the cinematic
   row first.

## Constraints

- Do not mutate `VideoImage` rows or depend on a production DB backfill for the
  runtime fix.
- Do not hand-edit generated GraphQL or Prisma artifacts.
- Keep the change scoped to image ordering; authored `imageAsset` overrides
  must continue to win in Web enrichment.

## Verification

- `pnpm --filter @forge/admin test -- src/services/video-image-selection.test.ts src/graphql/loaders.test.ts src/services/watch-search.service.test.ts`
- `pnpm --filter @forge/admin test -- src/graphql/types/blocks.test.ts`
  should pass in an environment with the admin install and Prisma client
  generated.
- Confirm live `conversation-starters.html` cards resolve `Good` to
  `2_0-Good.mobileCinematicHigh.jpg` after deploy and cache revalidation.

## Production Baseline

Captured from `https://www.jesusfilm.org/watch/conversation-starters.html` on
2026-08-21 before this fix was deployed:

| Title                  | Current rendered variant | Current rendered image                              |
| ---------------------- | ------------------------ | --------------------------------------------------- |
| Vinyl                  | `mobileCinematicHigh`    | `2_0-Vinyl.mobileCinematicHigh.jpg`                 |
| Don't Hold Your Breath | `mobileCinematicHigh`    | `2_0-Dont-Hold-Your-Breath.mobileCinematicHigh.jpg` |
| Good                   | `videoStill`             | `2_0-Good.videoStill.jpg`                           |
| Rain                   | `mobileCinematicHigh`    | `2_0-Rain.mobileCinematicHigh.jpg`                  |
| To Be Like You         | `mobileCinematicHigh`    | `2_0-To-Be-Like-You.mobileCinematicHigh.jpg`        |

Re-run the same check after deploy/cache revalidation:

```bash
node <<'NODE'
const videos = [
  { title: "Vinyl", slug: "vinyl" },
  { title: "Don't Hold Your Breath", slug: "dont-hold-your-breath" },
  { title: "Good", slug: "good" },
  { title: "Rain", slug: "rain" },
  { title: "To Be Like You", slug: "to-be-like-you" }
]
const pageUrl = "https://www.jesusfilm.org/watch/conversation-starters.html"
const html = await fetch(pageUrl, {
  headers: { "user-agent": "Codex thumbnail monitor" }
}).then((response) => response.text())
const decode = (value) => value.replaceAll("&amp;", "&")
function originalImageFromNext(srcset) {
  const first = decode(srcset).split(",")[0]?.trim()?.split(" ")[0]
  if (first == null || first.length === 0) return null
  return new URL(first, pageUrl).searchParams.get("url")
}
function variant(url) {
  return url?.match(/\.([^./]+)\.jpg\//)?.[1] ?? null
}
for (const video of videos) {
  const card =
    html.match(
      new RegExp(
        `<a[^>]+href="/watch/conversation-starters\\.html/${video.slug}\\.html"[\\s\\S]*?</a>`
      )
    )?.[0] ?? ""
  const srcset = card.match(/srcSet="([^"]+)"/)?.[1] ?? ""
  const currentUrl = originalImageFromNext(srcset)
  console.log(
    `${video.title}\t${variant(currentUrl) ?? "missing"}\t${currentUrl ?? "missing"}`
  )
}
NODE
```

If Admin is missing newly authored image rows, refresh Core video images with
`pnpm --filter @forge/admin core-sync:run --full --scope=video-images`. This
display-order fix itself does not require a data mutation when the rows are
already present.
