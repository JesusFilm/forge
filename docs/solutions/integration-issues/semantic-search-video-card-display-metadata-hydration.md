---
title: "Semantic search video cards need display metadata hydration after evidence fusion"
date: "2026-06-14"
category: integration-issues
module: "apps/admin/src/services/hybrid-search.service.ts"
problem_type: integration_issue
component: service_object
symptoms:
  - "Web Semantic Search video tiles rendered transcript-like text with literal markup under the title"
  - "Some video tiles showed dark placeholders even when the video had usable cover imagery or a playable Mux dub"
  - "Experience cards rendered normally, which made the issue look like a web card problem instead of a search-result contract problem"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
related_components:
  - "apps/web/src/components/search/VideoCard.tsx"
  - "apps/admin/src/graphql/queries/hybrid-search.ts"
  - "docs/search-api-guide.md"
tags:
  - admin
  - web
  - search
  - semantic-search
  - video-card
  - hydration
  - graphql
---

# Semantic search video cards need display metadata hydration after evidence fusion

## Problem

The Forge web Semantic Search surface showed video tiles with missing cover images and subtitle text that looked like transcript fragments instead of video descriptions. The bug crossed an admin-to-web contract boundary: the web `VideoCard` rendered the `SearchResult` fields it received, but admin hybrid search exposed semantic match evidence as public card metadata and did not hydrate sparse video media fields after fusion.

## Symptoms

- Video cards displayed text such as highlighted transcript snippets with literal markup under the title.
- Some cards rendered the dark play-icon fallback even though the video had image records or playable Mux-backed dubs.
- Experience cards were unaffected because they already used experience-level metadata.
- The issue reproduced on semantic or mixed semantic results where retrievers returned `sceneDescription`, `imageUrl: null`, or `playbackId: null`.

## What Didn't Work

- **Fixing the web card first.** `apps/web/src/components/search/VideoCard.tsx` already follows the contract: it renders `imageUrl`, falls back to a Mux thumbnail from `playbackId`, and prints `snippet`. Adding transcript/description heuristics there would duplicate backend knowledge in the UI.
- **Changing retriever SQL inline.** The semantic and keyword retrievers are tuned projections for indexed search paths. Fetching locale descriptions, image variants, and dub playback data in every retriever would duplicate joins across multiple SQL paths.
- **Treating transcript evidence as richer card copy.** Transcript and scene text are useful for ranking and timecodes, but they are not the same product surface as a localized video description.

## Solution

Keep retriever evidence as the initial fallback, then hydrate final video rows after fusion and pagination. The existing video card-pill hydration already performs one batched `prisma.video.findMany` for the final page; extend that pass to select published localized copy, image variants, and Mux playback data.

The service-level pattern is:

```ts
const results = await hydrateCardDisplayFields(
  prisma,
  mappedSearchResults,
  locale,
  logger,
)
```

Inside the hydration pass:

- prefer `VideoLocale.description`, then `VideoLocale.snippet`, for public `snippet`;
- pick a usable image variant for `imageUrl`;
- pick a playable Mux-backed dub for `playbackId`;
- preserve existing label, duration, and child-count behavior;
- leave experience results untouched;
- treat blank strings as missing so an empty retriever value cannot block a hydrated fallback.

The regression test should model the bad shape directly:

```ts
vi.mocked(searchVideoSemantic).mockResolvedValue([
  {
    resultType: "video",
    resultId: "vid-transcript",
    imageUrl: "",
    sceneDescription: "<b>Following Jesus</b> <b>Who is Jesus?</b>",
    playbackId: "",
    // ...
  },
])

expect(result.results[0]).toMatchObject({
  snippet: "A concise public description of the video.",
  imageUrl: "https://cdn.example/cover-high.jpg",
  playbackId: "mux-hydrated",
})
```

## Why This Works

Fusion and ranking still use the evidence row that matched the query, including `startSeconds` for deep-linking. The public card surface, however, receives video-level display metadata from the canonical video relations after the final page is known.

That keeps the search API boundary clean:

- retrievers answer "why did this result match?";
- hydration answers "how should this result render as a card?";
- the web card remains a presenter instead of a semantic-search policy layer.

The batched post-fusion query is also bounded by page size, so it avoids N+1 card lookups without making every retriever carry the same display joins.

## Prevention

- Add a regression test whenever retriever evidence is promoted into the public `SearchResult` contract.
- In card-facing APIs, distinguish evidence fields from display fields in comments, schema descriptions, and docs.
- Treat empty strings as missing when overlaying hydrated media fields; otherwise `""` can block a valid fallback just like a bad URL.
- Keep `docs/search-api-guide.md` examples aligned with the contract so future agents do not reintroduce scene evidence as card copy.

## Related Issues

- `docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md` documents the retrieval-side rule that enriched transcript evidence stays inside `semantic-video` without reintroducing scene retrieval.
- `docs/solutions/platform/admin-hybrid-search-r4-pattern.md` documents the broader admin hybrid-search port invariants.
- GitHub issue search for `semantic search video card snippet thumbnail` returned no related issues.
