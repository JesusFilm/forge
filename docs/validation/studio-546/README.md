# Exact-render review verification

The human review panel follows an exact `revision` and `renderAttemptId` handoff.
It resolves that attempt independently of the recent 20-render list and plays
retained private bytes without waiting for a Mux/catalog release. Old output stays
readable, while both dirty local state and a newer canonical revision prevent
approval. Admin independently rechecks revision and render identity under its
project lock. Effective script/voice approval and exact-output publication approval
remain separate canonical human records.

Inspection is an explicit action. Opening the ordinary editor fetches no inspection
evidence or rendered MP4. Opening the review panel requests exact metadata; sample
payloads are stripped from its browser response. The inspection button obtains the
bounded report/images, with coverage, detector limitations and server preparation
time. This is not evidence that an external client listened to or watched media.

The production panel exposes the durable narration allowance. Additional passes
require explicit acknowledgement of paid charges with unknown actual pricing.
Retries retain the original authorization command; they neither authorize twice
nor execute narration. A definitive revision rejection permits explicit discard
and renewed consent against the latest canonical revision, while an uncertain
transport outcome cannot be discarded. Existing narration generation and provider flows are unchanged.

## Tests

- Manager: `pnpm --filter @forge/manager test -- src/features/video-studio/render-review-state.test.ts src/features/video-studio/editor-session.test.ts src/features/video-studio/publication-submission.test.ts src/app/api/shorts/render-review/route.test.ts` — 17 passed.
- Admin: `STUDIO_PRODUCTION_ENABLED=true STUDIO_PUBLICATION_ENABLED=true STUDIO_TEST_DATABASE_URL=postgresql://tataihono@127.0.0.1:55460/forge_studio_460_fresh pnpm --filter @forge/admin test -- src/services/studio-authoring/draft-render.db.test.ts src/services/studio-authoring/delegated.db.test.ts` — 2 database scenarios passed. They cover attributed reconciliation, stale approval rejection, and retained historic output. The first run without the explicit production flag failed closed; the authorized disposable database run passed with it.
- Manager typecheck and scoped ESLint passed. Production build passed with inert `fixture-build` values for the three required Mux/OpenRouter configuration strings; no paid provider execution occurred. A first build without those required variables failed configuration validation.
- Static production editor client-reference graph: baseline 7 chunks, 478,136 raw / 120,417 gzip bytes; candidate 7 chunks, 478,177 raw / 121,560 gzip bytes (+41 raw, +1,143 gzip). The review/inspection/allowance UI markers are absent from those initial reference chunks. This is a dependency/compression comparison, not browser load timing. Independent review and browser measurements follow below when complete.

No Pothos schema or canonical persistence shape changes in this slice; no additional
schema generation or migration is required.

## Reproducible local UI fixture

Run `STUDIO_QA_MEDIA_ROOT=<local representative-30s directory> node docs/validation/studio-546/serve.mjs`.
The 545 contained-render fixture supplies `document.json`, `evidence.json` and
`render.mp4`. The default address is `http://127.0.0.1:4186`. Set
`STUDIO_QA_SOURCE_ROOT` to a baseline checkout to compare the actual panel source;
set `STUDIO_QA_PORT` when running two servers.

The fixture has synthetic canonical state and 180 ms response latency. It does not
create an operator session, bypass application authentication, call providers or
write production data. It uses actual application `RenderPanel`, `EditorSession`
and allowance UI, plus a real contained-render MP4. It is functional/performance
fixture evidence, not authenticated application qualification.

1. Open the normal page. Refresh visible metrics and confirm no API or media work
   before opening review.
2. Open review. Metadata can load, but video and inspection images must stay idle.
3. Watch the exact render; then load sampled inspection explicitly. Capture mount
   and request timing separately from initial-page timing.
4. Open `/?handoff` to select a historical attempt absent from the recent list.
5. Close review, simulate a human edit, reopen the historical link and verify that
   old bytes remain identifiable while approval is disabled. Repeat with unsaved
   local edits.
6. Open allowance and explicitly authorize one pass. The fixture simulates a
   committed authorization whose response was lost. Retry the exact authorization
   and confirm the visible retained allowance increments once.

The metrics button exposes navigation/resource timing, API request sequence and
CLS to DOM-only browser automation. Name the measurement window in reported
numbers. Vite fixture measurements do not represent production bundle timing;
compare the production client-reference chunk graph separately.

## Remaining qualification boundary

Authenticated browser session creation was rejected by automatic approval review
in the orchestration task and requires explicit user permission. This fixture
cannot substitute for authenticated UI observation. Full real Claude/Codex
qualification remains feat-548; no paid provider call or production release is
claimed here.

## Synthetic browser and page-loading evidence

Root orchestration drove the fixture through the approved in-app browser. Three
matched warm runs used the same fixture, 180 ms response latency, baseline UI from
the connection worktree and candidate UI from this slice. App readiness is the
fixture App mount effect, not the earlier navigation load event.

| Measurement                        | Baseline              | Candidate             |
| ---------------------------------- | --------------------- | --------------------- |
| App ready runs (ms)                | 698.1 / 583.4 / 829.2 | 537.6 / 498.4 / 636.8 |
| Median app ready (ms)              | 698.1                 | 537.6                 |
| Median navigation load (ms)        | 599.3                 | 350.5                 |
| API requests before opening review | 0                     | 0                     |
| Initial-page CLS in all three runs | 0                     | 0                     |

These warm Vite fixture results show no observed regression in ordinary boot;
they do not claim production page-load latency or a guaranteed speedup. The
production static dependency comparison above measures a different property.

Functional observations: opening review requested metadata without fetching
inspection images; explicit video review decoded the actual retained MP4 at
320×180, duration 30.058667 s, readyState 4. Explicit inspection then displayed
six decoded JPEG samples. A lost authorization response retained its exact
retry; two requests increased the retained allowance by one pass.

Final browser checks retained historical revision 1 while canonical revision
advanced to 2, showing the explicit stale warning and disabling approval. With
actual video loaded (readyState 4), unsaved edits disabled both confirmation and
approval. With clean unchanged state, confirmation became available and approval
remained disabled until the human checked it. The browser did not submit approval
or publication; canonical command authority was checked by the database tests.

An earlier interaction window accumulated CLS 0.445 across panel opening,
inspection payload insertion and visible fixture metrics. That mixed fixture
interaction window is not the initial-page measurement and cannot establish
production review-panel CLS. Authenticated application measurement remains open.
