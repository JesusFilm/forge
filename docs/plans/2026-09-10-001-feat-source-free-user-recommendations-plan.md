---
title: "feat: Source-free user recommendations"
type: feat
date: "2026-09-10"
status: in-progress
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-validated-local-activation-gated
roadmap: feat-477
curation_dependency: feat-476
---

# Source-free user recommendations

## Problem and scope

The existing recommendation API needs a video to recommend from. Add a source-free
operation that reads an anonymous viewer's existing server-side profile and
returns one ranked list. Build its first surface as a six-card Web homepage
For you row, immediately below Browse by category and before the introductory
Free Video Bible Library section shown in the user's reference.

Web, mobile, and TV must be able to call the same API without assuming a browser
cookie. Identity remains independent per browser/app install. Only Web UI is in
this implementation. Account linking and history shared across devices are not
part of the feature.

This plan records the user's grilling decisions from this task. The independent
curation agent owns feat-476 and `docs/recommendations/curation/2026-09-10/`.
Application code consumes its versioned output, not its research transcript.
The delegated editorial pass is complete; current Admin eligibility and
production activation remain unverified.
The remaining coverage feasibility question below must be resolved before this
plan is declared ready for production activation.

## Requirements

| ID  | Settled behavior                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Return recommendations without requiring a current/source video.                                                                                                                                                                     |
| R2  | Resolve the existing server profile from an opaque per-browser/install identity; offer a cookie-independent API for all clients. No account or cross-device history linking.                                                         |
| R3  | Preserve default-on Web personalization, existing reset/settings behavior, and receipt/privacy-generation enforcement. Introduce no new consent prompt.                                                                              |
| R4  | Start using useful profile evidence after the first qualified watch. Do not require an arbitrary number of watched videos or profile clusters.                                                                                       |
| R5  | Profile recommendations have first priority. Apply eligibility, canonical deduplication, and viewing-history policy before counting them. Curated candidates fill only the remaining positions.                                      |
| R6  | Web requests six videos. Expose a bounded count parameter for other clients. Six is a coverage requirement; a short/empty row is not an accepted normal inventory fallback.                                                          |
| R7  | Have a start pool plus a small set of interest pools per supported playback language. Pools contain reserves beyond the displayed count, with mostly accessible shorts and some full-film options where inventory supports that mix. |
| R8  | Curate once through the delegated Codex agent. No monthly AI worker, recurring AI review, or monthly model-spend budget. A future algorithm/script may update list versions using measured popularity.                               |
| R9  | Use versioned, inspectable curated data, validation before publication, and rollback to the prior version. Normal production deployment rules apply.                                                                                 |
| R10 | Suppress recently completed videos and penalize partially watched videos. The exact bounded recent-completion policy and its compatibility with six-card language coverage remain a planning decision.                               |
| R11 | Render one finite For you row below Browse by category on Web. No homepage orchestration, infinite feed, or native UI work.                                                                                                          |
| R12 | Refresh when returning to or reloading the homepage. Preserve card order while the viewer browses the current page.                                                                                                                  |
| R13 | Open the complete video through normal Watch navigation/playback; matched scenes do not trigger seeking.                                                                                                                             |
| R14 | Record viewing outcomes and update the same profile so later homepage visits reflect useful viewing evidence. Other Watch entry paths continue contributing through source-neutral playback.                                         |
| R15 | Measure whether displayed recommendations lead to qualified viewing, separately for returning/profile-backed viewers and cold starts. Clicks are supporting evidence only.                                                           |
| R16 | Preserve existing video-seeded recommendations, playback availability, privacy boundaries, and bounded request latency.                                                                                                              |

### Acceptance examples

- **AE1:** A returning viewer has six eligible profile candidates after filtering.
  The response contains those six and no curated substitutions.
- **AE2:** Four eligible profile candidates remain. The API preserves their order
  and appends two distinct eligible curated candidates in the selected language.
- **AE3:** A new viewer has no useful profile. The API returns six eligible
  curated starters in the selected playback language.
- **AE4:** A viewer watches a recommendation meaningfully, returns home, and a new
  request can use the updated profile. Cards do not move on the already-open page.
- **AE5:** A cookie-free client stores its opaque viewer handle, records playback,
  and later obtains recommendations from the same install profile. A separate
  install starts independently, even if the human is the same.
- **AE6:** A completed or duplicate video is removed before deciding how many
  curated positions to fill. A partial watch incurs a penalty, not an automatic
  completed-video exclusion.
- **AE7:** Invalid curated references, unavailable dubs, duplicate stories, or
  missing artwork cannot pass publication validation merely to reach six.
- **AE8:** A temporary recommendation-service failure leaves the rest of the
  homepage usable; the row exposes a restrained retry state instead of claiming
  an incomplete response satisfies the six-card requirement.

## Existing implementation and research

- `apps/admin/src/graphql/queries/recommendation-delivery.ts` and
  `apps/admin/src/services/recommendations/delivery.types.ts` require `seedMediaId`.
  The delivery service's semantic baseline is also a prerequisite for its hybrid
  path. Removing a GraphQL argument alone does not create source-free delivery.
- `apps/admin/src/services/recommendations/profile.service.ts` already looks up
  `RecommendationProfile.tokenDigest` and checks receipts, expiry, and privacy
  generations. The current Web adapter owns opaque cookies. This is reusable
  identity/profile infrastructure, not a new account-history model.
- `apps/admin/src/services/recommendations/caller.ts` currently accepts consumer
  bearers but rejects `fleet === true`. Native personalized delivery therefore
  needs explicit caller-policy work, not just API documentation.
- `apps/admin/src/services/recommendations/candidates/profile-candidate.service.ts`
  queries published interest vectors. Its source-video usage includes exclusions
  for the seed and its relations. Preserve those exclusions for seeded requests;
  omit them deliberately for user-context requests.
- `apps/admin/src/services/recommendations/profiles/projection.ts` represents four
  durable interest clusters plus session intent. These are vector clusters, not
  named editorial topics. Do not replace that representation with curated labels.
- `RecommendationRequest.seedMediaId` is required in
  `apps/admin/prisma/schema.prisma`. Playback episode/outcome models already
  permit source-neutral lineage. Request persistence, admission, capability
  bindings, and trace readers must understand the new request purpose.
- `apps/admin/src/services/recommendations/recent-context.service.ts` bounds its
  current seven-day context to 24 videos, eight sessions, and 32 request roots per
  session. Its signals are served/selected/started; this does not already satisfy
  source-neutral completed/partial-watch suppression.
- `WatchHomeExperiencePage.tsx` renders authored and legacy compatibility category
  rails. The new slot must be inserted exactly once in both paths, without
  introducing an authored recommendation-block dependency.
- Relevant merged work: [PR 1976](https://github.com/Jesusfilm/forge/pull/1976)
  established hybrid delivery; [PR 2131](https://github.com/Jesusfilm/forge/pull/2131)
  added direct profile delivery;
  [PR 2155](https://github.com/Jesusfilm/forge/pull/2155) added source-neutral
  playback; [PR 2182](https://github.com/Jesusfilm/forge/pull/2182) tightened
  eligibility; [PR 2214](https://github.com/Jesusfilm/forge/pull/2214) addressed
  retrieval within the existing deadline. Reconcile with current main before
  implementation: this research checkout predates some merged fixes.
- The historical July catalog audit and September recommendation analytics are
  inputs to feat-476, not proof of current all-language eligibility or monthly
  popularity. UI message catalogs and playback languages are different inventories.

### Patterns to preserve

- `docs/solutions/architecture-patterns/production-recommendation-boundary-hardening-pattern.md`
  — persist the exact issued slate, enforce generation/lifecycle boundaries, and
  prevent telemetry from blocking playback.
- `docs/solutions/performance-issues/semantic-recommendation-retrieval-bounded-pgvector-fanout.md`
  — bounded set-based retrieval within the shared 1.5-second Admin budget.
- `docs/solutions/ui-bugs/watch-recommendation-consent-refresh-in-flight-admission-race.md`
  — abort/fence obsolete requests when identity or personalization state changes.
- `apps/web/CLAUDE.md` — private same-origin recommendation routes; no viewer
  secrets or delivery capabilities in URLs, rendered HTML, or persistent JS storage.

## Technical decisions

### API and identity

Add a versioned user-recommendation operation alongside existing seeded delivery.
Use a generic full-video item shape: media identity, title, artwork, duration,
playback language, canonical destination, position, and delivery capability.
Matched-scene metadata is optional and does not control homepage playback. Do not
invent scene indexes or similarity scores for editorial candidates to satisfy
the old scene-oriented response type.

Use an opaque viewer token, not an account ID or a caller-selected database ID.
The shared identity boundary resolves tokens into the existing server-owned
profile/receipt/session context. Web continues transporting tokens through its
HttpOnly cookie adapter. Native consumers can persist the opaque handle and send
it in request bodies through the documented consumer API; they need not create
cookies, hashes, or internal consent-receipt records themselves.

Bootstrap, expiry/rotation, reset, delivery, and playback feedback must all work
without cookies. Accept properly authenticated supported consumer clients,
including native fleet callers, without treating a fleet key or `x-viewer-id`
alone as authority to read a viewer's profile. Keep identity resolution separate
from ranking so future account association can be introduced at that boundary.
No account association is implemented now.

Preserve an existing personalization opt-out through bootstrap and token renewal:
it may receive generic curated recommendations, but must not silently regain
durable profile collection or history access. An anonymous new viewer follows
the existing default-on behavior. Keep viewer identity separate from operational
session identity so a renewed session does not discard the install's profile.

The proposed count bound is 1–20, default 6; it is a resource bound, not a claim
that every language currently supports every count after exclusions. The coverage
audit must establish the supported response/count behavior before finalizing the
public contract. Never silently clamp malformed or out-of-range counts.

### Profile-first composition

1. Resolve viewer/session context, selected playback language, and UI locale.
2. Retrieve a bounded overfetch from the existing profile-vector candidate source.
   A current source video and a successful semantic-seed slate are unnecessary.
3. Apply mutable eligibility, canonical identity deduplication, recent-completion
   exclusions, and partial-watch ranking penalties.
4. Preserve the first requested number of eligible profile results. If enough
   exist, curated pools contribute zero items.
5. Fill only missing positions from relevant interest pools, then the language's
   start pool, continuing past overlaps/ineligible entries until filled or the
   validated inventory bound is exhausted. Deduplicate across the entire result.
6. Persist and issue the exact final ordered slate with source/pool-version
   attribution, then return full-video navigation targets.

Select interest pools through curated media-to-theme membership and available
profile evidence. If the profile cannot be mapped reliably, use the start pool.
This avoids claiming that embedding-cluster ordinals are topic names. Keep the
mapping private; the row does not label or diagnose the viewer's interests.

Reserve time for the curated path within the existing delivery deadline. A
profile retrieval timeout must not consume the entire budget before fallback
begins. Public pool lookups may be cached by version/language; assembled viewer
responses remain private/no-store and cannot enter a shared homepage cache.

### Curated data contract

The curation output supplies a version, source snapshot provenance, canonical
language identity plus playback slug, stable pool keys (`start` or interest),
ordered Core video IDs, and rationale/theme membership metadata. Core IDs are
import identities; resolve them to actual Admin canonical media IDs before use.

Admin owns immutable validated pool generations and an active-generation pointer.
Use a small dedicated data model and importer rather than repurposing human
authored homepage collections or the existing global strategy-control pointer.
Validate bounded shape, known IDs, canonical uniqueness, eligible language/dubs,
publication, restrictions, artwork, and required coverage before activation.
Publish the generation atomically and retain the prior version for rollback.
The same validator can accept a future script-produced generation; no scheduler,
agent runtime, or popularity algorithm is included now.

Use the serving identity rules when measuring coverage. Distinct standalone
segments of one film can be separate candidates; film-family diversity is a
preference, not a rule that collapses an entire film's clips into one video.
Alternate cuts, identical-title duplicates, and applicable embedding duplicates
still require the existing canonical deduplication checks.

The exact persisted table names and JSON representation are implementation
choices. The invariant is that curation replacement is a validated data change
and does not require modifying the recommendation ranking algorithm.

### Six-card coverage and viewing history

The user's requirement is sufficient supply, not accepting an empty/short row as
normal behavior. Count distinct currently eligible videos in the union of the
language's relevant pools; summing overlapping list lengths is invalid.

The completed Core-only pass produced 208 editorial choices, 203 starters, and
five interest themes. Its version is `2026-09-10.astra-editorial.v1`; status is
`draft-core-only`. The measured denominator is 2,313 Core language identities
with observed published-HLS inventory, not the confirmed selectable Admin
language inventory. Of those, 2,276 have at least 30 draft starters, six have
6–29, and 31 have fewer than six. The final 31 comprise 29 sparse-source
identities and two identities sharing the ambiguous `lala` slug. Five additional
Core identities have no observed published-HLS inventory. See
`docs/recommendations/curation/2026-09-10/coverage-report.md` and
`language-coverage.csv` in that directory for exact identities and evidence.

No candidates have yet passed current Admin validation: the available public
Admin endpoint returned HTTP 403. Resolve authoritative IDs, locale/dub
eligibility, restrictions, artwork, and localized/embedding deduplication before
treating any of these source counts as production coverage. Most language pools
rely on distinct scenes from the same film, so film-family diversity remains a
flexible preference as agreed.

A sufficient coverage condition is at least `requested count + maximum excluded
distinct videos` available in the reserve union, after other hard exclusions.
For example, 30 candidates can cover six positions with at most 24 completed-video
exclusions; this is a planning calculation, not an assertion about the catalog.
Profile/curated overlap does not create extra supply.

Finalize a bounded completion window/count using the current ledger conventions
and measured language inventory. Include source-neutral Watch outcomes, not just
recommendation clicks. Use current valid outcome revisions and owned profile
links; reset/revocation must invalidate access. Qualification and completion are
separate facts: meaningful viewing does not imply finishing a video, and seeking
to its end must not count as qualified consumption by itself.

**Open coverage gate:** feat-476 must establish actual distinct coverage by
language. If a supported language cannot meet the supply/exclusion/count
condition, surface that concrete gap. Do not silently allow completed repeats,
switch language, duplicate a title, or shrink/hide the row as the normal policy.
The user has not approved those exceptions. A product decision is required only
if the measured constraints cannot be satisfied; more pool names alone are not
a resolution.

## Implementation units

### U1. Cookie-independent viewer identity and public contract

**Goal:** Let Web and native clients resolve one independent anonymous profile
using the same supported API. **Requirements:** R1–R3, R6, R16; AE5.
**Dependencies:** None; reconcile current main first.

**Files:** Existing `apps/admin/src/services/recommendations/caller.ts`,
`profile.service.ts`, `token.service.ts`, their colocated tests,
`apps/admin/src/graphql/mutations/recommendation-profile.ts`, and
`apps/web/src/lib/recommendation-session.ts`. Proposed
`apps/admin/src/services/recommendations/viewer-identity.service.ts` and
`viewer-identity.service.test.ts`; new GraphQL query
`apps/admin/src/graphql/queries/user-recommendations.ts` and
`user-recommendations.test.ts`. Register types/fields in
`apps/admin/src/graphql/schema.ts`; regenerate `apps/admin/schema.graphql` and
`packages/admin-graphql/src/admin-graphql-env.d.ts`.

**Approach:** Preserve internal digest/receipt checks behind one transport
adapter. Add server-owned bootstrap and token validation for cookie-free clients,
retain existing Web identities, and document response versions/count bounds.
Keep seeded query semantics unchanged. Extend native caller authorization
narrowly across the complete identity/delivery/feedback lifecycle.

**Test scenarios:** AE5 with no Cookie header; separate installs stay separate;
Web profile survives upgrade; expired/reset/tampered tokens cannot address an old
profile; opt-out is not undone by bootstrap/renewal; session renewal preserves
the same install profile; fleet key alone cannot select another profile; count boundaries and
missing source video; existing seeded clients still receive their old contract.

**Verification:** A generated typed consumer can bootstrap, request, and reset
without browser facilities. GraphQL drift checks pass; no hand-edited generated
types or raw profile vectors cross the API.

### U2. Versioned curated pools and publication validation

**Goal:** Make feat-476 output a reusable, inspectable server-owned candidate
source. **Requirements:** R7–R9, R16; AE7. **Dependencies:** feat-476 contract;
final publication also requires its validated coverage report.

**Files:** `apps/admin/prisma/schema.prisma` and an additive migration;
proposed `apps/admin/src/services/recommendations/curated-pools.service.ts`,
`curated-pools.service.test.ts`, `curated-pools.service.db.test.ts`,
`apps/admin/scripts/import-recommendation-pools.ts`; the agent-owned artifact
directory is input, not modified by this unit without coordination.

**Approach:** Validate/import immutable language/pool generations, resolve Core
identities in Admin, and switch a dedicated pointer atomically. Keep rationale
inspectable through an authorized report/read path and a documented rollback
operation. Recheck mutable eligibility at serving time; do not require transcript
embeddings merely to serve an editorially approved playable video.

**Test scenarios:** Unknown and duplicate Core IDs; duplicate story/edition
variants; unpublished or restricted targets; wrong-language dub; missing artwork;
overlapping interest/start pools; insufficient unique reserve; rejected import
leaves current version active; rollback restores prior order and provenance.

**Verification:** Real-DB import/rollback round trip and all supported-language
coverage results, with failed languages explicit. No agent job or scheduler added.

### U3. Source-free delivery and exact fallback filling

**Goal:** Return a full ranked list from the profile and only fill shortages with
curated content. **Requirements:** R1, R4–R7, R16; AE1–AE3, AE6.
**Dependencies:** U1, U2; viewing-history policy from U4.

**Files:** Existing `apps/admin/src/services/recommendations/delivery.types.ts`,
`candidates/profile-candidate.service.ts`, `candidate.ts`, `contracts.ts`,
`admission.ts`, `token.service.ts`, and relevant colocated tests. Proposed
`user-delivery.service.ts`, `user-delivery.service.test.ts`,
`user-delivery.service.db.test.ts` in that service directory.
`apps/admin/prisma/schema.prisma` plus an additive nullable-seed/purpose migration.

**Approach:** Model seeded and user-context requests explicitly; old rows remain
seeded, new user requests have a null source. Keep purpose, surface, count,
language, pool generation, and profile generation in appropriate admission/cache/
capability bindings. Reuse profile retrieval with deliberate optional exclusions,
eligibility, canonical targets, and exact issued-slate persistence. Audit
seed-dependent trace readers, retention, evaluation, and token validators.

**Test scenarios:** AE1–AE3 after duplicates/completed/unplayable filtering;
fallback overlap requires advancing further into reserves; no seed/semantic
dependency; one useful profile interest; profile timeout still leaves time for
curated fill; reset/version changes fence stale results; mixed old/new request
rows remain readable; signatures bind the actual ordered returned items.

**Verification:** Real-DB user-context retrieval and migration fixtures;
seeded-delivery regression checks; default-six requests fit the existing Admin
budget under representative profile and cold-start data, with bounded count
scaling rather than wider timeouts.

### U4. Qualified viewing, completion context, and profile freshness

**Goal:** Use actual viewing to improve later recommendations and apply the
agreed history policy. **Requirements:** R4, R10, R13–R15; AE4–AE6.
**Dependencies:** U1 and the resolved coverage/history bound; integrate with U3.

**Files:** `apps/admin/src/services/recommendations/recent-context.service.ts`,
`recent-context.service.test.ts`, `recent-context.db.test.ts`,
`episode.service.ts`, `outcome.service.ts`,
`profiles/profile-projection.service.ts` and their existing tests;
`apps/admin/src/graphql/mutations/recommendation-evidence.ts` and
`recommendation-evidence.test.ts` (playback context, claim, and facts);
`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`
and `RecommendationPlaybackRecorder.test.tsx`.

**Approach:** Extend the bounded history read to authoritative source-neutral
completion/partial-watch evidence. Preserve existing classifier/integrity
eligibility, late revisions, idempotency, privacy generation, and background
projection behavior. Do not promote an unqualified proxy or rewrite the global
learning policy simply to make the first homepage request look personalized.
When the first qualified outcome is not projected yet, use curated fill and
allow the next homepage request to pick up the published profile.

**Test scenarios:** Meaningful first watch triggers usable projection when
eligible; start/click/seek alone does not; completed versus partial watch;
direct/search/share arrivals contribute; duplicate/late events and superseded
outcomes do not double-count; reset during projection prevents stale publication;
cookie-free clients can submit the same supported playback lifecycle.

**Verification:** An integration flow from playback claim/facts through qualified
outcome and projection changes later delivery; raw or incomplete evidence cannot
bypass existing integrity gates.

### U5. Web homepage row and navigation lifecycle

**Goal:** Ship the agreed Web surface without changing homepage caching or
playback startup. **Requirements:** R3, R6, R11–R14, R16; AE4, AE8.
**Dependencies:** U1, U3, U4.

**Files:** `apps/web/src/components/home/WatchHomeExperiencePage.tsx`,
`WatchHomeExperiencePage.test.tsx`, `WatchHomePage.tsx` and its existing tests;
proposed `apps/web/src/components/recommendations/WatchForYouRecommendations.tsx`
and `WatchForYouRecommendations.test.tsx`;
`apps/web/src/lib/recommendations.ts`,
proposed `apps/web/src/app/api/recommendations/for-you/route.ts` and `route.test.ts`;
existing recommendation select/evidence/playback route owners; supported
`apps/web/messages/*.json` catalogs and relevant generated locale tooling.

**Approach:** Insert exactly one lazy client-owned row after the category rail
for authored and compatibility home paths. Inspect nested category blocks before
choosing insertion logic; do not append only after a top-level block if that
places the row after the intro. If a homepage variant lacks a category block,
provide a deterministic route-owned placement adjacent to the category/intro
boundary and cover it explicitly.

Use private same-origin Web routes and the existing identity shell. Add localized
For you/loading/retry copy through established catalog tooling. Reuse card sizing,
navigation, impression eligibility, and selection handoff. Reserve row geometry
to avoid late layout shifts, load thumbnails lazily, and keep the list finite.
Use full-video canonical destinations with the exact selected playback language.

Refetch on route return/reload and bfcache restoration. Abort or ignore obsolete
requests on unmount, language change, or profile reset. Do not reshuffle on tab
focus, a background playback event, or each preference update while browsing.
Preserve current profile settings and the absence of a first-visit banner.

**Test scenarios:** Six cards immediately below category and before intro;
authored, nested, compatibility, and missing-category paths; cold/profile/mixed
responses; stable order while mounted; fresh request on return/reload/bfcache;
out-of-order response and identity reset; non-English destinations; keyboard and
touch interaction; slow/failing API preserves homepage usability; playback opens
at the normal full-video start rather than matched-scene time.

**Verification:** Browser playback-to-home proof, responsive screenshots, and
comparison of homepage LCP/CLS, route timing, and network loading against baseline.
Recommendations do not make the RSC page private or block hero/player startup.

### U6. Measurement, consumer documentation, and activation

**Goal:** Make delivery quality and native consumption verifiable.
**Requirements:** R2, R9, R15, R16. **Dependencies:** U1–U5 and feat-476 coverage.

**Files:** `docs/operations/semantic-recommendation-tracer.md`; proposed
`docs/operations/user-recommendations.md`;
`apps/admin/src/services/recommendations/admin-ops/` request/detail/report owners
and their colocated tests; this plan and the feat-477 ticket.

**Approach:** Record request cohort at delivery time (no useful profile versus
profile-backed), actual profile/curated counts, pool version, selections, visible
impressions, qualified outcomes, and latency/coverage failures. Preserve
attribution through selection to source-neutral playback; do not fabricate a
source video for home. Reporting must account for returned-to-home repeat
requests and late outcomes. Do not treat session-key cardinality as people or
claim causal lift without an experiment.

Document cookie-free bootstrap, storage/rotation/reset, count, language, delivery,
selection, and playback examples using the generated contract. Preserve opaque
tokens outside URLs/logs. Activate only after real eligibility/coverage checks,
schema/codegen/CI validation, browser and performance proof, and a rollback path.
Rollback disables only the new row/delivery activation and restores the prior
pool generation; seeded recommendations and playback remain available.

**Test scenarios:** Homepage impressions and selected qualified watches reconcile
by cold/profile cohort and pool version; reset tokens are rejected; old seeded
requests remain interpretable; rollback preserves ordinary Watch use; documented
cookie-free examples pass contract validation.

**Verification:** Focused service/DB/GraphQL/Web tests, generated artifact drift,
format/lint/typecheck for touched packages, production-shaped latency proof, and
an inspectable cohort/coverage report. Do not mark the ticket complete while
required language coverage or consumer lifecycle verification is missing.

## Sequencing and boundaries

U1 and U2 can progress independently; the curation agent supplies U2's data.
U4 determines the history inputs used by U3. U5 follows stable delivery and
feedback contracts. U6 finishes integration and activation evidence. Keep data
curation and application ownership separate even though both feed the same
feature. No production operation is authorized by a draft artifact alone.

### Deferred

- Algorithmic monthly popularity generation and any recurring curation process.
- Cross-device account/profile linking and identity merging.
- Mobile/TV surfaces and their app-specific storage/UI integration.
- Multi-row homepage orchestration (feat-449), a comprehensive catalog graph, and
  global recommendation-strategy or experiment-policy redesign.
- A new curation management UI; an inspectable report/import/rollback path is
  sufficient for this one-time release.

## Remaining decisions and validation gates

1. **Coverage and completion:** Validate the 31 Core identities below six and the
   six identities with 6–29 starters against actual supported Admin languages and
   inventory. Reconcile canonical count, reserve depth, the API count bound, and
   maximum recent-completed exclusions using that authoritative result. No
   shorter-row or rewatch exception is approved. This is the only remaining
   product/feasibility gate from grilling; repeating the curation pass will not
   by itself resolve missing inventory or ambiguous language identity.
2. **Authoritative eligibility:** Public Core data is an editorial source. Current
   Admin publication, restrictions, effective playback, and artwork require an
   authorized read-only validation/import environment before production readiness.
3. **Implementation base:** Use current main without overwriting existing local
   work. Reconcile source-neutral playback and latency fixes before implementation.
4. **Execution details:** Final table/helper names, SQL/index shape, exact partial
   penalty, and UI spacing are implementation choices within these contracts.

No application implementation or application tests have run as part of writing
this draft. The plan is reviewable; coverage-dependent activation is unresolved.

## Draft review

A sequential document review checked coherence, feasibility, product scope,
design, identity security, and failure cases. It clarified opt-out/session
continuity, distinguished film-family diversity from actual video deduplication,
and corrected the playback mutation entry point. The remaining decision is the
coverage/history/count condition above; it has not been converted into an
unapproved rewatch or short-row policy. Production-shaped data and performance
validation belong to implementation, not this document review.
