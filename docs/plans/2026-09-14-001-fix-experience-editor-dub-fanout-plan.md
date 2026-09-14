# Bound experience editor data and homepage revalidation

Date: 2026-09-14. Implementation tickets: `feat-501` (editor), `feat-502`
(cache invalidation). This is an implementation plan; neither fix has shipped.

## Outcome and scope

Opening, editing, saving, and publishing `/watch-home` must not materialize the
language inventory for every referenced video or stall public Admin GraphQL.
Editors retain complete language choice, existing selected languages, playback
previews, clip ranges, coverage indicators, and collection editing. A publish
request first validates the exact candidate while the current published version
continues serving. Only a validated candidate may replace it and invalidate its
affected caches. Failed validation leaves the published version and caches intact.
Successful homepage content changes do not expire unrelated video/series caches.

Deliver two separate PRs, editor first. No content rollback, production restart,
pool-size increase, timeout increase, or infrastructure scaling is part of this
plan. Preserve the main/sync database pools at 10/5 connections, auth, public URL
rules, recommendations, GA, and Datadog. No public GraphQL schema change is
expected; regenerate SDL and the typed client together if one becomes necessary.

## Evidence and limits

Read-only checks during the September 14 incident established:

- Previous published English homepage: 64 referenced videos with 4,344 active
  dubs. Updated homepage: 125 referenced videos with 143,030 active dubs. Adding
  the first 30 library videos gave 155 videos and 143,060 dubs. Country-language
  joins for that set yielded 419,869 rows.
- `loadVideoRowSlice` loads all active dubs, their language/country relations,
  and all localized video descriptions, then builds `playableDubs` for every
  video. The editor also loads references outside the first library page.
- Admin memory rose from 2.70 GB at 12:02:00 UTC to 4.78 GB at 12:02:30 and
  11.67 GB at 12:09. Editor requests took 49–140 seconds. The draft save was
  recorded at 12:03:17.960 and publication at 12:03:19.944.
- A later process sample showed the main Node thread using approximately 93%
  of one core; PostgreSQL had mostly idle connections. Admin logged Prisma
  connection timeouts while public requests returned 502 or timed out.
- Homepage publication emits both `experience` and broad `watch-setting`
  revalidation, and starts a route-manifest refresh. Web uses immediate tag
  expiration and root-layout invalidation.

The data expansion is verified and the leading source of overload. It is not a
heap profile or an isolated causal reproduction. In particular, memory growth
preceded the recorded publish; do not attribute the initial spike solely to
publication or claim the exact draft loaded at 12:02 is preserved. Cache
invalidation is a plausible amplifier. Reconstruct the exact editor input in
the baseline and record deviations from these SQL-derived counts.

Related work: `docs/solutions/performance-issues/watch-selected-dub-projection-20260624.md`
and `docs/operations/watch-runtime-diagnosis-2026-09-14.md` describe the existing
public preferred-dub batching fix. Reuse its batching lessons, but preserve the
editor's own playback eligibility and fallback semantics; they include DASH/share
and must not silently become the public HLS-only policy. `feat-172` established
the existing cache correctness contract; narrowing it needs replacement coverage.

## PR 1: compact editor data and lazy language selection

### 1. Capture a repeatable baseline

Use an isolated local/staging PostgreSQL fixture following
`apps/admin/docs/worktree-preview-setup.md`. Include the incident-scale homepage,
high-dub videos, two locales, existing non-default language selections, collections,
and unavailable dubs. Do not stress-test production.

Measure production-build editor open, save/rerender, publish/rerender, initial
RSC bytes, query result rows, emitted SQL, pool acquisition wait, process RSS/heap,
event-loop delay, and public GraphQL latency under a fixed background workload.
Record deployed/local revisions, fixture counts, hardware, and cold/warm state.
Do not count Prisma method calls as emitted SQL or treat RSS as V8 heap usage.

### 2. Introduce an editor-specific summary contract

Entry points:

- `apps/admin/src/app/dashboard/live-data.ts`: `loadVideoRows`,
  `loadVideoRowSlice`, `playableDubsForPicker`, `preferredPickerDub`.
- `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`: initial loader,
  `loadVideosByIdsAction`, collection/search loaders, save and publish actions.
- `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`:
  `VideoLibraryItem`, `preferredPlayableDubForVideo`, `selectedPlayableDubForVideo`.
- `apps/admin/src/services/preferred-playable-dub.service.ts`: batching reference.

Add a service-owned summary projection with explicit fields: video identity,
preferred localized title/description, thumbnail, counts/coverage, bounded
collection previews, and one default preview dub. Include the already-authored
dub when different, using block `languageId` and legacy stream selection as
inputs. Distinguish summary data from a loaded language inventory in the types;
an omitted inventory must never mean a video has no playable languages.

Select winner IDs and aggregates in SQL before hydrating rows. Batch by video ID
and locale, at most 100 IDs per batch, with sequential batches or explicitly
bounded concurrency. Do not replace one broad query with a query per video.
Return counts rather than inventories for coverage, and bounded language chips
where the existing UI requires them. Fetch only needed localized text and flag
metadata. Preserve exact existing default/selected-dub and ordering semantics
with parity fixtures before changing the query.

Use the compact path for initial rows, referenced-video top-ups, picker search,
collection children, and post-save/post-publish rerenders. Page large collection
children instead of expanding their entire dub inventories. Keep every authored
reference resolvable by bounded batches; never silently truncate saved content.
Audit other `loadVideoRows` consumers before changing shared types; unrelated
video detail screens can retain their explicit detail loaders.

### 3. Fetch language options on user intent

Add an authenticated server action backed by the service. Input is one video ID,
editor locale, optional search/cursor, and a server-enforced page size (50 default,
100 maximum). Return slim dub choices and a next cursor. Resolve the authored
selection separately so it remains visible even outside the first page or filter.
Validate inputs and preserve the editor's existing principal/visibility rules.

The editor loads options only when audio-language selection opens. Adapt
`SearchableVideoDubControl` to server search/paging with loading, empty, error,
retry, and load-more states. All supported languages must remain discoverable.
Default previews work from summary data before inventory loading. Inventory
fetch failure cannot clear a saved language or prevent unrelated text edits.

Deduplicate concurrent requests for the same video/locale/search/cursor. Ignore
late responses after selection changes or the picker closes; abort transport
where supported, without assuming cancellation stops a server action. Bound
the in-editor cache (proposed: 20 pages with a five-minute TTL), clear it on locale
or session change, and avoid polling or caching rejected promises indefinitely.
Preserve clip-reset behavior on an intentional language change, but not on a
background response or default fallback. Revalidate availability on apply/save
using bounded lookups; surface removed dubs without silently replacing them.

### 4. Verify behavior and resource bounds

- Real PostgreSQL tests: exact/fallback/legacy selection, duplicate languages,
  missing playback, deleted rows, zero-dub collections, pagination stability,
  and preservation of requested ID order. Measure emitted SQL and materialized
  rows on incident-scale fixtures. Increasing total dub count must not increase
  initial inventory rows or produce per-video query fanout.
- Component tests: initial render fetches no inventories; opening fetches one
  video's page; search/paging exposes later languages; rapid switching ignores
  stale results; retry succeeds; saved off-page selection and clip values survive.
- Browser test with a production build: open heavy homepage, change a block,
  choose a non-default language, preview, save, reopen, publish, and verify the
  persisted choice. Exercise collection and AI-referenced-video top-up paths.
- Compare baseline/fix with 1 and 4 concurrent editor sessions alongside the
  same public GraphQL workload. Proposed acceptance budgets: at least 90% less
  serialized initial dub data; editor-induced peak RSS delta reduced at least
  75%; no pool timeout or 5xx; public-query p95 no more than 20% above its
  no-editor control; no upward post-idle RSS trend across 20 open/save cycles.
  Use at least 30 timing samples and report absolute values. If the no-editor
  control is unhealthy, isolate that blocker rather than claiming this fix passes.

Run focused service/DB/component tests, Admin lint and typecheck, and the Admin
production build including workflow verifiers. Record commands and results under
`docs/validation/feat-501/`. Add compact duration/count telemetry for summary and
language-page loads; do not log inventories, user content, or credentials.

## PR 2: validate publication before promotion and cache invalidation

### Required publication order

User requirement: a new experience must be verified before its publication can
invalidate the working production version. Schema validation alone is not enough.

`draft -> validating -> ready -> atomic promotion -> scoped invalidation -> observed`

Validation failure returns to an editable failed state with actionable diagnostics;
there is no public promotion or invalidation. Existing published content remains
the serving source throughout validation. This applies to all experience publishes;
the heavy homepage is the incident acceptance fixture.

1. **Freeze the candidate.** At publish request, authenticate/authorize and capture
   an immutable snapshot, revision digest, expected published revision, locale,
   route identity, and requested publisher. Add a persisted publication attempt
   recording these values, validation/build versions, timestamps, results, and
   state. Candidate checks run in an isolated worker/preview execution path with
   bounded concurrency and time/resource budgets, not in Admin's serving process.
   Inspect existing workflow infrastructure before adding a new runner.
2. **Validate the candidate end to end.** Check schema, block and referenced-video
   integrity, authored language/playback selections, route collisions/admission,
   required media, and the complete public rendering path using this candidate.
   Exercise homepage sections, initial data, navigation and representative playback
   with the current deployed Web runtime; include all affected locale fallbacks.
   Verify resource/latency budgets against the incumbent and a concurrent incumbent
   control. Fail when a required check cannot complete; report the missing evidence.
   Use documented optional-media fallbacks rather than rejecting valid content for
   cosmetic differences. Define these mandatory/optional checks in tests.
3. **Keep preview isolated.** Candidate URLs require short-lived signed access and
   are no-store/noindex; candidate reads use an explicit snapshot identity and
   cannot overwrite production cache entries. Use equivalent live rendering/data
   resolution so a permissive draft renderer cannot provide a false pass. Never
   publish temporarily to test the candidate. Any pre-rendered cache artifacts
   must live under the candidate revision, never the live cache key.
4. **Bind readiness to what was tested.** The readiness record covers snapshot
   digest, expected incumbent revision, Web/Admin build versions, and dependency
   fingerprints. Use a short validity window (initial target: five minutes);
   edits, changed incumbent, relevant dependency withdrawal, changed renderer, or
   expiry require validation again. Recheck publication permission and critical
   visibility/playability invariants immediately before promotion. Existing draft
   revision compare-and-set machinery is a starting point, not a substitute for
   publication-attempt identity.
5. **Promote atomically.** Within one short transaction, compare the expected
   incumbent and validated candidate, preserve the old canonical snapshot for
   rollback, apply the exact candidate, and mark the attempt promoted. For a
   route-affecting change, prepare and validate the candidate manifest in advance
   and publish its compatible persisted snapshot in the same transaction; do not
   expose a new route before its admission data is ready. A stale/conflicting
   attempt fails without changing the current publication. Duplicate publish
   requests are idempotent; concurrent publishes cannot overwrite one another.
6. **Invalidate only after commit.** Insert a durable revalidation/outbox record
   in that transaction. Its worker sends the scoped event after commit with an
   idempotency key and revision identity, retrying boundedly and surfacing delivery
   failure. No candidate validation, failed transaction, or rejected attempt can
   emit public invalidation. Skip stale superseded events or merge their affected
   scopes safely. Revalidation failure is a visible pending-delivery state, not a
   claim that the new version is serving everywhere. Preserve old cached pages
   until the validated replacement is committed and ready to resolve.
7. **Observe and recover.** Retain the prior validated publication. After promotion,
   run bounded checks for the new revision and monitor errors/latency. Provide an
   explicit rollback action that restores the prior snapshot and compatible route
   admission state atomically, then issues the required scoped invalidation. A
   rollback is itself auditable and must not overwrite a newer publication.

No preflight can guarantee that a later dependency outage will never break a
page, and DB promotion cannot atomically replace every browser/CDN cache. The
contract is: no unvalidated candidate becomes canonical, no invalidation before
successful promotion, safe overlap of old/new validated versions, and a tested
recovery path. Do not promise globally simultaneous cache replacement.

### Targeted invalidation after successful promotion

Entry points: Admin `services/experience.service.ts`, `revalidate-webhook.ts`,
`watch-route-manifest-refresh.service.ts`; Web `app/api/revalidate/route.ts`,
`lib/watch-cache-tags.ts`, `lib/watch-home.ts`, `lib/content.ts`,
`lib/watch-route-manifest.ts`, `cache-handler.mjs`, and the dynamic-collection
handler/purge helper. Read their existing tests and both package guides first.

1. Map actual cache dependencies before reducing scope: homepage content and
   configuration, localized fallback homes, experience cards embedded elsewhere,
   dynamic feeds/exclusions, route admission, and sitemap membership. Include
   cache declarations, shared Redis behavior, and Cloudflare feed purges.
2. Add an additive, validated webhook change scope distinguishing homepage
   content edits from route identity/visibility and genuinely global settings
   changes. Deploy receiver support first; old payloads retain existing behavior.
   Ordinary draft saves emit no public invalidation.
3. Compare the validated canonical before/after publish fields. Content-only homepage updates
   invalidate home/experience dependencies and affected public/internal home
   routes, including fallback languages. They must not expire video/series/dub
   tags or call root-layout invalidation. Define scoped cache tags at their
   actual producers before emitting them. A shared homepage tag is acceptable
   if all language homes depend on that content and video caches remain intact.
4. Handle the entire trigger chain: avoid the redundant broad `watch-setting`
   event for homepage content edits, and skip route-manifest generation when
   route admission has not changed. Otherwise the manifest webhook would still
   invalidate all Watch layouts. Preserve refreshes for slug, locale, path,
   homepage assignment, visibility, archive, and route-relevant Core changes.
5. Preserve immediate freshness for affected published content. Do not globally
   switch to stale-while-revalidate or remove revocation/deletion invalidation.
   Retain dynamic-feed purge wherever composition/exclusions changed. If cards
   embedded elsewhere cannot yet be targeted correctly, document that remaining
   scope and implement the dependency/tag mapping before removing its invalidation.
6. Add a before/after invalidation matrix to tests: homepage title/block edit,
   no-op publish, first publish, slug/locale/path change, homepage reassignment,
   archive/unpublish, global settings, video/Core sync, and duplicate webhooks.
   Verify freshness and preserved unrelated cache hits through real Next/Redis
   behavior, not only mocked `revalidateTag` calls. Test all affected language
   fallback homes and canonical/internal URLs.

### Publish-gate acceptance tests

- Malformed blocks, unresolved required videos/languages, render failure, route
  collision, validation timeout, and exceeded resource budget leave the incumbent
  DB snapshot, admission manifest, and production cache unchanged. Assert zero
  invalidation calls/outbox events and verify the incumbent still renders.
- Draft edited during validation, changed incumbent, expired readiness, dependency
  withdrawn, revoked permission, and renderer revision mismatch reject promotion.
- A valid candidate is the exact snapshot promoted, survives retries, creates one
  logical outbox event, and refreshes only after commit. Simulated commit failure
  leaves no deliverable event. Worker failure/restart retries without losing it.
- Candidate preview requests neither mutate live caches nor require promoting the
  draft. Validation under load preserves incumbent/public API performance.
- Rollback restores the previous content and route behavior, including locale
  fallback, and cannot clobber a subsequent publication.

Run focused webhook/tag/manifest tests in both apps, lint, typecheck, and production
builds. Under representative traffic in staging, publish the heavy fixture once
and repeatedly: edited content must refresh while unrelated video data stays
cached, with no wave of GraphQL timeouts. Record request counts, cache hits,
latency, and memory under `docs/validation/feat-502/`.

## Release and completion

Ship PR 1 through normal reviewed PR-to-main Railway deployment. Observe editor
open/save and public GraphQL latency/error/memory metrics before shipping PR 2.
Ship PR 2 in reviewable increments if needed: additive attempt/outbox storage and
worker, isolated validation and promotion gate, then receiver/producer cache scope.
Keep each increment within the publication-safety scope; the gate must be complete
before claiming protected publication. Ship receiver support through the normal
flow, verify the production receiver revision, then enable its producer payload.
Keep legacy payload handling so an
Admin rollback remains compatible. A later receiver rollback must follow producer
rollback or retain support for the additive payload.

Do not call the incident resolved from one healthy browser visit. Retain a
representative post-deploy traffic window and compare editor-heavy periods with
the control. If measured editor bounds improve but public timeouts persist, report
the residual separately rather than broadening this fix into unrelated runtime work.
Update package cache/loader guidance, capture verified learning in
`docs/solutions/performance-issues/`, and mark each ticket complete only after its
own implementation and verification. Planning alone leaves both tickets pending.
