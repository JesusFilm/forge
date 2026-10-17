---
id: "feat-743"
title: "Grow course story and durable account progress"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 10
depends_on:
  - "feat-742"
blocks:
  - "feat-744"
tags:
  - "web"
  - "auth"
  - "graphql"
---

## Problem

Deliver stage 5 of the six-stage audience stack. The prototype is evidence only; this ticket records the implemented scope and verification.
The governing scope, product requirements, technical decisions, verification and completion contract are in [2026-10-17-0010-feat-watch-audience-stack-plan](../../plans/2026-10-17-0010-feat-watch-audience-stack-plan.md).
This ticket covers U8, U9, U10 only; keep a separate PR whose base is the preceding stage PR.

## Entry Points — Read These First

1. `docs/plans/2026-10-17-0010-feat-watch-audience-stack-plan.md`: Goal Capsule, Product Contract, this stage's U-IDs, Verification Contract and Definition of Done.
2. `AGENTS.md`, `CLAUDE.md`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`; also Admin/Auth/typed-client guides when touched.
3. `docs/analytics-and-recommendation-policy.md`: configured telemetry, accepted coverage, and current enablement policy.
4. `apps/admin/prisma/schema.prisma`: current pattern or planned addition named by the unit.
5. `apps/admin/prisma/migrations/`: current pattern or planned addition named by the unit.
6. `apps/admin/src/services/watch-learning-progress.service.ts`: current pattern or planned addition named by the unit.
7. `apps/admin/src/services/watch-learning-progress.service.test.ts`: current pattern or planned addition named by the unit.
8. `apps/admin/src/services/watch-learning-progress.service.db.test.ts`: current pattern or planned addition named by the unit.
9. `apps/admin/src/graphql/types/watch-learning-progress.ts`: current pattern or planned addition named by the unit.

## Grep These

- `U8.`
- `U9.`
- `U10.`
- `WatchSectionRenderer|WatchHomeExperiencePage|WEB_USER_PRINCIPAL|watchSetting|watchAudience`

## What To Build

### U8. Account-owned learning progress backend

**Goal:** Add durable learning state with enforceable subject ownership.

**Requirements:** R8, R12; KTD8–KTD9.

**Dependencies:** U6's real identity integration.

**Files:** Modify `apps/admin/prisma/schema.prisma`, add one forward-only migration under `apps/admin/prisma/migrations/`; new `apps/admin/src/services/watch-learning-progress.service.ts`, `apps/admin/src/services/watch-learning-progress.service.test.ts`, `apps/admin/src/services/watch-learning-progress.service.db.test.ts`, `apps/admin/src/graphql/types/watch-learning-progress.ts`, `apps/admin/src/graphql/types/watch-learning-progress.test.ts`; modify `apps/admin/src/auth/permissions.ts`, `apps/admin/src/graphql/context.ts`, `apps/admin/src/graphql/schema.ts`; regenerate SDL/introspection; new `apps/web/src/lib/watch-learning-progress.ts`, `apps/web/src/lib/watch-learning-progress.test.ts`, `apps/web/src/app/api/learning-progress/route.ts`, `apps/web/src/app/api/learning-progress/route.test.ts`; extend `apps/auth/src/services/account-deletion.service.ts` and its tests, plus the existing Admin account-deletion erasure seam.

**Approach:** Implement KTD8–KTD9 with validated known course/version/lesson/step IDs and bounded structured payloads, without arbitrary free text or userId arguments. Add own-data permissions only, and cover principal distinctions. GET/POST/DELETE are dynamic private/no-store; Web checks same-origin mutation requests and forwards the verified user's token to Admin using a request-scoped client. Integrate learning erasure transactionally with the existing account deletion path. Deleting progress and deleting an Auth account must not resurrect stale in-flight state.

**Execution note:** Start with cross-user and reset/conflict integration cases before wiring UI.

**Test scenarios:**

1. User A saves and reads their lesson; user B, anonymous, Consumer Bearer and unrelated editorial principal cannot read or mutate A's record.
2. Inactive/expired/wrong-client/wrong-environment tokens and cross-origin mutations are denied.
3. Same expected revision racing twice yields one update and one explicit conflict; a stale pre-reset write cannot recreate reset progress.
4. Unknown course/version/step and oversized state are rejected without a partial write.
5. Database errors return an actionable failure rather than empty successful progress.
6. Account deletion removes learning records with the existing erasure contract; failure does not claim full deletion.

**Verification:** Real isolated DB and checked-token GraphQL → Web route integration prove ownership, persistence, conflict and erasure. Security review explicitly approves the additive own-data permission set.

### U9. Grow content and course definition

**Goal:** Port useful Grow content with accurate provenance and no simulated community.

**Requirements:** R8, R10–R11; KTD10.

**Dependencies:** U2; content work can run alongside U8.

**Files:** New `apps/web/src/components/watch/WatchGrow.tsx`, `apps/web/src/components/watch/WatchGrowPlans.tsx`, `apps/web/src/components/watch/WatchGrowCourse.tsx`, `apps/web/src/components/watch/WatchGrowPrayer.tsx`, colocated tests, `apps/web/src/lib/watch-grow-content.ts`, `apps/web/src/lib/watch-grow-content.test.ts`, `apps/web/src/lib/beginning-with-jesus.ts`, `apps/web/src/lib/beginning-with-jesus.test.ts`.

**Approach:** Port nine lessons from the source-backed prototype into versioned stable lesson/movement/step IDs. Keep plans as real external destinations and prayer as dated guides with attribution. Lesson first view explains its benefit. Use an accessible lesson sheet for all lessons. Keep draft reflection text browser-local with a clear label; use the same draft store in sheet and story. Source images use `next/image`, current approved hosts, and optimized derivatives. Do not port generated presence/counts, fake answers, group join, sponsor claims, or notification promises.

**Test scenarios:**

1. All nine lessons have stable IDs, benefits, valid source references and usable lesson navigation.
2. An anonymous visitor opens course and prayer without a login wall.
3. A September guide remains labelled September in October and links to its actual source.
4. A missing/failed external image or optional guide leaves readable content and a working source hub.
5. Local reflection drafts are labelled device-only and contain no fabricated social response.

**Verification:** Content/source audit plus responsive sheet behavior; no unrequested subscription, prayer or group submission.

### U10. Lesson story and durable progress integration

**Goal:** Deliver the demonstrated 26-card lesson-1 experience with honest saved progress.

**Requirements:** R8, R10–R12; AE4; KTD9–KTD10.

**Dependencies:** U8, U9.

**Files:** New `apps/web/src/components/watch/WatchGrowStory.tsx`, `apps/web/src/components/watch/WatchGrowStory.test.tsx`, `apps/web/src/lib/watch-learning-progress-client.ts`, `apps/web/src/lib/watch-learning-progress-client.test.tsx`, `apps/web/e2e/watch-grow-progress.spec.ts`; integrate `apps/web/src/components/watch/WatchGrowCourse.tsx`.

**Approach:** Use a real modal/dialog portal with focus containment, Escape and restored body scroll. Acquire shared Watch modal activity at open intent, before lazy content resolves, and release through the existing close lifecycle; never add dialog-local player resume logic. Keep all 26 semantic cards and both story/sheet edit views against shared draft/progress adapters. Persist structured progress only after signed-in changes; debounce resume writes within the active session, flush safely on close, and visibly report save failures/conflicts. Versioned step identity maps stored progress; unknown retired steps are ignored without marking new content complete. Explicit completion is independent of navigation or a timer. While anonymous, label progress as unsaved and offer the existing hosted sign-in only when the visitor asks to save; a safe return restores the same lesson/card without automatically completing it. Require a fresh explicit save/completion action after verified sign-in. Cancelling login returns to the open lesson with no saved-progress claim.

**Test scenarios:**

1. Covers AE4. Card 1 explains benefit; all 26 cards can be reached; card 26 alone creates no completion.
2. Story/sheet draft edits agree, but account progress sync never sends free-text drafts.
3. Escape/close returns focus and scroll; arrows do not intercept typing; reduced motion and 390px layout stay usable.
4. A second signed-in device resumes saved progress; sign-out/account switch drops the old user's cached state and ignores late responses.
5. Offline/error state keeps visible unsaved progress and offers retry, never a false Saved label.
6. Concurrent/reset/content-version conflicts follow KTD9 and cannot silently complete or erase another version's lesson.
7. Anonymous save intent offers real sign-in; success returns to the same lesson/card and requires explicit confirmation, while cancellation leaves navigation usable and progress visibly unsaved.

**Verification:** Real signed-in two-context browser proof, persistence after reload, modal accessibility, and initial-load plus story-mount performance evidence.

## Constraints

The linked plan governs all KTDs and R-IDs cited above. Preserve the original dirty prototype and recovery outputs. No production migration, live content publication, merge or deployment. No simulated authentication/community or new paid inference route. Before delegation run `agent-quota`; before every worktree/branch, fetch/install/build or broad test use `agent-io-guard -- <foreground command>` and never bypass or nest it. Retain existing auth/download/SEO/language/analytics contracts.

## Verification

Use the linked Verification Contract and the unit-specific scenarios above. Record real behavior, cross-layer checks where applicable, and a page-load comparison against the preceding stack parent. Run formatter and applicable lint/typecheck/build/schema drift checks before PR publication. Update this ticket to in-progress when implementation starts and complete only after the scoped implementation and checks finish; completion does not claim deployment.

## Learning token and erasure rollout

Auth's `AUTH_WATCH_LEARNING_ERASURE_REQUIRED` defaults to false so parallel Auth/Admin deployments preserve account deletion against a legacy successful receiver. Explicit refusal, network failure and non-2xx responses still abort. After the additive Admin migration and learning-erasure acknowledgement receiver are verified, set the requirement to true before enabling saved learning. Configure Auth's `ADMIN_WATCH_PROGRESS_BASE_URL`/`ADMIN_WATCH_PROGRESS_API_KEY` against the receiver's existing `WATCH_PROGRESS_ADMIN_API_KEYS`; required mode rejects missing configuration before external side effects. Keep both the configuration and requirement active once learning data may exist, including after a public audience-flag rollback.

Receiver-first acknowledgement (2026-10-17): Auth's requirement is the explicit rollout setting `AUTH_WATCH_LEARNING_ERASURE_REQUIRED` (`.optional()`, default `false`), so the Auth code is safe to deploy before Admin. Auth always sends `reason: "account-deleted"`; network failures and non-2xx responses abort deletion in both modes, and an explicit `learningProgressErased: false` always aborts. With the setting `true`, missing erasure config aborts deletion before any side effect instead of skipping erasure; with it `false` (default), missing config keeps the legacy skip. With the setting `false`, a legacy 2xx that omits the acknowledgement completes deletion (logged as `account_deletion_learning_erasure_unacknowledged required=false`). Order: (1) deploy Admin with migration `0158` and the receiver, and verify a DELETE answers `learningProgressErased: true`; (2) set `AUTH_WATCH_LEARNING_ERASURE_REQUIRED=true` on Auth; (3) only then enable `forge.watch.audience` or saved learning. The setting is sticky privacy enforcement: never derive it from the public flag, and keep it `true` after a public rollback once learning data may exist. Cleanup stays available while the public flag is off or unreadable: Web's `DELETE /watch/api/learning-progress` (reset) and Admin's `resetMyWatchLearningProgress` are not gated (origin, verified subject, strict payload and revision checks still apply); GET/POST and Admin read/save stay gated. This supersedes the R2 note below that DELETE 404s while the gate is off.

Use Auth's dedicated `watch-user-data` resource for the same environment as the Web client (local: `http://localhost:3003/api/graphql`), derived from the Admin application registry. `AUTH_VALID_AUDIENCES` does not admit this flow. Link both the existing public Web PKCE client and a confidential Admin introspection client to it. Set Web's optional `WEB_AUTH_ADMIN_RESOURCE` to the same URI, plus Admin's existing introspection credentials, issuer, accepted client IDs and environment pin. Reuse `web:watch-events:write`; never make Web confidential or expose a browser bearer. Existing audienceless Web cookies need a fresh hosted sign-in. The audience rollout flag remains off by default; no production setting or data was changed by implementation.

## Demonstrated local verification

Isolated PostgreSQL integration, checked-token HTTP ownership/races/reset and real Auth deletion/erasure passed. All four Grow browser cases ran with genuine hosted Auth/PKCE identities (none skipped), including explicit save and a second device; additional browser checks passed for real conflict recovery, offline retry, reset, account switch, late-response discard and sign-out. Reflection text was absent from progress mutations. Web/Admin/Auth relevant tests, scoped lint/type checks, actual regenerated SDL/introspection and production Web build passed. Matched parent/candidate initial-load and deferred course/Story mount measurements passed at desktop/390px. Exact commands, logs, measurement corrections and the stage branch/base/head/file receipt are under `/home/lado/.local/share/forge-watch-stack-20261017/`. Parent owns final independent security/code review and shipping.

## Aborted deletion recovery

Admin erasure and Auth user-row deletion are separate transactions. An abort retains the Auth row but may already have erased progress and fenced further writes. Preserve the fence; never compensate automatically after a timeout. Follow `apps/auth/docs/watch-learning-erasure-recovery.md` for idempotent deletion retry or exceptional, quiesced recovery after withdrawal of the deletion request. The error and logs report uncertain Admin commit; regression proof preserves the fence and prevents user-row deletion on a lost response.

## Review regression verification (2026-10-17)

Review fixes: unresolved save/reset conflicts and failures stay disarmed through same-account rechecks until explicit choice/retry. POST/DELETE carry x-watch-learning-subject as a stale-session precondition, compared only with the verified server session; focus revalidation pauses writes. Token-less sessions report authenticated/unavailable progress and stale callbacks latch per subject. 89 focused cases and real equal-revision shared-cookie/delayed-session races passed. 35 Admin erasure tests, 53 Auth tests and 11 real progress DB cases passed. The learning DB CI suite enters at stage 5. Token-less browser loop proof uses exact response interception; production localhost legacy fallback is deliberately refused.

Detailed commands, red/green logs, real runtime proof, limits and six-stage reassembly receipts: `/home/lado/.local/share/forge-watch-stack-20261017/debug-review-r1/`.

## Round 2 review corrections (2026-10-17)

R2 corrections: GET/POST/DELETE fail closed with private/no-store 404 before session/Admin when the audience gate is off or unreadable. Identity revalidation now holds writes without replacing loaded state or re-reading same-account progress. Pending resume intent survives hold/pagehide and shows Saving until acknowledged; conflicts and failed writes require an explicit choice, including late resume timers. Older GET revisions cannot overwrite newer saves. Session reads time out with honest retry. Real hosted-auth races and rollback transport checks passed; the erasure fence and manual recovery contract are unchanged.

Exact red/green, integration, performance, stage replay and limitations receipts: `/home/lado/.local/share/forge-watch-stack-20261017/debug-review-r2/return-to-caller.json`. Parent owns final independent review and PR shipping.

R2 validation limit: the ten-sample mobile-home LCP median was 14.65% above the matched control, with unchanged initial request count, near-identical transferred bytes, +0.02% player-shell readiness and unchanged CLS. The changed initial bootstrap is identical after normalizing deferred chunk references; course/story chunks are absent from initial entry. The overlapping poster-paint mode frequencies differ. This remains visible for parent final review; no causal performance-clearance claim or unrelated product change is made. Exact original and expanded samples are retained.

## Round 3 concurrency repair (2026-10-17)

An explicit reset held during identity revalidation survives passive resume updates and a preceding save failure or conflict. Only the acknowledged POST may advance its own queued continuation; external revisions, account changes and DELETE acknowledgements cannot authorize replay. New regressions first failed with POST replacing DELETE, discarded resume intent and a lost reset choice. The repaired client passes all 48 owning cases, including both acknowledgement/release orders and explicit recovery choices.

The retained performance investigation clears frozen `0199bef` against both the R2 source control and immediate stage-5 parent with unchanged budgets. The original +14.65% mobile-home observation remains recorded; matched interleaving and React reveal traces establish unchanged scheduling modes, with pooled old/new +6.92%. These measurements do not claim to measure later repairs. Exact samples, interruptions, cache and attribution limits remain in `performance-r3/return-to-caller.json` under the external evidence root.

## Final validation harness correction (2026-10-17)

The course unit test waits for the lazy story DOM instead of sleeping 20ms. All existing story, account, resume, unsaved-state and focus assertions remain intact; product mount budgets are unchanged. The cold import exceeded the old arbitrary sleep under the parallel suite while the identical isolated test passed. The corrected 62 course/client cases and all 518 stage-5 Web cases pass. The external validation runner also uses the package's standard unit-test secrets, rather than injecting the live local preview secret into revalidation tests. No product authentication or runtime code changed.

## PR #2782 concurrency repair scope (2026-10-24)

Repair only `apps/web/src/lib/watch-learning-progress-client.ts` and focused
regressions in its owning test. Preserve the revision underlying edits held
while identity is unavailable; a newer independent read must require the
existing conflict choice. Reject mutation acknowledgements older than the
installed server state without clearing edits or authorizing queued saves or
resets. Cover both acknowledgement/release orders and retain account-switch,
sign-out, reset, retry and structured-only payload behavior. Validate owning
and adjacent progress/course tests, formatting, lint and Web typecheck under
`agent-io-guard` for broad/heavy commands.

Completed at reviewed head `022993aa05c5fc95ef483e4331d030ee8971c25b`.
Held edits now retain their original revision, including edits made while the
known account is unavailable. An independently newer read preserves local
intent, disarms automatic replay and exposes the existing explicit conflict
choice. Mutation acknowledgements cannot lower the installed revision or clear
newer intent. Invalidated operations relinquish their request slot before a
recovery choice, and late responses must still own that slot to affect state.
Only an owning successful POST can advance its own held continuation.

TDD reproduced nine failures for the two reported sequences, followed by two
failing recovery-ownership cases before the final repair. All 64 owning tests
and 166 tests across 11 adjacent progress/course/story/session/route files pass,
including both acknowledgement/release orders, stale DELETE acknowledgements,
account switch/sign-out and explicit recovery. Scoped Prettier, full Web lint
and Web typecheck pass on available Node 24.19.0 (repository pin: 24.22.1).
No wire fields, server CAS, rendering, hydration, media, routing or initialization
scheduling changed. An interleaved 50,000-load-per-version client initialization
comparison measured median 0.001434 ms before / 0.001443 ms after, with one GET
and zero mutations per initial account load in both versions. The minified
client module adds 154 gzip bytes. These are client initialization/resource
measurements, not browser LCP/CLS or a new full-stage performance clearance.
Commands, logs and samples are retained in `/tmp/forge-2782-validation/`.

Durable rule: a held edit's base revision is user-intent lineage, not a cache
hint. Refreshes and unrelated acknowledgements cannot rebase it; explicit
recovery or the owning successful POST establishes the next permitted lineage.

### Independent review round 2: resume lineage

Scope: at exact head `6da6b45194e67436a821988d27391b0909fcc559`, extend
held-edit lineage to `setResume` during identity checking/unavailability and
progress refresh. Reproduce stale completion replay first, then use the same
revision-bound deferral and existing explicit conflict recovery. Verify valid
resume continuation, response/release orders, account transitions, reset/retry
and stale acknowledgements. Keep this repair in the same client/test/ticket
scope; preserve structured-only CAS writes and initialization scheduling.

The resume updater now uses the known account holder and existing saved/armed
eligibility before checking availability. If identity or the progress read is
pending, it records the same revision-bound deferral used by explicit edits.
A newer independent revision exposes Keep mine / Use saved; an unchanged base
releases legitimate resume intent even when no local completion edit armed the
lesson. Refresh keeps a valid deferred operation visibly Saving until release
and acknowledgement. Ordinary resume debouncing and owning POST advancement
remain intact; no new state field, wire field or CAS behavior was introduced.

The exact-head red run reproduced 18 failures, including the four armed
checking/unavailable and read/release-order replay variants, missing conflicts
for unarmed lessons and stranded same-revision resume intent. All 118 owning
cases now pass, including 54 new resume cases. The standard Web test entry point
passed 220 tests across 11 progress/course/story/session/route files, UI locale
generation and all five Next cache-size guards. Full Web lint (including locale
drift), Web typecheck, scoped Prettier and the commit hooks pass. Recovery,
account switch/sign-out, held reset/retry, owning/stale acknowledgements and
navigation during a progress GET are covered; the prior blocker regressions
remain passing. Exact commands and logs: `/tmp/forge-2782-r2-validation/`.

Against `6da6b45194e67436a821988d27391b0909fcc559`, interleaved client
initialization/first-read measurements over 50,000 loads per version retained
one GET and zero mutations per load. Median cost was 0.001402 ms before /
0.001432 ms after; the minified module grows by 58 bytes, or 8 gzip bytes.
Rendering, hydration, routing, media, imports and initialization scheduling are
unchanged. These measurements cover client initialization/resources; browser
LCP/CLS and a full production build were not rerun for this state-machine repair.
Checks used available Node 24.19.0; the repository pins 24.22.1.

Durable extension: every updater that copies a whole lesson state must preserve
its revision lineage, including passive navigation. A valid deferred resume is
pending account work even when the lesson is unarmed; it must neither be
silently rebased nor stranded behind an Unsaved/Saved status.

### Independent review round 3: reset ownership

Repair only the progress client, owning regressions and this note, based on
`27a4d7ceea8a5bbc5f7c69d1cdf0ae99c5bd169c`. First reproduce GET erasing
pending reset retry intent and DELETE acknowledging away later explicit edits.
Keep a bounded reset intent separate from the transport lifetime: refresh may
update server knowledge but must preserve active/failed operation ownership;
only an owning reset success can reconcile edits made after its dispatch onto
its acknowledged revision. Pre-dispatch intent remains superseded by reset.
Audit read/acknowledgement/error/release ordering, queued operations, revision
monotonicity, manual recovery and identity teardown. Retain structured-only
payloads and all preceding lineage protections. Validate focused and adjacent
Web suites, full Web lint/typecheck/format, CI guards, initialization requests
and module size under `agent-io-guard` for heavy commands.

The client now keeps a dispatched reset's intent separate from its transport
slot. GET cannot clear its operation/retry marker or acknowledge later local
edits; a failed parallel GET cannot invalidate a still-pending mutation either.
A read of the reset's possible empty next revision waits for the owning DELETE
response. Independently newer state disarms replay; late responses cannot take
ownership back from explicit recovery. Retry retains DELETE, and repeated reset
clicks coalesce. Use saved retires the transport, timer and reset intent.

Updates after reset dispatch use its empty result as their base. The reset's
success consumes only pre-dispatch intent, then queues the later structured
edit/resume against its acknowledged revision. This includes navigation while
identity is checking/unavailable and edits retained across reset failure/retry.
They remain Saving until their own acknowledgement; old completion is never
copied into a resume-only continuation. Queued writes now use the existing
revision-bound operation queue instead of a generic send-again flag, preserving
a queued DELETE behind POST in both held and ordinary sessions. The queue and
reset intent each retain at most one state per lesson.

TDD first reproduced seven failures on the exact base for the two reported
sequences. All 244 owning tests pass, with 126 new cases including a 96-case
read/acknowledgement/release matrix over both identity states, edit/resume/both,
and older/same/possible-own/newer reads. Coverage also includes pre-dispatch
intent, post-dispatch edits, retry/conflict choices, queued/repeated resets,
failed GET, account switch/sign-out, stale/equal-inconsistent acknowledgements
and recovery operation ownership. Five older expectations that discarded
post-dispatch navigation now require its acknowledged position-only save; the
three earlier blocker regressions remain passing.

Validation passes: 346 tests across the 11 progress/course/story/session/route
files through the standard Web test entry point; locale generation and all five
Next cache-size guards; full Web lint with locale drift, Web typecheck, scoped
and full-repository Prettier, staged checks/hooks and `git diff --check`. Exact
commands and results are retained in `/tmp/forge-2782-r3-validation/` and
`/tmp/forge-2782-r3-validation.py`. Heavy commands ran under `agent-io-guard`.

An interleaved 50,000-load-per-version comparison against the required base
retains one GET and zero writes per initial load. Median client initialization
cost is 0.001467 ms before / 0.001409 ms after. The minified client module grows
by 691 bytes, or 167 gzip bytes. No request/wire contract, server CAS, rendering,
hydration, media, routing, import or initialization scheduling changes. These
measurements cover client initialization/resources, not browser LCP/CLS or a
full production build; those were not rerun for this state-machine-only repair.
Checks used available Node 24.19.0; the repository pins 24.22.1.

Durable ownership rule: a read is knowledge, not a mutation acknowledgement. A
reset owns only its pre-dispatch intent; later updates belong to its empty
successor and may continue only after the owning success or explicit recovery.
Transport retirement, retry intent and post-reset edits have distinct lifetimes.

### Independent review round 4: explicit intent versus displayed snapshots

Scope at `fb9dc77af44baadb919df5205dbceecd24c7f722`: reproduce the two
rendered-control blockers before editing the client. Record bounded per-field
intent rather than full post-reset/pre-read UI snapshots. Untouched fields must
inherit from the owning empty reset result or first authoritative read; later
independent revisions still require explicit conflict recovery. Audit toggles,
toggle-back, completion, resume, initial read failure/retry, reset ordering,
identity changes and stale responses. Preserve the five prior fixes and keep
this repair limited to the progress client, focused client/rendered tests and
this note. The unrelated recommendation integration timeout is outside scope.

The client now records bounded per-step/completion/resume deltas for the two
contexts whose authoritative baseline has not arrived. A control snapshot is
compared with its visible state to identify changed fields; unchanged checked
steps and completion never become post-reset intent. The owning DELETE's empty
result supplies untouched fields. Before the first GET, explicit deltas retain
the known account owner and are applied once to that authoritative read,
preserving unread steps, completion and resume. Explicit false/toggle-back
values remain meaningful. Unscoped drafts require explicit recovery; subsequent
independent revisions continue through the existing lineage/CAS conflict path.
No request schema, server CAS or free-text handling changes.

TDD reproduced six failures on the required base before the implementation,
including both rendered checkbox repros. All 700 owning tests and 16 rendered
course tests pass. The 456 new owning cases include a 252-case initial-read
matrix and 192-case reset matrix over empty/partial/completed baselines,
toggles/toggle-back, multiple steps, completion and resume, checking/unavailable
identity, read failures/retry and read/acknowledgement/release orders. Added
isolation cases pin account switch/sign-out, unscoped recovery, superseded GETs,
and stale POSTs after a consumed first-read delta. All five historical blocker
regressions remain green; existing reset retries, queued writes, conflict
choices and stale DELETE ownership tests continue passing.

Validation: 804 tests pass across the 11 progress/course/story/session/route
files through the standard Web test entry point, including locale generation
and all five Next cache-size guards. Full Web lint with `--max-warnings=0`, Web
typecheck, scoped Prettier, patched-dependency guards/tests, hidden-roadmap-lane
guards/tests, roadmap-ID/baseline tests and `git diff --check` pass. Active commit
hooks additionally run staged ESLint/Prettier, full-repository `format:check`
and conventional commit validation. Commands and evidence are retained in
`/tmp/forge-2782-r4-final-validation.py` and
`/tmp/forge-2782-r4-validation/`; heavy commands use `agent-io-guard`.

The interleaved 50,000-load-per-version comparison against the exact base
retains one GET and zero mutations per initial load. Median client initialization
is 0.001255 ms before / 0.001278 ms after; minified size is 11,756 / 12,676 bytes
(+920), gzip 4,075 / 4,354 bytes (+279). There are no new imports, rendering,
hydration, routing, media or initialization scheduling changes. This is a
client-resource/initialization comparison, not a browser LCP/CLS or production
build measurement. Checks used available Node 24.19.0 (repo pin: 24.22.1). The
unrelated recommendation DB integration timeout was not changed or rerun.

Durable intent rule: a displayed snapshot includes inherited state, so it is
not a delta. Record only explicit field changes until the owning baseline
arrives; consume that delta once, then preserve its established revision
lineage. Keep per-lesson intent bounded by known step IDs and release it on
acknowledgement, explicit Use saved or account teardown.

### Independent review round 5: queued lineage and held reset presentation

Scope at `70b2203b599e79c039db9229a89515458c0756ec`: inspect every
production progress-refresh call path before reproducing a queued resume against
an independent revision through the exported API. Reproduce confirming reset
while a focus/session recheck holds writes through rendered controls. Reuse the
revision-bound pending operation queue for debounced intent and make accepted
held operations visibly pending. Audit read/timer/release ordering, identity
teardown, failure/retry, conflict choices and stale responses; preserve all
seven prior blocker regressions. Changes stay within the progress client,
focused client/rendered tests and this existing repair note.

Reachability audit: `WatchGrowProgressCourse.tsx` calls exported `refresh()`
only from the failed-progress-load Try again control. Internal refreshes come
from `setAccount()` when identity/load needs checking and from `retry()` after
load failure. `useWatchAccountSession.ts` focus/visibility events set
`revalidating`; the course holds writes, then a same-account success calls
`setAccount()`/`release()` without a progress GET. A checking/unavailable
transition already pauses debounce into revision-bound intent before its later
GET. No production loaded-state caller reproducing the direct exported-refresh
ordering was found. New rendered tests use the real session hook and browser
focus events to prove both ordinary same-account behavior and unavailable /
checking / successful-session recovery. The exported API nevertheless must
preserve its contract and is now protected.

Before any progress refresh, the client pauses debounce timers into the same
revision-bound queue used for identity checks. An older/unchanged read can
release that intent against its original revision; an independent newer read
disarms it for explicit Keep mine / Use saved. An explicit refresh may release
an unchanged resume as soon as its GET finishes rather than waiting out the
remaining debounce; it sends at most one write. Ordinary successful focus still
adds no progress GET. No new state slots, request fields or wire contracts were
introduced.

All dispatch waits now register pending lineage and publish Saving together,
including a held reset without local checkbox changes. Queued resets retain
their operation marker across predecessor POST acknowledgements and GETs. A
failed GET is shown by load status; it cannot misclassify a not-yet-dispatched
DELETE as a failed mutation and strand the queue behind an extra Retry.
Unchanged-read recovery dispatches once; an independent revision still requires
an explicit conflict choice. Actual DELETE errors retain normal reset Retry.

TDD first reproduced three failures at the exact base: the exported queued
resume sequence, the missing held-reset emission, and rendered confirmation
during focus hold. Further tests reproduced two queued-reset ownership gaps
and failed-GET retry stranding before those fixes. The final suite passes 797
owning tests (+97), 20 rendered course tests (+4), and 905 total tests across the
11 relevant Web files. Added coverage includes a 72-case debounce/read/release
matrix, timers before/after GET, older/equal/own/newer revisions, edit + resume,
real focus/session wiring, held reset success/error/retry, queued save + reset,
failed GET recovery, Keep mine / Use saved, stale acknowledgements/GETs and
account switch/sign-out. All seven historical blocker regressions remain green.

Validation passes: standard Web test entry point with locale generation and all
five Next cache-size guards; full Web lint with `--max-warnings=0`, Web typecheck,
scoped Prettier, patched-dependency guards/tests, hidden-roadmap-lane
guards/tests, roadmap-ID/baseline tests and `git diff --check`. Active commit
hooks run staged ESLint/Prettier, full-repository `format:check` and conventional
commit validation. Exact commands and evidence are in
`/tmp/forge-2782-r5-final-validation.py` and
`/tmp/forge-2782-r5-validation/`; heavy operations use `agent-io-guard`.

Interleaved 50,000-load-per-version measurements against the exact base retain
one GET and zero mutations per initialization. Median client initialization is
0.001324 ms before / 0.001206 ms after. Minified module size is 12,676 / 12,718
bytes (+42), gzip 4,354 / 4,373 (+19). These are client initialization/resource
measurements, not browser LCP/CLS or a full production build; neither was rerun.
Checks used available Node 24.19.0 (repo pin: 24.22.1). The unrelated old-head
recommendation timeout and pending admin-schema-drift CI work are outside this
repair; no configuration, flags, content or production data changed.

Durable pending-operation rule: debounce is a queue, not permission to adopt a
future read. Capture its revision before reading, and publish accepted queued
intent as pending immediately. A read may update knowledge, but only the owning
mutation or an explicit recovery choice can settle the pending operation.

### Independent review round 6: uncertain writes and explicit reversals

Scope at `aee3e48eec11c1c5e73af1d9d5aaef09af1342d5`: reproduce the real
focus/session failure and same-account recovery sequence where a POST commits
but its response fails, then an older GET clears a toggle-back. Preserve
unresolved mutation ownership and final structured intent through re-reads and
explicit recovery, including matching-baseline retries. Cover equivalent
step/completion/resume changes, response orders, identity isolation, reset and
conflict recovery without changing wire contracts or broadening stage U10.

TDD reproduced three failures at the exact base before implementation: matching
stale GET erased the final reversal and reported Saved, explicit Retry skipped
the needed CAS write, and the rendered course reproduced the false Saved state
through the real session hook, browser focus, failed session lookup and Try
again. The production repair reuses the existing bounded `operation` ownership
marker rather than introducing another queue or field-specific recovery rule.
A GET may advance server knowledge, but cannot deduplicate or retire any
unsettled operation. Explicit recovery of that operation always performs CAS,
even when final intent equals the last read. An owning acknowledgement or Use
saved settles it; account teardown discards it. Fresh unchanged intent still
sends no write. No wire contract, reflection payload or free text changed.

The 288-case response-order model covers both directions of step/completion and
resume changes; checking/unavailable; older/equal/committed/newer-independent
GET revisions; GET before/after POST acknowledgement or network/upstream error;
and retry accepted versus conflict requiring Keep mine. Network/HTTP errors do
not provide trustworthy commit certainty, so the model represents both possible
server outcomes and lets CAS decide. Additional cases cover held Retry / Keep
mine / Save, Use saved, account switch/sign-out, failed GET recovery, and queued
reset after uncertain resume with and without post-dispatch deltas. The resume
API accepts valid card IDs, not null; reset is the explicit clear path and is
covered without widening the API. Existing stale response, reset idempotence,
initial-read delta and nine historical blocker tests remain in the same owning
suite. After recovery, timers/pagehide/release produce no extra writes.

Focused validation passes 1,102 owning tests (+305), 21 rendered course tests
(+1), and 1,211 tests across all 11 relevant Web progress/course/session/API
files through the standard test entry point (locale generation and five Next
cache-size guards included). Full Web lint with `--max-warnings=0`, typecheck,
scoped Prettier, patched-dependency guards/tests, hidden-roadmap-lane
guards/tests, roadmap-ID/baseline tests and `git diff --check` pass. Heavy
operations use `agent-io-guard`; exact commands/logs are retained in
`/tmp/forge-2782-r6-final-validation.py` and
`/tmp/forge-2782-r6-validation/`.

The interleaved 50,000-load-per-version comparison against the exact base keeps
one GET and zero writes per initialization. Median initialization is 0.001260
ms before / 0.001252 ms after. Minified module size is 12,718 / 12,674 bytes
(-44); gzip is 4,373 / 4,364 bytes (-9). No imports, rendering, hydration, routing,
media or initial request scheduling changed. This measures client
initialization/resources, not browser LCP/CLS or a full production build;
neither was rerun. Controlled rendered session/focus tests do not mutate live
accounts or production data. Available Node is 24.19.0 (repo pin: 24.22.1).
The new head must rerun CI after push; local checks do not establish its CI
result. No deployment, flags, configuration or content changed.

Durable uncertain-write rule: equality with the last read does not acknowledge
a mutation whose response failed. Preserve both its unresolved operation and
the visitor's explicit final intent, including a reversal to that baseline,
until owning acknowledgement or explicit recovery settles them. Retry must use
CAS even for matching intent; only its response can establish whether the
uncertain predecessor committed.

The full Web suite also passes: 340 files passed / 3 skipped (343 total),
6,835 tests passed / 13 skipped / 1 todo. Command:
`pnpm --filter @forge/web run test --maxWorkers=1 --no-file-parallelism`.
Active commit hooks run staged ESLint/Prettier, full-repository `format:check`
and conventional commit validation. One focused fast-forward commit is pushed
only to `origin/feat/watch-audience-grow` with the exact reviewed-head lease;
the parent and changed-file set are verified before pushing.
