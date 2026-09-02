---
title: Source-Neutral Playback Learning - Plan
type: feat
date: 2026-09-02
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Source-Neutral Playback Learning - Plan

## Goal Capsule

- **Objective:** Every eligible Watch arrival can produce trustworthy active-playback evidence that improves an authorized recommendation profile without changing playback availability or privacy choices.
- **Means:** Extend the existing recommendation episode, fact, outcome, integrity, and projection pipeline around a source-neutral Playback Context instead of creating a parallel telemetry system. (KTD1)
- **Authority:** This plan and the current `main` behavior override stale feat-447 and feat-369 wording about cookie banners, shadow cohorts, experiment assignments, or promotion gates.
- **Execution profile:** Cross-app schema migration, Admin GraphQL and workflows, Web recorder integration, privacy-safe operations UI, real PostgreSQL proof, and browser verification.
- **Stop conditions:** Do not deploy, mutate production data, change recommendation retrieval or ranking, or include the embedding-projection follow-ups tracked by issues 2141-2148.
- **Tail ownership:** The implementation run closes feat-447 only after evidence, completes feat-369, updates the roadmap, commits, pushes, opens a pull request, and watches required checks until merge-ready.

---

## Product Contract

### Summary

The Watch player will open a bounded source-neutral playback context after the player is available, record exact foreground-playing intervals and supporting facts through the existing fail-open telemetry path, and finalize revisioned outcomes in Admin. Recommendation attribution becomes optional provenance rather than a prerequisite for an episode. Eligible outcomes from direct, search, share, acquisition, editorial, and recommendation arrivals can feed the same consent-authorized profile projection. Admin gains privacy-safe trace and aggregate readiness evidence for the proxy while the existing semantic recommendation baseline and direct profile delivery remain unchanged.

### Problem Frame

Main already serves semantic recommendations to every visitor and directly uses authorized multi-interest profiles without shadow assignment or promotion. It also has durable, replay-safe playback facts and revisioned active-watch outcomes, but an episode can start only from a recommendation selection because every episode, fact, and outcome requires recommendation request and item lineage. Direct and other Watch arrivals therefore cannot produce the same learning evidence, which biases profile feedback toward one acquisition path and leaves the active-playback proxy without source-neutral operational proof.

Feat-447 still describes launch gates that no longer match deployed behavior. It must be closed from merged implementation and focused verification evidence, not by restoring removed consent UI or reintroducing obsolete experiment requirements.

### Key Decisions

- **Current main is the product authority** (session-settled: user-directed — chosen over restoring the old cookie-banner and experiment-gated wording: the deployed direct-profile behavior is intentional). Governs R1, R12, R13.
- **Playback evidence is source-neutral** (session-settled: user-directed — chosen over recommendation-only attribution: learning must reflect eligible Watch behavior regardless of arrival source). Governs R2, R3, R7.
- **Telemetry is never a player dependency** (session-settled: user-directed — chosen over synchronous context issuance before playback: evidence loss is preferable to playback delay or failure). Governs R4, R5.
- **Embedding projection follow-ups stay separate** (session-settled: user-directed — chosen over folding issues 2141-2148 into this pull request: the requested slice is active-playback learning). Governs R14.

### Requirements

**Closeout and current behavior**

- R1. Close feat-447 only after merged-code evidence and focused Admin/Web verification show contextual availability, direct authorized profile delivery, privacy-safe evidence, and the repaired lifecycle; rewrite stale ticket language before setting it complete.
- R2. Preserve the current exact-six semantic baseline, semantic fallback, direct/default-on profile use, and existing privacy UX without adding a shadow assignment, experiment, promotion, or cookie-banner prerequisite.

**Playback context and observation**

- R3. Every eligible full Watch player arrival may open one immutable bounded playback context whose non-authoritative provenance class is one of `recommendation`, `search`, `share`, `acquisition`, `editorial`, or `direct`; missing or ambiguous provenance resolves to `direct`, and provenance never changes eligibility or learning weight.
- R4. Context issuance and fact delivery occur after player availability and fail open, so network, Admin, workflow, or telemetry-control failures never delay, gate, stop, or replace playback.
- R5. The active-watch proxy counts only the union of exact intervals during which the media is playing and the document is visible; pauses, seeks, background time, previews, and duplicate or overlapping intervals add no active time.
- R6. Context issuance and fact ingestion remain admission-controlled, bounded, capability-bound, idempotent by stable event identity and payload digest, server-sequenced under concurrency, tolerant of valid reordering, and limited by active and hard horizons.
- R7. Finalization publishes immutable classifier revisions bound to the exact fact watermark and input digest; a late valid fact can supersede an earlier revision, while replay, stale generation, or lower watermark cannot become current.

**Learning and privacy**

- R8. Current integrity policy classifies finalized playback outcomes without requiring recommendation lineage or trusting provenance, and eligible source-neutral outcomes can contribute to the same session or durable profile projection under active consent and privacy-generation fences.
- R9. Projection rebuilds are deterministic from current eligible evidence, replace superseded outcome contributions without double counting, and erase or fence all influence after consent withdrawal, reset, deletion, or generation change.
- R10. Raw contexts, capabilities, facts, outcomes, and trace links expire within the existing 29-day evidence window and hard 30-day purge SLA; detached access audits retain sanitized reason/time evidence for 90 days, privacy-fenced derived profile generations follow the existing 180-day lifecycle, and aggregate proxy evaluations retain no viewer, session, request, item, or profile identity for 365 days.
- R11. Browser and Admin boundaries never persist or expose raw cookies, tokens, capabilities, URLs, referrers, search text, IP addresses, user IDs, profile IDs, vectors, or reconstructable viewing histories; Web sends only bounded provenance class plus approved opaque lineage that Admin immediately validates or digests.

**Operations and proof**

- R12. Authorized Admin readers can inspect one context's provenance class, bounded episode facts, reconstructed active intervals, finalization state, revisions, eligibility, lag, and purge posture; aggregate readers see only cohorts of at least ten episodes, missingness, revision behavior, classifier comparison, and readiness.
- R13. Proxy readiness is an immutable aggregate-only offline evaluation with exact input window and watermarks; it can recommend `eligible_for_shadow_evaluation`, `revise`, `retire`, or `inconclusive`, but it cannot affect live retrieval, ranking, profile delivery, or fallback.
- R14. The pull request excludes issues 2141-2148 and makes no embedding, embedding-projection, candidate-retrieval, or ranking changes.
- R15. Real PostgreSQL tests prove clean migration and backfill, database constraints, concurrent ingestion/finalization, replay and revision behavior, retention, privacy fencing, and projection rebuild equality; Web tests and browser journeys prove all provenance classes and fail-open player behavior.

### Acceptance Examples

- AE1. **Covers R3-R7.** Given a direct Watch arrival with no handoff metadata, when playback is visible and playing across pause, seek, background, and resume transitions, then one direct context finalizes to the union of only the foreground-playing intervals and a retry produces no duplicate time.
- AE2. **Covers R3, R11.** Given a recommendation selection or a bounded search/editorial handoff, when Watch opens the target, then the stored context retains the approved provenance class and validated opaque lineage while no URL, referrer, query, capability, cookie, or profile identifier appears in storage or Admin output.
- AE3. **Covers R4.** Given context issuance or fact posting fails or hangs, when a viewer starts Watch playback, then the player becomes available and continues normally while the recorder drops or retries evidence within its bounded in-memory lifecycle.
- AE4. **Covers R7-R9.** Given a finalized qualified outcome already influenced an authorized profile, when a valid late fact produces a superseding non-qualified revision, then rebuild removes the old contribution and matches a clean replay from current evidence.
- AE5. **Covers R9-R11.** Given a profile privacy generation changes while projection work is queued, when the workflow resumes, then stale evidence cannot publish and retained operational records cannot relink the viewer.
- AE6. **Covers R12-R13.** Given authorized trace and aggregate readers, when they inspect the same playback cohort, then the trace reader sees bounded context detail with an access audit and the aggregate reader sees identity-free readiness evidence that has no serving authority.

### Success Criteria

- The player availability path has no await or conditional dependency on context issuance, fact ingestion, finalization, integrity classification, or projection work.
- Every supported provenance class has an executable Web-to-Admin test, and direct arrival is the safe default when provenance is absent or rejected.
- Real PostgreSQL verification demonstrates exact interval union, monotonic outcome revisions, concurrency safety, retention deletion, privacy-generation fencing, and rebuild equality.
- Admin evidence can explain why a proxy outcome was computed and whether the proxy is ready for a future shadow evaluation without exposing viewer identity or changing live delivery.

### Scope Boundaries

**In scope**

- Feat-447 evidence-based closeout and wording correction.
- Feat-369 source-neutral playback context, active interval capture, revisioned outcomes, eligible profile feedback, Admin evidence, retention, and proxy readiness.
- The smallest provenance handoffs needed for recommendation, search, share, acquisition, editorial, and direct Watch arrivals.

**Outside this product's identity**

- A general analytics platform, cross-device Watch history, raw referrer capture, session replay, or behavioral advertising profile.
- A live-serving gate controlled by the playback proxy readiness result.

### Deferred to Follow-Up Work

- Embedding and embedding-projection work tracked by issues 2141-2148.
- Any future shadow cohort, online proxy validation, or promotion decision that consumes the offline readiness recommendation.
- Native mobile or TV parity beyond preserving shared Admin contracts for later clients.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Evolve the existing evidence pipeline in place.** Add a `RecommendationPlaybackContext` root and make recommendation request, item, and selection lineage optional on the existing episode/fact/outcome chain. This preserves the mature sequence, replay, finalization, integrity, projection, and retention machinery and avoids two competing outcome definitions. Governs R3-R10.
- KTD2. **Make context identity the capability boundary.** New episode capabilities bind context, episode, session digest, media, generation, horizons, and signer identity. Recommendation handoff remains one-use optional attribution; direct and other arrivals receive the same bounded capability without a fabricated request. The existing client and aggregate Redis admission utility gains a `playback-context` namespace so fresh cookies, sessions, and event ids cannot create unbounded roots. Governs R3, R6, R11.
- KTD3. **Use bounded provenance handoffs, not browser history.** In-app surfaces place a short-lived class and approved opaque source reference in session memory. The Watch route validates or hashes it, recognizes only an allowlist, consumes it once, and defaults to `direct`; inbound share/acquisition classification emits only the bounded class before the context request. Provenance is explanatory metadata only: integrity, contribution weight, and profile publication never branch on it because a browser can forge it. Governs R3, R8, R11.
- KTD4. **Carry exact active interval endpoints in the playback contract.** The recorder closes a bounded interval whenever playing or document visibility changes and submits server-validated start/end timestamps. Admin unions endpoints before classification and continues to accept existing `activeMilliseconds` facts for migrated evidence. Governs R5-R7.
- KTD5. **Make the context the raw retention root.** Context deletion cascades episode facts, outcomes, eligibility, conflicts, and capability budgets; optional recommendation lineage detaches or is removed in the same bounded purge transaction. Derived profile contributions detach raw outcome lineage but stay inside the existing privacy-generation and 180-day projection lifecycle. Trace-access links clear atomically, while aggregate evaluations never carry context identity. Governs R10-R12.
- KTD6. **Read current outcomes through a source-neutral projection query.** Durable evidence joins active session links and privacy generations through the context session digest rather than recommendation requests. Only the current eligible `active-watch-proxy-v1` revision contributes, and publication retains the existing serializable generation/pointer fence. Governs R8-R9.
- KTD7. **Keep readiness offline, append-only, and policy-versioned.** A dedicated playback-proxy evaluation stores aggregate cohort counts, missingness, lag, revision rate, legacy/active comparison, exact watermarks, digest, decision, and supersedes lineage. The initial policy remains `inconclusive` below 50 finalized outcomes or below 10 outcomes in any non-empty duration cohort. Missingness below 95% active-coverage availability, p95 finalization lag above 15 minutes, conflict rate above 1%, revision rate above 10%, or operational-health failure recommends `revise`. A mature, complete window with at least 10 legacy-qualified outcomes and zero proxy-qualified outcomes recommends `retire`; other legacy disagreement is diagnostic rather than an automatic failure. Otherwise sufficient collection quality recommends `eligible_for_shadow_evaluation`. No request or delivery service reads this table. Governs R12-R13.
- KTD8. **Use a dedicated evidence control with partial rollback semantics.** The migration seeds source-neutral issuance disabled, and local verification enables it explicitly. Production activation is a separate operator action after every application instance runs the new context-aware code. Disabling issuance stops new contexts and facts but does not retract already-finalized outcomes or published profile generations; retention and erasure workflows continue. Web treats the disabled response as unavailable telemetry and leaves playback unchanged. Governs R4, R9-R10.
- KTD9. **Make Admin evidence decision-first.** The recommendation overview leads with evidence health and the current readiness recommendation, followed by cohort distributions and a bounded recent-context list; context detail then shows chronology, interval reconstruction, revisions, eligibility, and lifecycle. Empty, insufficient, degraded, unauthorized, and healthy states remain distinct. Tables retain existing keyboard, heading, and responsive overflow patterns. Governs R12-R13.
- KTD10. **Bridge N-1 episode writers inside the database.** Migration 0072 installs a narrow trigger that materializes a recommendation-provenance context when an old writer inserts a recommendation episode without `context_id`. New code always supplies the context itself. The trigger remains through the rollback window and is removed only by a later contract migration after production proves no legacy writes. This permits a required `context_id` without breaking rolling deploys or old recommendation selection. Governs R2-R4, R6.

### High-Level Technical Design

The component flow separates player availability from evidence work and keeps every downstream step asynchronous.

```mermaid
flowchart TB
  Surface["Recommendation, search, share, acquisition, editorial, or direct surface"] --> Handoff["Bounded one-use provenance handoff"]
  Surface --> Player["Watch player available"]
  Player --> Playback["Playback continues independently"]
  Player -. "best effort after availability" .-> Route["Web playback route"]
  Handoff --> Route
  Route --> Context["Admin playback context and episode capability"]
  Context --> Facts["Ordered idempotent playback facts"]
  Facts --> Outcome["Revisioned active-watch outcome"]
  Outcome --> Integrity["Source-neutral integrity decision"]
  Integrity --> Projection["Consent-authorized profile projection"]
  Outcome --> Admin["Trace and aggregate evidence"]
  Outcome --> Readiness["Offline proxy evaluation"]
  Context --> Purge["29-day raw purge"]
  Admin --> Audit["90-day detached access audit"]
  Readiness --> AggregateRetention["365-day aggregate retention"]
```

The lifecycle has independent context, episode, outcome, and projection fences.

```mermaid
stateDiagram-v2
  [*] --> ContextIssued
  ContextIssued --> EpisodeClaimed
  ContextIssued --> Expired: claim horizon elapsed
  EpisodeClaimed --> FactsOpen
  FactsOpen --> FinalizationDue: terminal or active horizon
  FinalizationDue --> OutcomeCurrent
  OutcomeCurrent --> OutcomeSuperseded: valid higher fact watermark
  OutcomeSuperseded --> OutcomeCurrent
  OutcomeCurrent --> Eligible: integrity decision
  OutcomeCurrent --> Excluded: integrity decision
  Eligible --> Projected: active privacy generation
  Eligible --> Fenced: consent or generation changed
  Projected --> Fenced: consent or generation changed
  ContextIssued --> Purged: retention deadline
  FactsOpen --> Purged: retention deadline
  OutcomeCurrent --> Purged: retention deadline
  Fenced --> Purged: retention deadline
```

The provenance decision never inspects arbitrary navigation data.

```mermaid
flowchart TB
  A["Context request after player availability"] --> B{"Valid one-use in-app handoff?"}
  B -->|yes| C["Use allowlisted class and validated opaque lineage"]
  B -->|no| D{"Bounded inbound share or acquisition marker?"}
  D -->|yes| E["Use share or acquisition class only"]
  D -->|no| F["Use direct"]
  C --> G["Persist immutable context"]
  E --> G
  F --> G
```

### Assumptions

- The current Web player exposes stable playing, pause, seeking, ended, error, and document-visibility signals; exact event wiring can adapt during implementation without changing R5.
- Existing recommendation trace permissions can be split into trace-detail and aggregate playback readers without introducing a new authentication system.
- Search and editorial surfaces have stable public opaque identifiers that can be validated or immediately digested; if one surface lacks such an identifier, its provenance class remains useful without lineage detail.
- The existing 29-day request lifecycle, 90-day access-audit lifecycle, 365-day aggregate-evaluation lifecycle, and 24-hour purge propagation objective are the authoritative retention tiers.

### System-Wide Impact

- **Data model:** A forward-only migration backfills one context for each existing episode, relaxes recommendation lineage, adds context-root constraints, and introduces aggregate proxy evaluations.
- **Privacy:** Consent does not govern collection of bounded operational playback facts, but it governs durable profile influence. Withdrawal and reset must erase influence even when raw operational evidence remains until its independent expiry.
- **Performance:** Player startup is unchanged. Context issuance, facts, workflows, and projections use bounded best-effort work after availability.
- **Operations:** Rollback stops new evidence production only. Retention, privacy erasure, and historical Admin evidence remain active until their lifecycle completes.
- **Compatibility:** Existing recommendation handoff and legacy position outcomes remain readable. New source-neutral tokens and interval payloads are versioned, and migration tests cover old database shapes.

### Operational and Rollout Notes

- Migration 0072 is expand-compatible with the prior application through KTD10; it does not require simultaneous instance replacement.
- The new evidence control remains disabled after schema and application deployment. Existing recommendation delivery and playback continue, while old and new recommendation selection writers remain valid.
- An operator may enable source-neutral issuance only after migration health, context backfill, new-instance saturation, Admin permissions, retention heartbeat, and local/staging browser evidence are confirmed. This implementation run does not perform that activation.
- Setting the control disabled is the application rollback for new evidence. It does not remove historical outcomes or profile generations; privacy erasure and all lifecycle workflows stay enabled.

### Risks and Mitigations

| Risk                                                | Consequence                                                    | Mitigation                                                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Relaxing request lineage weakens database integrity | Facts or outcomes could claim unrelated recommendation credit  | Make context lineage immutable, add conditional SQL constraints and triggers, and prove invalid combinations against real PostgreSQL |
| Visibility and media events race                    | Active time could be overcounted or duplicated                 | Close intervals on every boundary, cap interval duration, union endpoints server-side, and test overlap/reorder/background cases     |
| Late revisions leave stale profile influence        | A profile can retain a contribution that is no longer eligible | Query only current revisions, version source digests, rebuild under a serializable pointer fence, and prove clean-replay equality    |
| Direct contexts increase evidence volume            | Retention lag or fact cardinality can grow                     | Keep one bounded context per player instance, preserve fact budgets, index due/expiry paths, and expose aggregate lag/missingness    |
| Source labels become covert identifiers             | Admin could reconstruct navigation history                     | Store only an enum and approved digest, reject free text, never render digests to aggregate readers, and audit detail access         |
| Evidence rollback is misunderstood                  | Operators may expect old profile generations to disappear      | Document partial rollback semantics and keep privacy erasure plus retention active while issuance is disabled                        |

### Sources and Existing Patterns

- `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` owns the original U2 behavior and U30 closeout intent.
- `docs/roadmap/content-discovery/feat-369-recommendation-playback-episodes-active-playback.md` defines the active-playback measurement slice; `docs/roadmap/content-discovery/feat-447-live-anonymous-profile-personalization-pilot.md` records the stale closeout gates.
- `apps/admin/src/services/recommendations/playback.service.ts` and `outcome.service.ts` provide bounded fact ingestion, advisory locking, exact watermarks, and append-only finalization.
- `apps/admin/src/services/recommendations/profiles/profile-projection.service.ts` provides current-eligibility reads, deterministic contribution lineage, and serializable publication fences.
- `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx` provides fail-open serialized delivery and foreground-playing observation.
- `docs/solutions/architecture-patterns/production-recommendation-boundary-hardening-pattern.md` provides the production boundary, retry, migration-repair, and Admin evidence patterns.
- Merged pull requests 1976, 2131, 2132, 2133, 2135, 2136, and 2137 are the merged-code evidence for the feat-447 wording correction and direct-profile behavior.

---

## Implementation Units

### U1. Close feat-447 from current-main evidence

- **Goal:** Replace obsolete launch gates with evidence for the shipped contextual and direct-profile system, then mark the ticket complete only after the focused verification passes.
- **Requirements:** R1-R2.
- **Dependencies:** None.
- **Files:** `docs/roadmap/content-discovery/feat-447-live-anonymous-profile-personalization-pilot.md`, generated roadmap output, and relevant existing Admin and Web recommendation tests.
- **Approach:**
  1. Build an evidence matrix from the merged pull requests and current test ownership without mutating production.
  2. Rewrite the ticket's expected state and resolution around current main, removing cookie-banner, shadow-assignment, experiment-promotion, and production-snapshot prerequisites that are no longer authoritative.
  3. Run the smallest reliable contextual, profile, privacy, bootstrap, and lifecycle tests before changing the ticket status.
  4. Defer roadmap regeneration until feat-369 also reaches its evidence gate.
- **Patterns to follow:** Completed ticket resolution sections and generated roadmap workflow in repository instructions.
- **Test scenarios:**
  - Existing contextual delivery returns the complete bounded slate for a visitor without a profile.
  - An authorized profile is linked before selection, receives eligible feedback, and is used directly without assignment or promotion.
  - Privacy withdrawal or reset fences the stale projection and keeps raw identifiers out of the trace.
  - First profile bootstrap and cold-start delivery remain available under render-order and stale-projection races.
- **Verification:** The ticket cites merged implementation and passing focused tests, says no production mutation was performed, and has no remaining gate that contradicts current main.

### U2. Introduce the source-neutral playback context schema

- **Goal:** Make a playback context the immutable raw evidence root while preserving optional recommendation attribution and existing episode history.
- **Requirements:** R3, R6-R7, R10-R11, R15.
- **Dependencies:** U1.
- **Files:** `apps/admin/prisma/schema.prisma`, a new `apps/admin/prisma/migrations/0072_*` migration, `apps/admin/src/services/recommendations/migration*.db.test.ts`, `apps/admin/src/services/recommendations/snapshot-repair.db.test.ts`, generated Prisma client artifacts.
- **Approach:**
  1. Add the context and aggregate evaluation models, enums, expiry indexes, immutable provenance fields, optional recommendation lineage, and trace-access link.
  2. Backfill one recommendation-provenance context for every existing episode before making `context_id` required.
  3. Install KTD10's N-1 writer bridge before making `context_id` required, and prove old nested recommendation selection can still create a valid episode.
  4. Relax request/item/selection fields only where conditional constraints preserve all-or-none lineage and cross-row media/session consistency.
  5. Re-root capability budgets, conflicts, facts, outcomes, and purge cascades on context while keeping request detail attribution available when present.
  6. Add forward-repair coverage for historical schemas through migration 0071.
- **Execution note:** Start with failing real-PostgreSQL migration and invariant tests; mocks cannot prove the conditional foreign keys, triggers, backfill, or cascade order.
- **Patterns to follow:** Migrations 0052, 0053, 0066-0068 and `apps/admin/src/services/recommendations/migration.db.test.ts`.
- **Test scenarios:**
  - A database at migration 0071 backfills every existing episode with one recommendation context and preserves all fact and outcome counts.
  - The pre-0072 selection writer inserts an episode without a context field and the database bridge creates one valid immutable recommendation context.
  - A direct context accepts no recommendation lineage while a recommendation context requires a consistent request, item, selection, session, and media tuple.
  - Mixed or partially populated lineage, mutated provenance, mismatched media, and cross-context facts fail at the database boundary.
  - Context deletion cascades raw descendants and clears trace-access links while aggregate evaluation rows remain unlinked.
  - Concurrent attempts cannot open two active contexts for the same player-instance idempotency key.
- **Verification:** Clean and historical-shape migrations apply on real PostgreSQL, Prisma generation is current, and invalid lineage cannot be inserted through raw SQL.

### U3. Issue contexts and ingest exact active intervals in Admin

- **Goal:** Provide one source-neutral capability protocol from context issuance through ordered facts and revisioned finalization.
- **Requirements:** R3-R8, R11, R15.
- **Dependencies:** U2.
- **Files:** `apps/admin/src/services/recommendations/contracts.ts`, `token.service.ts`, `episode.service.ts`, a playback-context service, `playback.service.ts`, `outcome.service.ts`, GraphQL recommendation-evidence types and mutations, finalization job/workflow files, and their unit and database tests.
- **Approach:**
  1. Add a versioned context-issuance mutation that validates caller, media, session digest, provenance, optional one-use recommendation handoff, idempotency key, admission receipt, and evidence control.
  2. Sign context-bound episode capabilities after the transaction commits and preserve deterministic replay within the active horizon.
  3. Extend active facts with bounded interval endpoints, validate clock/horizon/order constraints, and keep compatibility with existing active-duration payloads.
  4. Update ingestion, submission budgets, conflicts, audits, and finalization to use context identity and optional request attribution.
  5. Publish exact-watermark legacy and active revisions under the existing serializable/advisory lock and dispatch integrity/profile work without awaiting it.
- **Patterns to follow:** Existing selection claim, `RecommendationPlaybackService`, `RecommendationOutcomeService`, and workflow recovery scan.
- **Test scenarios:**
  - Each allowed provenance class issues the same context-bound capability shape; invalid free text and mismatched recommendation handoffs are rejected.
  - Fresh cookies, sessions, or idempotency keys cannot bypass the client and aggregate context-issuance admission budgets.
  - Repeating the issuance idempotency key returns the same bounded episode, while a changed payload conflicts.
  - Duplicate facts replay, changed payloads conflict, and concurrent batches reserve one monotonic sequence without exceeding budgets.
  - Overlapping, adjacent, reordered, duplicate, pause-separated, seek-separated, and background-separated interval facts produce the exact union.
  - Terminal and horizon finalization race to one current revision per classifier; a higher valid watermark supersedes and a lower watermark cannot publish.
  - Evidence control off rejects new issuance and facts but does not block finalization, retention, erasure, or already-published profile reads.
  - The migration-seeded control is disabled, and enabling it in a disposable database is an explicit versioned transition rather than an implicit deploy side effect.
- **Verification:** Unit tests prove contract boundaries, and real PostgreSQL concurrency tests prove issuance, ingestion, finalization, replay, and revision invariants.

### U4. Capture every eligible Watch arrival without blocking playback

- **Goal:** Open the context after player availability, classify bounded provenance, and submit exact foreground-playing intervals for all eligible Watch arrivals.
- **Requirements:** R3-R6, R11, R15.
- **Dependencies:** U3.
- **Files:** `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx` and fixtures/tests, `apps/web/src/app/api/recommendations/playback/route.ts` and tests, `apps/web/src/lib/recommendation-mutation-admission.ts` and tests, recommendation/search/editorial link helpers and call sites, Watch page integration, and browser test support.
- **Approach:**
  1. Replace recommendation-only claim startup with a context request that consumes optional one-use provenance and defaults to direct.
  2. Keep capability and context state in component memory and request bodies only; keep provenance handoff short-lived in session storage and clear it after one attempt.
  3. Start evidence work only after the player object is available and swallow issuance, post, timeout, and disabled-control failures.
  4. Track playing plus document visibility as an interval state machine, close intervals on pause, seek, hide, end, error, route exit, and unmount, and resume without treating a hidden tab as terminal.
  5. Instrument representative search and multiple editorial recommendation surfaces through one helper; classify inbound share/acquisition using bounded allowlisted markers without persisting the source URL.
- **Execution note:** Preserve and extend recorder characterization coverage before changing visibility and terminal behavior.
- **Patterns to follow:** Existing serialized sender, stable event ids, terminal reservation, keepalive exit path, and recommendation correlation helper.
- **Test scenarios:**
  - Direct Watch arrival opens one context and records playback without any recommendation session handoff.
  - Recommendation, search, share, acquisition, and at least two editorial surfaces send the expected bounded class and consume the handoff once.
  - Preview playback produces no context facts until full-player initiation is eligible.
  - Hidden playback closes active time without finalizing; visible resumed playback opens a new interval; pause and seek add no time.
  - Context issuance delayed, failed, disabled, or rejected leaves player creation and playback events unaffected.
  - Rate-limited or unavailable admission returns bounded telemetry-unavailable responses and never changes player state.
  - Capabilities never appear in URL, DOM, local storage, session storage, console output, or referrer, and free-form provenance is never sent.
- **Verification:** Focused Web tests cover the state machine and route, and browser journeys demonstrate uninterrupted playback plus each provenance class.

### U5. Project source-neutral eligible outcomes with privacy fences

- **Goal:** Let current qualified outcomes from any provenance improve an authorized profile and rebuild exactly after revision or privacy changes.
- **Requirements:** R8-R10, R15.
- **Dependencies:** U3.
- **Files:** `apps/admin/src/services/recommendations/integrity.service.ts`, `integrity-policy.ts`, `profiles/profile-projection.service.ts`, profile feedback workflow/job files, privacy/retention services, and related unit/database tests.
- **Approach:**
  1. Classify playback outcomes from context actor/session/media evidence and apply a recommendation rollback fence only when optional recommendation lineage exists.
  2. Load current durable outcomes through active profile session links and context session digests, independent of recommendation request or selection joins.
  3. Keep outcome classifier, integrity policy, privacy generation, expiry, and current-revision checks in contribution lineage.
  4. Dispatch profile feedback after eligible outcome publication and coalesce by committed server watermark without blocking finalization or playback.
  5. Extend withdrawal/reset/deletion and retention paths to erase source-neutral contribution influence and fence queued publication.
- **Execution note:** Treat rebuild equality and revocation races as real-PostgreSQL integration behavior.
- **Patterns to follow:** Existing integrity current-decision transaction, `loadDatabaseProfileProjectionEvidence`, projection generation pointer, and profile privacy erasure.
- **Test scenarios:**
  - A qualified direct outcome and a qualified recommendation outcome have identical eligibility and projection weight under the same actor/integrity inputs.
  - An excluded or superseded outcome never contributes even when an older generation contains its source id.
  - A late superseding revision replaces rather than adds influence, and incremental rebuild equals clean replay.
  - Withdrawal, reset, deletion, expired session link, and privacy-generation race prevent stale publication and remove prior contribution influence.
  - A profile-free session projection can use current-session playback context without creating durable identity.
- **Verification:** Real PostgreSQL tests compare incremental and clean projections byte-for-byte and prove current revision plus privacy-generation fences under concurrent publication.

### U6. Add privacy-safe Admin trace, readiness, and retention evidence

- **Goal:** Make source-neutral playback evidence inspectable and operationally governable without giving offline proxy evaluations serving authority.
- **Requirements:** R10-R13, R15.
- **Dependencies:** U2, U3, U5.
- **Files:** Admin recommendation operations services/types/mappers/tests, dashboard recommendation pages/components, retention service/job/workflow/tests, playback-proxy evaluation service/workflow/tests, `docs/operations/semantic-recommendation-tracer.md`, Admin schema and generated GraphQL client artifacts.
- **Approach:**
  1. Add permission-gated context list/detail reads with actor-digested access audits and redacted provenance presentation.
  2. Show ordered facts, reconstructed intervals, current and historical revisions, eligibility, projection influence state, lag, and expiry in the detail view.
  3. Add the KTD9 overview hierarchy and aggregate cohort panels for provenance, duration, coverage, missingness, classifier lag, revision rate, legacy/active disagreement, and retention health; suppress cohorts below R12's display floor.
  4. Compute append-only proxy evaluations from finalized aggregate inputs with exact watermarks, digest, decision reason codes, and 365-day expiry.
  5. Purge expired contexts in bounded advisory-locked batches, detach audits, delete expired aggregate rows, and surface overdue health after the run.
  6. Document the lifecycle matrix, permissions, partial rollback, recovery scan, readiness interpretation, and privacy exclusions.
- **Patterns to follow:** Existing request detail audit, overview aggregate readers, semantic control evaluation, retention workflow, and tracer runbook.
- **Test scenarios:**
  - Unauthorized and aggregate-only readers cannot access context detail; an authorized detail read writes one sanitized 90-day audit.
  - Empty, insufficient, degraded, and healthy overview states have distinct text, headings, and next actions without relying on color alone.
  - Detail output contains no session digest, raw lineage digest, profile id, token, cookie, URL, referrer, query, IP, user id, or vector.
  - Equal readiness inputs replay, higher watermarks append one superseding revision, and the evaluation is absent from all delivery/profile-serving queries.
  - Sparse or lagged cohorts return `inconclusive`; materially divergent cohorts return `revise` or `retire`; sufficient bounded evidence can return `eligible_for_shadow_evaluation`.
  - Retention deletes expired direct and attributed contexts within the batch, clears access links, preserves detached audit evidence, and reports overdue roots.
- **Verification:** Service and component tests prove authorization/redaction, real PostgreSQL proves evaluation and purge invariants, and the runbook matches the implemented lifecycle.

### U7. Complete end-to-end verification and project closeout

- **Goal:** Prove the full source-neutral learning loop, update generated project tracking, and leave a review-ready pull request with no unrelated embedding work.
- **Requirements:** R1-R15.
- **Dependencies:** U1-U6.
- **Files:** Browser/e2e tests and evidence artifacts allowed by repo conventions, `docs/roadmap/content-discovery/feat-369-recommendation-playback-episodes-active-playback.md`, generated roadmap output, generated Admin/Web GraphQL artifacts, and any test snapshots changed by the implementation.
- **Approach:**
  1. Run the focused Web/Admin tests during development, then real PostgreSQL integration suites, schema generation, formatting, lint, type checks, and affected builds.
  2. Drive browser journeys for direct, recommendation, search, share/acquisition, and editorial arrivals; confirm playback availability, active interval behavior, Admin detail, aggregate readiness, and absence of secrets.
  3. Perform simplification and two-axis code review, fix all P0/P1 findings and justified lower-severity correctness or privacy findings, then rerun affected gates.
  4. Record feat-369 resolution evidence, mark it complete only after the gate passes, regenerate and lint the roadmap, and confirm feat-447 remains evidence-backed.
  5. Verify the final diff excludes issues 2141-2148, production mutations, deployment changes, and abandoned experiments before commit and pull request creation.
- **Patterns to follow:** Repository ticket/roadmap closeout workflow, recommendation browser verification in PR 1976, and the LFG review/commit/PR tail.
- **Test scenarios:**
  - A direct authorized viewer produces a qualified outcome, profile generation advances, and a later recommendation request can use the updated profile without assignment or promotion.
  - A no-profile viewer and every other provenance class produce source-neutral outcomes without durable profile identity.
  - Telemetry disabled and Admin unavailable journeys preserve playback and existing recommendation availability.
  - Browser inspection finds no capability or prohibited identifier in DOM, storage, URL, referrer, console, or Admin output.
  - Full migration/retention/rebuild tests pass against a disposable real PostgreSQL database from the fresh worktree.
- **Verification:** Both tickets are complete with evidence, the generated roadmap is clean, all required gates pass, review has no unresolved P0/P1 findings, and the pull request reports the exact verification and privacy posture.

---

## Verification Contract

| Gate                          | Units          | Command or evidence                                                                                                                                                         | Done signal                                                                                                                 |
| ----------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Prisma and GraphQL generation | U2, U3, U6     | `pnpm --filter @forge/admin db:generate`, Admin schema print/generation, and Web Admin-GraphQL generation                                                                   | Generated schema and clients match source with no uncommitted regeneration diff                                             |
| Admin focused unit tests      | U1, U3, U5, U6 | `pnpm --filter @forge/admin test -- <affected recommendation test files>`                                                                                                   | Context, playback, outcome, integrity, projection, Admin ops, retention, and readiness tests pass                           |
| Real PostgreSQL integration   | U2, U3, U5, U6 | `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm --filter @forge/admin test -- <affected *.db.test.ts files>`                                      | Migration/backfill, constraints, concurrency, replay, revision, retention, privacy, and rebuild equality pass on PostgreSQL |
| Web focused tests             | U4             | `pnpm --filter @forge/web test -- <affected playback route, recorder, and provenance tests>`                                                                                | All provenance, state-machine, fail-open, and secret-containment cases pass                                                 |
| Redis admission integration   | U3, U4         | Existing recommendation mutation admission unit tests plus its real Redis integration test when Redis is available                                                          | Context issuance shares bounded client and aggregate budgets and fails closed to telemetry without affecting playback       |
| Static quality                | U2-U7          | Repository formatting, `pnpm --filter @forge/admin lint`, `pnpm --filter @forge/admin typecheck`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck` | No format, lint, or type errors in affected workspaces                                                                      |
| Builds                        | U3-U7          | `pnpm --filter @forge/admin build` and `pnpm --filter @forge/web build` when environment prerequisites are available                                                        | Production builds and recommendation workflow verification pass, or an external prerequisite is reported precisely          |
| Browser journeys              | U4, U6, U7     | Real browser against disposable local Admin/Web/PostgreSQL with direct, recommendation, search, share/acquisition, and editorial entry paths                                | Playback never waits for telemetry; exact evidence and redaction are visible in authorized Admin views                      |
| Ticket and roadmap            | U1, U7         | Ticket resolution checks plus repository roadmap generate/lint commands                                                                                                     | Feat-447 and feat-369 are complete only after evidence, and generated roadmap output is current                             |
| Review and scope audit        | U7             | Simplification, standards/spec review, final diff inspection                                                                                                                | No unresolved P0/P1 findings, no prohibited identifiers, no production mutation, and no issue 2141-2148 implementation      |

---

## Definition of Done

- U1 is done when feat-447 describes and cites current merged behavior, focused verification passes, and its complete status is evidence-based.
- U2 is done when migration 0072 applies from clean and historical PostgreSQL shapes, backfills without evidence loss, and conditional lineage constraints reject invalid raw SQL.
- U3 is done when all provenance classes can issue the same context-bound protocol and concurrent facts/finalization converge on exact monotonic revisions.
- U4 is done when every eligible Watch arrival records exact foreground-playing intervals after player availability and every telemetry failure is demonstrably fail-open.
- U5 is done when qualified source-neutral outcomes influence only the active authorized profile generation and incremental rebuild equals a clean replay after revision or revocation.
- U6 is done when authorized Admin evidence explains trace and aggregate behavior, lifecycle tiers purge correctly, and readiness has no serving authority or viewer identity.
- U7 is done when required unit, PostgreSQL, generation, static, build, and browser gates pass; both tickets and the roadmap are current; and the pull request is merge-ready.
- The final diff contains no deployment or production-data mutation, no embedding-projection follow-up work, no stale generated files, no debug logging or secret-bearing fixtures, and no code from abandoned implementation attempts.
