---
title: "Bound experience-editor Dub data without losing authored selections"
date: "2026-09-14"
last_updated: "2026-09-14"
category: "performance-issues"
module: "apps/admin experience editor"
problem_type: "performance_issue"
component: "service_object"
symptoms:
  - "Editor requests grew to seconds or minutes as referenced-video Dub counts increased"
  - "Admin RSS grew by multiple gigabytes while opening an incident-scale experience"
  - "Concurrent editor requests delayed or failed public GraphQL requests"
root_cause: "wrong_api"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "database"
  - "frontend_stimulus"
  - "testing_framework"
tags:
  - "experience-editor"
  - "dubs"
  - "postgresql"
  - "bounded-data"
  - "lazy-loading"
  - "memory"
  - "pagination"
  - "request-priority"
---

# Bound experience-editor Dub data without losing authored selections

## Problem

The Admin experience editor made the cost of opening and saving an experience
proportional to the complete Dub inventory of every referenced video. On the
September 14 fixture, the referenced set grew from 64 videos and 4,344 active
Dubs to 125 videos and 143,030 active Dubs. The old path materialized each Dub
plus language and localized relations even when the draft used one language.

The durable constraint is stronger than “make the query faster”: editor state
must not transport a video's whole Dub collection merely to show a default
preview, coverage label, or language picker. It must still preserve every
authored video, language, legacy URL, preview, and clip choice.

## Symptoms

- The baseline cold editor request took 5,466.821 ms, returned 39,028,297 bytes,
  and serialized 143,026 Dub markers.
- Four concurrent editor requests produced a 15,206.715 ms editor p95, a
  4,837,748,736-byte peak RSS delta, and a public GraphQL p95 276% above its
  no-editor control.
- A naive limit on collection children would avoid one large response but
  silently break the editor's “add all” behavior.
- A Dub can disappear after initial hydration, so client-only validation could
  admit stale selectors through GraphQL, MCP, chat, or revision restore.

The reproducible figures and workload contract are in
`docs/validation/feat-501/README.md`.

## What Didn't Work

- The final design does not rely on tuning the eager relation query or
  increasing timeouts, because either approach would retain the cardinality
  coupling. Indexes help the bounded projection, but do not remove the cost of
  hydrating and serializing 143,030 records.
- Collapsing authored state to one language per video was incorrect because the
  same video may appear in multiple blocks with different language or legacy
  stream selectors.
- Reusing a one-page collection preview for Apply would silently truncate large
  collections.
- UI-only validation was bypassable because multiple non-UI mutation surfaces
  write experience drafts.
- One event-loop yield did not reliably let a same-instant public request enter
  its handler before four editor requests began route preparation. A measured,
  bounded registration window was required.
- Before/after numbers were not treated as comparable when fixture, request,
  authentication, hardware, or measurement fingerprints differed.

## Solution

### Select before hydration

`apps/admin/src/services/experience-editor-video.service.ts` owns a compact
summary contract. It accepts at most 100 video IDs per database batch, computes
counts and winner IDs in PostgreSQL, and hydrates only:

```ts
{
  playableLanguageCount,
  playableLanguageChips, // bounded display sample
  defaultDub,             // locale-aware preview choice
  authoredDubs,           // exact selectors already in the draft
  dubInventory: { status: "not-loaded" }
}
```

Exact-ID loading chunks larger caller sets while preserving first-occurrence
order. The partial covering indexes in
`apps/admin/prisma/migrations/0095_experience_editor_dub_indexes/migration.sql`
support the playable-Dub aggregate and deterministic newest-choice lookup.

### Carry selectors separately and load choices on intent

`apps/admin/src/domain/experience-editor-dub-selectors.ts` extracts and
deduplicates the full `(videoId, languageId, legacyStreamingUrl)` identity from
all supported block containers, with a 2,000-selector domain ceiling.

The language picker fetches only after user intent. Pages default to 50 choices
and cap at 100; the exact selected choice is returned separately when it lies
outside the current page or search. The client cache is limited to 20 entries
with a five-minute TTL. `bounded-ttl-promise-cache.ts` coalesces identical
pending reads, evicts failed promises, and refuses to grow without bound when
all entries are in flight. A complete request identity prevents late responses
from overwriting state after close, search, locale, video, or selection changes.

### Preserve complete collection Apply semantics

Collection children use pages of at most 100 with a total-order cursor. Apply
stages all pages without mutating the draft, then verifies a stable total,
advancing cursors, unique child keys, and an exact final count. It validates the
staged selections in bounded batches and commits once. Any failure leaves the
existing block unchanged.

### Validate at the transactional service boundary

`ExperienceService` locks the locale, reads the effective prior draft, and
validates new selectors against current Dub availability before writing the
next snapshot. A newly unavailable choice fails, while an unavailable selector
already present in the prior draft remains editable so an author can repair it.
Create, update, chat mutation, revision restore, GraphQL, and MCP paths converge
on this service-owned rule.

### Give public work bounded admission priority

`public-request-priority.ts` tracks public GraphQL work and caps an editor wait
at 250 ms. Experience editor requests first reserve a 25 ms registration window
so a same-instant public request can enter before editor hydration starts. The
window is narrow and route-specific; it avoids a permanent global throttle and
was measured within the editor latency budget.

### Make the performance claim falsifiable

`probe-experience-editor-video-data.ts` measures the authenticated Admin HTTP
boundary on an isolated local or explicitly approved non-production staging
fixture. It records cold and warm timing, response bytes, a stable Dub marker,
emitted SQL, RSS, pool-timeout logs, paired public queries, exact collection
expansion, and repeated open/save idle RSS. It emits compact scalar measurement
evidence and hashed target fingerprints, never response bodies, URLs, cookies,
request bodies, or header values. A comparison is rejected when the fixture or
workload fingerprints differ.

## Why This Works

The root cause was unbounded data transport, not one slow lookup. The old graph
made database rows, object allocation, serialization, garbage collection, and
connection occupancy grow with every playable Dub attached to every referenced
video. The new controlling variables are explicit limits: 100 video IDs per
batch, five language chips, one default choice, and only exact authored choices.
Increasing an unselected Dub inventory no longer increases hydrated Dub objects.

Lazy paging preserves functionality because complete discoverability moves
behind the control that needs it instead of being deleted. Returning the exact
authored choice separately makes state preservation independent of the current
inventory page.

Transactional validation closes the race left by a lazy UI and prevents other
write transports from bypassing the invariant. Comparing with the prior draft
keeps old invalid content repairable without legitimizing a newly invalid
choice.

Collection total, cursor, uniqueness, and completion checks make pagination
all-or-nothing. A bounded response alone would prove request size, not authored
result completeness.

In the completed fixed-revision validation, serialized Dub markers fell 100%,
comparable peak RSS delta fell 98.8%, public p95 stayed within 5.4% of no-editor
control at both measured editor loads, all 124 collection children were
preserved in order, and the 20-cycle RSS confidence interval included zero. No
editor/public failure or connection-pool timeout occurred.

## Prevention

- Treat relation cardinality as part of every editor data contract. Initial
  props should expose counts, bounded previews, exact authored identities, and
  an explicit not-loaded state—not complete one-to-many inventories.
- Put ceilings at transport and domain boundaries, and keep real-PostgreSQL
  tests proving that high-cardinality videos hydrate only bounded winners.
- Keep selector validation in the shared transactional write service. UI
  preflight is useful feedback, never the authority.
- Implement paginated “apply all” as a staged transaction at the UI state
  boundary: validate totals, ordering, uniqueness, and completion before one
  mutation.
- Keep request caches bounded, failure-aware, and keyed by the complete request
  identity.
- Measure public latency beside heavy internal workloads. A demand-priority
  mechanism needs enough bounded registration time to work under concurrent
  route preparation; a zero-delay yield is not a reliable scheduling contract.
- Require production-shaped, fingerprint-matched evidence before declaring a
  performance gate complete.

## Related Issues

- `docs/plans/2026-09-14-001-fix-experience-editor-dub-fanout-plan.md`
- `docs/roadmap/platform/feat-501-experience-editor-bounded-video-data.md`
- `docs/solutions/performance-issues/watch-selected-dub-projection-20260624.md`
