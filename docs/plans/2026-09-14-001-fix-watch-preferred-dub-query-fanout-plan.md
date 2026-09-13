---
title: "Batch preferred playable dub reads to reduce homepage pool contention"
type: fix
status: active
date: 2026-09-14
---

Runtime ticket: `feat-495`. Production traces and local read-only measurements
identify hundreds of independent preferred-dub lookups during a homepage request.
Four concurrent homepage queries issue 5,348 SQL statements and queue up to 1,003
operations on the unchanged ten-connection pool. The final bounded loader reduces
this to 160 statements and a peak queue of 19 while preserving response data.

## Requirements

- Preserve exact slug/BCP-47, primary-language and duration/id fallback selection.
- Preserve parent/dub publication and deletion checks, empty-HLS exclusion,
  nested Pothos selections and request-local isolation.
- Bound batches and hydrate only winning dub IDs. Recheck availability during
  hydration. Keep existing connection-pool sizes and evidence deadlines.
- Keep the public SDL unchanged; regenerate and verify its shared artifacts.

## Implementation units

### U1. Service-owned batch selection

Files: `apps/admin/src/services/preferred-playable-dub.service.ts` and its tests.
Use parameterized LATERAL winner selection followed by bounded Prisma hydration.
Characterize existing behavior with real PostgreSQL parity, including missing,
deleted, unpublished, empty-HLS, null-duration and tied-duration candidates.

### U2. Request-local GraphQL batching

Files: `apps/admin/src/graphql/loaders.ts`, `loaders.test.ts`,
`types/video.ts`. Follow `videoByIdWithQuery`: group by language and selection,
preserve caller order and nulls, deduplicate identical keys within one request.
Verify sibling batching and fresh caches across requests.

### U3. Validation and release

Run relevant Admin tests, PostgreSQL parity, lint/typecheck, schema regeneration
and production build. Repeat actual homepage GraphQL and concurrent-read
measurements against the final implementation. Merge through PR-to-main and
compare primary-host playback failures and request latency after deployment.
Residual database or event-loop delay remains visible; query reduction alone
does not establish full production recovery or activate homepage recommendations.

## Local verification

U1 and U2 are implemented. U3 passes 6,498 Admin tests, the real PostgreSQL
selection fixture, lint, typecheck, production build and both workflow build
verifiers. Regenerated SDL and shared introspection are unchanged. Actual
GraphQL responses match the scalar resolver in English, Russian, `en`, and
the null-language fallback, including array order. Runtime results and release
observation are recorded in `docs/operations/watch-runtime-diagnosis-2026-09-14.md`.
