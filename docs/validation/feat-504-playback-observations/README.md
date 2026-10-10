# Playback observations implementation and evidence

## Scope and semantics

Implements the observable part of feat-370 and the observation requirement in
feat-504. The parent plan is
`docs/plans/2026-09-15-recommendation-quality-feedback-plan.md`.

`playback-observations-v1` uses **10,000 milliseconds from known playback intent
to a retained route/page departure** as a diagnostic window. It is not a
preference threshold. Elapsed time and active foreground playback stay separate;
a long pause/buffer followed by departure is not an immediate exit merely because
active playback is short. Before-start and after-start departures are separate.

Preference interpretation is always `unknown`, and ranking influence is always
`false`. This slice neither creates nor changes profile contributions, qualified
watch outcomes, click session-intent weights, or negative topic weights. Retained
episodes can be joined through the existing authorized session/profile chain;
this change creates no persistent profile-observation association. Reset and
privacy-generation fences therefore remain owned by that existing link service.

Missing terminal/timing evidence, clock disagreement, conflicting facts, observed
hidden state and bfcache suspension are inconclusive. Cleanup cannot prove an
intentional dislike. A terminal after an attempt without a recorded start is an
observation of pre-start departure, not proof that playback never occurred.
A final summary declares whether start/error occurred and the expected
seek/navigation/QoE counts. Each family is observed only when the retained facts
match that summary; missing summaries remain missing, and count/presence
mismatches remain partial. Start mismatch also makes playback stage unknown.
The current browser transport remains best effort, and unsupported intent/device
signals remain unknown even when the observed-family counts reconcile.

## Implementation

- Web records bounded pause/resume, visibility and bfcache navigation observations,
  and waiting/stalled/recovery boundaries for buffering. Causes stay unknown.
- Seek direction uses the last observed position because native `seeking` fires
  after `currentTime` changes. Returning to zero is observed separately from
  unprovable deliberate replay intent.
- Known intent can produce an attempt and terminal before the first `playing`
  event. Preview playback still does not create a playback attempt. Initiation and
  duration prop updates no longer tear down the recorder as a route departure.
  The cleanup generation check also preserves playback through StrictMode setup
  replay. Pausing while buffering closes that buffer interval at the pause.
- The existing fact table, capability binding, 128-fact episode cap, 16-event
  batches, payload bounds, stable event IDs, finalization and raw expiry apply.
  Navigation and QoE each have a 16-fact cap; the final summary has a one-fact
  cap and is queued before the terminal. Optional observations stop consuming
  pending claim slots after eight queued facts. No new schema or workflow exists.
- Admin recomputes a versioned projection with a fact watermark and input digest
  from retained facts. The audited trace view shows independent navigation and
  QoE coverage and inconclusive readiness. The overview reconciles attempts,
  starts, finalized episodes and observation categories for the **latest 20**
  retained episodes, with at most 128 facts per episode. It explicitly labels the
  bounded sample; these counts are not full-window rates.
- Purpose is playback diagnosis and future interpretation research. Identity is
  the existing opaque episode/session linkage; no new identity is collected.
  New facts inherit the episode's immutable 29-day raw expiry, existing daily
  purge propagation and 30-day ceiling. Detail access uses recommendation trace
  permission and the existing sanitized 90-day access audit. Root deletion
  cascades to facts; projection reads exclude expired roots and facts. No extra
  persistent projection copy exists. Profile-link reset removes the association;
  operational episode facts retain their existing bounded expiry.
- The observation projection is a read model, not another outcome classifier.
  Late facts change its digest and result without rewriting prior raw facts.

## Verification

On September 15, 2026, in isolated worktree `codex/playback-observations-quality`:

- 54 focused Admin tests pass: playback observation policy, contracts, ingestion,
  and outcome consumer. 72 focused Web tests pass: recorder lifecycle, observation
  collection, claim recovery and playback route validation. Mixed-version tests
  cover an ambiguous newer-server commit followed by both older-Web and
  older-Admin schema rejections, preserving identical baseline event IDs and
  payloads. Lost start/error/seek/family facts remain unknown or partial.
- Seven real PostgreSQL episode tests pass in a disposable random schema. The new
  integration test ingests both families, retries identical observations, reads
  the audited Admin projection, recomputes after reordered evidence, checks
  unqualified pre-start outcomes, bounded overview sampling and expiry. It proves
  schema-invalid mixed batches persist no facts before rejection. Existing
  generation fencing, transport concurrency and late-fact tests remain passing.
- Admin and Web type checking and changed-file ESLint pass.
- Chromium: real document navigation retained attempt/end before first play;
  a real canvas MediaStream produced playing/active/end events; a duration update
  produced zero false terminal facts. The episode HTTP service used synthetic
  capabilities and receipts, not production.
- Actual Admin episode page rendered with synthetic authorized service data and
  the repository CSS at 1440px and 390px. No mobile horizontal overflow.
  The standalone fixture omits the surrounding Admin layout and font loader.

### Page-load comparison

Eight fresh Chromium pages per revision, same local HTTP fixture and React bundle,
main `3cc4017af` versus this implementation:

| Measure                          |        Before |         After |
| -------------------------------- | ------------: | ------------: |
| Initial claim requests           |             1 |             1 |
| Initial resources                |             2 |             2 |
| Minified fixture bundle          | 207,494 bytes | 210,050 bytes |
| Gzip fixture bundle              |  64,768 bytes |  65,467 bytes |
| Median load event                |       67.6 ms |      64.55 ms |
| Initial long tasks across 8 runs |             3 |             1 |

This is a local bounded regression check, not a production speed claim. No new
request starts during initial mounting. New facts arise from playback/lifecycle
observations. Browser results and desktop/mobile screenshots are retained beside
this document; all values and media are synthetic.

## Remaining feat-370 work

Do not mark all of feat-370 complete from this slice. Explicit manual-skip/replay
intent, user versus system pause causes, recoverable versus fatal error severity,
startup timeout, device/network breakdowns, independent persisted readiness
revision/retire decisions and whole-window family funnels remain unsupported.
Both readiness decisions intentionally remain inconclusive. A separate product
interpretation and evidence are required before using departures in profile
weights. This implementation makes no recommendation effectiveness claim.

## Deployment and monitoring

Baseline attempt/start/progress/seek/active/end/error payloads retain their exact
old schema. Version, timing and completeness metadata live in separate optional
facts. On the exact HTTP 400 validation codes `invalid_body` (older Web) or
`playback_request_invalid` (older Admin), a mixed batch drops only optional facts
and retries the unchanged baseline facts with the same IDs and payloads. This is
safe even after an earlier ambiguous commit; baseline replay remains idempotent.
Binding, authorization and unknown transport failures never trigger this downgrade.
Missing optional summaries then produce missing observation coverage. Older
clients remain accepted, and mixed-version rollout retains playback evidence.
No migration or GraphQL SDL generation is needed because the existing event
payload is JSON.

Through the normal PR-to-main deployment flow, inspect
`recommendation.evidence` for `action=facts` and `invalid_request`, `conflict`,
`episode_limit` or transport exhaustion; inspect the authorized playback sample
for observation coverage and unknown/missing classifications. Validate real
before-start and after-start journeys after rollout without interpreting a small
sample as usefulness evidence. If rejection or loss rises, revert the Web
collector change while retaining Admin's backwards-compatible readers. Playback
and navigation remain fail-open if telemetry is unavailable.

## Review closeout

Independent review identified mixed-version schema rejection, StrictMode false
exit, incomplete family evidence, and buffering through a pause. The final
protocol and regressions above address these findings, including loss of
start/error/seek facts. The final independent re-review reports no actionable
findings. Broader feat-370 requirements remain explicitly incomplete.
