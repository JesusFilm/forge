---
title: "Finish recommendation quality improvements from live analytics"
type: feat
status: active
date: 2026-09-16
origin: docs/reports/2026-09-16-recommendation-next-improvements/report.md
---

# Recommendation quality follow-through

## Scope and prior delivery

The owner approved the remaining analytics recommendations except Recommendation
Visibility (feat-373). Locale/source expansion (feat-471) remains excluded. PR
#2309 already shipped recent-play suppression and unknown immediate-departure
observations (feat-503/504), shadow composition, and an offline usefulness
evaluator. Preserve those mechanisms and finish the integration gaps.

Production currently holds For you off. This work targets the existing
below-player row; it does not publish homepage content or change that flag.
The original checkout belongs to another task. Work exclusively in
`.worktrees/codex/recommendation-quality-feedback`, branch
`codex/recommendation-analytics-followup`. The active source-free task owns
feat-496 shared cache/admission recovery; avoid its files and check main before
integration. There is no callable cross-task messaging tool in this session.

## Implementation units

### U1 — Preserve valid playback evidence through transaction conflicts (509)

- Reproduce SQLSTATE 40001 using the installed Prisma runtime and disposable
  PostgreSQL. Classify structured codes only, including the proven raw-query
  wrapper; never retry arbitrary P2010 errors or parse SQL/error messages.
- Keep the existing three serialization attempts and separate episode-lock
  budget. Exhaustion must become a typed retryable server failure.
- Files: `apps/admin/src/services/recommendations/transaction-retry.ts`, its
  tests, GraphQL recommendation errors and Web playback boundary tests.
- Verify whole-transaction rollback/retry, exact replay and payload conflicts,
  one durable receipt/fact, genuine terminal invalid input, cyclic causes and
  bounded attempts. No schema/API expansion is expected.

### U2 — Complete the selected-video journey (370)

- Verify a real card selection through target navigation, claim, activation,
  start, active time and immediate departure. A claimed preview without explicit
  activation is not evidence of player failure or dislike.
- Owner decision: keep preview first. Sustained muted preview viewing can be
  meaningful viewing even without explicit activation. Observe playing state,
  viewport visibility, document visibility and sound state independently; an
  autoplay start or a brief scroll past must not count as meaningful viewing.
  Distinguish recorded behavior from missing telemetry and explicit activation.
  Preserve browser autoplay refusal recovery, modified
  clicks, fail-open navigation, private handoffs and the legacy recorder.
- Keep navigation and QoE independent. Expand observable lifecycle gaps with
  bounded reason codes and honest unknown causes; never manufacture intent.
- Files: Web recommendation card, Watch player/recorder and their lifecycle
  tests; Admin observation projections and authorized reconciliation views.
- Verify navigation, slow/lost claims, blocked autoplay, route reuse, immediate
  exit, player failure and page-loading performance in a real browser.

### U3 — Serve useful approved fallback for an empty below-player row (511)

- Reuse the active curated generation for the exact locale/audio context when
  contextual/profile retrieval yields no eligible items. Do not replace a
  healthy semantic row merely because a profile is cold.
- Recheck live publication, playback, artwork and content identity; suppress
  current media and recent starts using the same authoritative inputs.
- Persist truthful curated provenance and the original shortfall reason. No
  invented similarity score, embedding backfill, new language pool, or request-
  time catalog scan. Fit retrieval plus issuance within the existing budget.
- Files: seeded delivery service/types/candidate mapping, existing curated pool
  service adapter and unit/real-Postgres delivery tests. Allocate a roadmap ticket
  before implementation; feat-487's completed source-free pool work is distinct.

### U4 — Finish usable slate-composition inputs and shadow decisions (393)

- Connect available, bounded history/editorial/metadata inputs to shadow
  composition. Preserve explicit missingness for unsupported inputs; do not
  substitute guessed speaker/series identity or guessed preference weights.
- Preserve fixed editorial order, pins, approved pools, eligibility and current
  video exclusions. Record pre/post order and every movement/removal/fallback.
- Use the existing authorized shadow decision/promotion mechanism where
  possible. Any live composition requires a version-bound terminal decision;
  a pending or inconclusive policy must not silently become live.
- Verify determinism, duplicates, sparse/all-filtered candidates, missing
  metadata and deadline behavior. Record calibration evidence and decision.

### U5 — Connect the controlled usefulness comparison (505)

- Implement profile-unit sticky assignment and a read-only mature-outcome
  extractor using the existing experiment spine and offline evaluator.
- Enroll only viewers eligible for both exact strategies before assignment;
  control bypasses profile ranking, while ordinary non-enrolled delivery keeps
  its existing behavior. Persist assignment even when nothing is exposed.
- Start extraction from all assigned units, include zeros, select the latest
  compatible outcome before counting, and enforce each unit's follow-up window
  plus the episode fact horizon. Expose contamination/missingness as failures.
- Scope exposure reconciliation to the existing below-player contract. Do not
  implement feat-373 or falsely close its separate surface-registry work.
- Preserve explicit disable/reset/delete, privacy generations and retention.
  Do not add a consent prerequisite. Production A/A/A/B conclusions require
  actual sample size and maturity gates; tests cannot demonstrate causal uplift.

### U6 — Learn sound-off viewing preference and retrieve suitable videos (512)

- Owner clarification: sound-off/sound-on behavior is a proper profile signal,
  not intrinsically weaker because playback is muted. Sustained on-screen muted
  preview viewing must be usable even when the viewer never presses Watch now.
- Capture bounded visible-playing intervals with mode and preview/activated
  context. Exclude hidden tabs, off-screen playback, stalls and brief scroll-past
  exposure. Sound state does not by itself imply interest or disinterest.
- Reuse the sticky hero's real body-overlap geometry. IntersectionObserver alone
  incorrectly reports visibility when the body paints over the pinned player.
- Keep topic interests and viewing-mode preference distinguishable. Use
  trustworthy mode-specific engagement/completion evidence to augment retrieval
  and ranking for matching viewers. Preserve relevance, exact audio/locale,
  eligibility, recent-play exclusions and delivery budgets.
- Bound repeated autoplay loops and prevent preview-to-activated double counting.
  Use a versioned policy and confidence/sample gates for per-video performance;
  sparse or missing data uses ordinary recommendations. Immediate exits remain
  unknown preference, and technical failures must not become negative taste.
- Use existing profile generation, access, erasure and retention fences. Record
  data ownership and rollback, add focused browser/real-database tests, and show
  mode signal/provenance in authorized Admin diagnostics.

## Validation, review and release

Run focused tests per unit, real-Postgres integration, affected app typechecks,
lint, builds and full tests before the final PR. Use Compound Engineering review
for correctness, contracts, security/privacy, performance, reliability, test
coverage and maintainability; fix actionable feedback. Compound durable findings
and update roadmap status only to match what is actually complete.

Merge through normal PR-to-main checks, reconcile the exact deployed revision
across Web/Admin/worker, and compare fixed primary HTTP/error/evidence windows.
No direct Railway deploys. Operational safety, reduced empty rows and handoff
completion are measurable immediately; causal recommendation benefit requires
the prespecified controlled comparison to mature.

## Plan review

Sequential coherence, feasibility, scope, security and adversarial review:
the original recommendation proposals did not justify autoplay or negative
preference inference, so U2 explicitly resolves playback intent and preserves
unknown exits. U3 adds an empty-row fallback rather than conflating cold profiles
with failed contextual retrieval. U4 fails closed on unavailable metadata and
unapproved policy. U5 separates runtime completion from elapsed experiment
evidence, retaining assigned units with zero exposure and generation fences.

## Implementation checkpoint — September 16

- U1: raw serialization retry and token storage-error boundaries implemented and
  committed as `745e7a198`; 80 focused checks passed.
- U3: approved-pool fallback implemented with exact locale/audio, current/recent
  exclusions, provenance and additive execution-mode migration. Native pool and
  migration checks passed; full release review remains pending.
- U2/U6: preview-first visible mode capture, current-generation profile facet,
  bounded sound-off candidate affinity, authorized diagnostics and rollback
  switch implemented. Native publication/reset/deletion race checks and real
  media browser fixture pass. See the validation checkpoint and compound note.
- U4/U5: historical shadow inputs and controlled-comparison runtime integration
  remain the next implementation units. Existing partial tickets stay in progress.
- No follow-through PR has been merged or deployed at this checkpoint. The
  For you hold and exclusions remain intact. Recommendation uplift is unproven.
