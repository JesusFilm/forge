---
title: "Lean-bulk list query + lazy per-item heavy fetch for over-fetched relations"
date: 2026-06-04
category: design-patterns
module: apps/mobile
problem_type: design_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "A bulk list query projects heavy per-item fields (downloads, subtitles, transcripts, blobs) across every item but the UI only needs them for the active/selected item"
  - "A relation list grows unboundedly with content (e.g. 2,259 dubs) and inflates bulk payload size and resolver latency"
  - "The backend can expose an additive, id-scoped query whose visibility mirrors the relation's visibility in the bulk query"
  - "A client needs deduped, retrying on-demand fetches triggered by UI intent (sheet open, captions toggle)"
related_components:
  - "apps/mobile/src/lib/queries.ts"
  - "apps/mobile/src/lib/normalizeVideo.ts"
  - "apps/mobile/src/lib/dubMediaFetch.ts"
  - "apps/mobile/src/contexts/WatchSessionProvider.tsx"
  - "apps/mobile/app/watch (download.tsx, subtitle.tsx, slug route)"
  - "apps/admin/src/graphql/types/video.ts (additive videoDub query)"
  - "apps/admin/src/services/video.service.ts (getDubById)"
tags:
  - graphql
  - mobile
  - apollo-client
  - over-fetching
  - lazy-fetch
  - lean-query
  - additive-query
  - watch-experience
---

# Lean-bulk list query + lazy per-item heavy fetch for over-fetched relations

## Context

The mobile watch video-detail screen fetched its video via `videoBySlug { ...WatchVideo }`. The `WatchVideo` fragment projected the video's entire `dubs` (audio-language variants) list, and for **every** dub it pulled the heavy per-item sub-objects: `downloads { quality, size, url }` and `videoEdition { subtitles { ... } }`.

This is the classic over-fetch shape: **a whole relation list × heavy per-item sub-objects.** For most videos it was fine. For `birth-of-jesus` — 2,259 dubs — it was pathological:

- ~9.5 MB GraphQL payload
- ~13 s admin resolver time (measured via curl against local admin)
- Multi-second loads and a JS-thread freeze on re-entry (Apollo re-broadcasts; the normalizer re-walks all 2,259 dubs)

The screen never needs all 2,259 dubs' downloads/subtitles at once. It needs them for exactly **one** dub — the selected audio language — and only when the user opens the Download/Subtitle sheet or turns captions on.

## Guidance — the pattern, step by step

### 1. Trim the heavy sub-fields out of the bulk fragment

Keep the relation list (you still need every dub's id/slug/language/hls to render the language picker and pick a playable variant) but drop the heavy per-item objects. `apps/mobile/src/lib/queries.ts`, the `dubs` selection inside `watchVideoFragment`:

```graphql
variants: dubs {
  documentId: id
  slug
  published
  hls
  duration
  language { coreId  bcp47  slug  name }
  muxVideo { playbackId }
  # downloads { ... }                    ← REMOVED
  # videoEdition { subtitles { ... } }   ← REMOVED
}
```

Document the intent inline so nobody re-inlines them. Result: **9.5 MB → 0.62 MB, 13 s → 0.28 s.**

### 2. Add an additive, id-scoped query for the heavy fields (backend)

Expose a query returning exactly one item's heavy fields, with **visibility parity** to how the bulk query gated them. A PUBLIC `videoDub(id: ID!): VideoDub` query backed by `VideoService.getDubById`:

```ts
async getDubById({ id, query }: { id: string; query: object }) {
  return this.prisma.videoDub.findFirst({
    ...query,
    where: { id, deletedAt: null, video: { deletedAt: null } },
  })
}
```

The relation filter mirrors what `videoBySlug { dubs }` would have shown (dub and parent video both non-deleted). Net schema diff: **+1 field, 0 deletions.** Register it in the public-resolvers regression manifest next to `videoBySlug`. (See [pothos-public-widening-multi-layer-coordination](../graphql/pothos-public-widening-multi-layer-coordination-20260511.md) for the public-resolver coordination rules.)

### 3. Mirror the trimmed fields in a small fragment + lazy query (consumer)

The lazy projection MUST mirror the fields trimmed from the bulk fragment so the normalizer maps the same shape:

```graphql
fragment WatchDubMedia on VideoDub @_unmask {
  documentId: id
  downloads {
    documentId: id
    quality
    size
    url
  }
  videoEdition {
    subtitles {
      documentId: id
      language {
        slug
        name
        bcp47
      }
      vttSrc
      primary
      aiGenerated
    }
  }
}
query GetVideoDub($id: ID!) {
  videoDub(id: $id) {
    ...WatchDubMedia
  }
}
```

`normalizeVideo.ts` drops `downloads`/`subtitles` from the bulk `WatchVariant` type and adds a separate `VariantMedia` type + `normalizeDubMedia()` that returns a fresh `{ downloads: [], subtitles: [] }` for a missing dub — "loaded, nothing", distinct from "not loaded".

### 4. A deduped, retrying lazy-fetch orchestrator

`apps/mobile/src/lib/dubMediaFetch.ts` — `ensureDubMedia()` is the reusable core. A `requested` Set is the dedupe ledger; a failed fetch drops its id so the next call retries; the whole body (not just the `await`) is wrapped so a synchronous throw still releases the slot:

```ts
export function ensureDubMedia(id, requested, fetchMedia, cb): void {
  if (!id) return
  if (requested.has(id)) return // dedupe: in-flight or done = no-op
  requested.add(id)
  let dispatched = false
  try {
    cb.onStart(id)
    const pending = fetchMedia(id)
    dispatched = true
    pending
      .then((media) => cb.onSuccess(id, media))
      .catch(() => {
        requested.delete(id)
        cb.onError(id)
      }) // retry on next call
      .finally(() => cb.onSettled(id))
  } catch {
    if (!dispatched) {
      requested.delete(id)
      cb.onError(id)
      cb.onSettled(id)
    }
  }
}
```

`WatchSessionProvider.tsx` wires it to Apollo (`client.query({ query: GET_VIDEO_DUB, variables: { id }, fetchPolicy: "cache-first" })`), exposes `activeVariantMedia` / `activeVariantMediaLoading` / `activeVariantMediaError` + `ensureActiveVariantMedia()`, and **resets all per-dub media + the requested ledger on video id change** — dub ids are per-video, so keeping them only grows memory and could wedge a dub into a permanent no-op after a cache clear. Sheets call ensure on open and render an error+retry state on failure (vs. loading vs. content); the player screen calls it when captions turn on.

## Why This Matters

**Payload/latency win:** 9.5 MB → 0.62 MB and 13 s → 0.28 s on the worst-case video, by not paying for ~2,258 dubs' media the user will never look at. Switching language fetches just that one dub's media; re-opening reads the warm Apollo cache (`cache-first`).

**The Apollo result-caching insight — why lazy enrichment is safe (load-bearing):** A reviewer flagged a re-freeze risk — wouldn't writing the lazily-fetched dub's `downloads`/`subtitles` into the shared `VideoDub:<id>` cache entity re-broadcast to the still-mounted `videoBySlug` watcher and re-trigger the 2,259-dub normalize? **No.** `videoBySlug`'s selection no longer _selects_ `downloads`/`subtitles`, so default `InMemoryCache` result-caching returns a **referentially-stable** `data.videoBySlug` after the lazy write. The normalizer's `WeakMap` memo is keyed on that exact reference, so it stays warm and the 2,259-dub re-normalize never runs. Confirmed by theory + simulator (no freeze when the sheet opens). **The lazy enrichment is safe precisely because the bulk consumer does not select the enriched fields** — that asymmetry is the whole trick.

**Graceful degradation:** a failed lazy fetch surfaces a retry affordance, never a crash and never a misleadingly-empty list. The provider distinguishes `null` (not loaded) / loading / error / `{ [], [] }` (loaded-empty).

## When to Apply

Use lean-bulk + lazy-per-item when **all** hold:

1. A consumer over-fetches a **large relation list** in a bulk query but only needs the **heavy per-item fields** for the **active/selected** item.
2. The bulk query still legitimately needs the list's **lightweight** fields (ids, labels, language) to render selection UI.
3. The backend can expose an **additive, id-scoped** query whose visibility filter **mirrors** the relation's visibility in the bulk query, so lazy fetch can't surface anything the bulk query would have hidden.

Do **not** keep the heavy fields in the bulk consumer's selection "just in case" — if the bulk query selects them, the Apollo result-stability / memo safety evaporates and you are back to re-broadcast freezes.

## Examples

**Query-trim ≠ schema-deletion (per-app operations).** The "deletions" were in the **operation (the query), not the schema.** Each app owns its own operations: web has its own `apps/web/src/lib/fragments/watch-video.ts` (still selects downloads/subtitles, untouched); TV has no watch-detail fragment. Trimming mobile's fragment changes only what _mobile_ requests — web and TV are unaffected and typecheck clean against the same introspection. The `VideoDub` object type (with `downloads`/`videoEdition`) stays fully in the schema; only mobile's projection of it shrank.

**Codegen / drift gate + ship as two PRs, backend first.** Adding `GET_VIDEO_DUB` requires the `videoDub` field to exist in the regenerated `packages/admin-graphql` introspection (`admin-graphql-env.d.ts`), gated by CI's `admin-graphql-generate` / `admin-schema-drift` jobs. Because the consumer depends on a backend field + a regenerated codegen artifact, ship them as **two stacked PRs**: the backend (additive query + schema + introspection) merges and deploys **first**; the client PR is opened as a draft that depends on it and is rebased onto `main` after the backend lands (that rebase pulls the introspection in, turning the client's `videoDub` typecheck green). Mobile (EAS, slow release) must not ship before admin (Railway, fast) deploys the field, or the lazy paths degrade to the retry state in production. See [dual-client-gql-tada-multi-schema-codegen-pattern](../architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md) for the codegen/drift mechanics.

**Visibility parity verified against a real DB, not mocks.** Mocked tests only prove the where-clause _shape_. The parity claim — that `getDubById`'s relation filter actually gates — was verified by running the real Prisma query in a **rolled-back transaction**: it returned `null` for a live dub under a soft-deleted parent, proving `video: { deletedAt: null }` gates as intended. (Mocked-shape vs. real-contract discipline is a recurring repo theme.)

## Related

- [asyncstorage-swr-snapshot-slow-admin-resolver](./asyncstorage-swr-snapshot-slow-admin-resolver.md) — phase two of the same optimization arc on the watch-home query: the lean payload this pattern produces is small enough (~460KB) to persist on device and paint instantly at launch while the live fetch revalidates.
- [mobile-video-detail-page-patterns](../best-practices/mobile-video-detail-page-patterns-20260527.md) — the screen this refines; that doc documents the full-`WatchVideo`-fragment fetch, this is the lean-bulk + lazy-per-item follow-up.
- [mobile-admin-data-layer-cutover-pattern](../architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md) — the mobile Apollo + admin-graphql data layer this builds on; the lazy `videoDub(id)` fetch is the same additive-fetch move applied to dubs.
- [pothos-public-widening-multi-layer-coordination](../graphql/pothos-public-widening-multi-layer-coordination-20260511.md) — governs the additive PUBLIC resolver half.
- [dual-client-gql-tada-multi-schema-codegen-pattern](../architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md) — codegen/introspection regen + deploy-ordering precedent.
- [core-graphql-unbounded-relation-fan-out](../platform/core-graphql-unbounded-relation-fan-out-20260504.md) — the server-side version of the same unbounded-relation anti-pattern.
- PRs: #1125 (admin `videoDub(id)`), #1126 (mobile lean fragment + lazy fetch, draft, depends on #1125).
