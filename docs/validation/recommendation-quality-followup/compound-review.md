# Compound Engineering review

**Scope:** recommendation follow-through branch against main, including the new
files and the plan's U1–U6 requirements. Other tasks' merged changes are retained.
**Mode:** autofix. The supplied AGENTS.md maps persona work to sequential main-agent
review; this is a structured review across lenses, not independent peer approval.

**Lenses:** correctness, testing, maintainability, project standards, agent-native
access, past learnings, security/privacy, performance, API contracts, data
migrations, reliability, adversarial scenarios, TypeScript and async UI lifecycle.

## Findings fixed

| Priority | Finding                                                                  | Fix and verification                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Ranker parity was compared after intentional history composition         | Compare ordered candidates before composition and record the actual composer version. The new control-arm history regression returned semantic_parity_mismatch before the fix; both semantic A/A routing cases now pass.                              |
| P1       | Enrollment cutoff truncated late assignments and their retained outcomes | Separate the v2 enrollment cutoff, per-unit 24-hour follow-up and raw retention; pin the outcome policy. Assignment tests retain a noon assignment after the midnight cutoff and reject new enrollment; native extraction retains zero-exposure rows. |
| P1       | Concurrent assignment and privacy reset needed one generation fence      | Serialize enrollment on the profile row and recheck assignment/profile/promotion authority at issuance. Real PostgreSQL concurrent enrollment returns one assignment; a changed privacy generation prevents issuance.                                 |
| P2       | Technical playback errors were conflated with conflicting outcomes       | Exclude affected contributions independently and reserve the conflict count for actual episode conflicts. The qualified-view predicate and conflict-health predicate now test separate conditions.                                                    |
| P2       | Overlapping study windows could replace a cohort still in follow-up      | Require one active profile study including its follow-up interval. The wrapper reads at most two matching studies and enrolls only when exactly one exists.                                                                                           |
| P2       | A subset reporting window could selectively omit assigned viewers        | Require the exact configured enrollment window and latest compatible outcome revision. Native tests retain unexposed units and count a superseding disqualification instead of an earlier qualified revision.                                         |

## Additional qualification fix

The adversarial pass found that a one-second clip could meet the original
short-video threshold during an immediate scroll past. Qualification now always
requires at least five seconds of visible-playing time while clipping the unique
progress requirement to the video's duration. Both sound modes have explicit
brief-pass and sustained-view regressions. This resolves the brief-exit requirement
without assigning a negative preference.

## Boundary review

- Mode capture requires visible document/player geometry, advancing media and
  known sound state. Pauses, stalls, seeks, hidden tabs, covered previews and
  immediate exits cannot fabricate qualified profile preferences. Preview/manual
  transitions keep one episode; core playback/navigation remain fail-open.
- Raw fact validation, optional mixed-version downgrade, bounded event counts,
  token binding and generation erasure remain enforced. Revocation-store faults
  retain their retryable server classification; invalid signatures remain invalid.
- Candidate affinity is bounded by existing relevant retrieval, a 150ms sub-budget,
  one vote per distinct viewer/video and 20 independent profiles. It never adds
  an unverified catalog source or changes locale/audio eligibility.
- Empty-row fallback reads only approved active inventory, rechecks eligibility,
  excludes current/recent identity aliases and preserves truthful curated evidence.
- Profile reset/deletion and issuance/publication races have real database tests.
  New evidence cascades with source episodes; explicit privacy operations erase it.
- The two additive migrations match the Prisma models. Prisma formatting aligns
  existing relation columns; no unrelated semantic schema drift or public GraphQL
  SDL change was introduced. Generated output was not edited by hand.
- The mature extractor is read-only, bounded and assignment-rooted. External A/A
  and HTTP/latency gates remain false without reviewed evidence. New diagnostics
  use the existing authorized Admin surface; extraction has a privileged CLI.

## Requirements and limits

U1, U2's preview/profile integration, U3 and U6 have implementation/regression
coverage. U4 connects available history; unsupported editorial/series/speaker
inputs and weight calibration remain explicit, and the MMR policy stays
unpromoted. U5 supplies gated runtime/extraction; an actual approved profile A/A,
external guardrails and mature controlled result are still required. Broad
feat-370/393/505 are not falsely marked complete.

No remaining actionable code findings at this checkpoint. CI, normal merge,
exact production deployment, full Watch-page smoke/performance and settled
production error/evidence windows remain release checks. Sound-off quality and
causal uplift cannot be inferred from passing tests or the old confounded CTR.

## Learnings and past solutions

- `docs/solutions/logic-errors/source-neutral-playback-recent-history-20260915.md`
- `docs/solutions/architecture-patterns/production-recommendation-boundary-hardening-pattern.md`
- `docs/solutions/database-issues/prisma-raw-serialization-retry-and-token-error-boundaries-20260916.md`
- `docs/solutions/architecture-patterns/muted-preview-viewing-mode-feedback-20260916.md`
- `docs/solutions/architecture-patterns/profile-comparison-followup-and-muted-outcomes-20260916.md`

Review complete

## Rollout compatibility follow-up

A release-time contract pass found that pre-release open tabs reject the new
`viewing_mode_personalized` enum and hide otherwise valid semantic/profile cards.
The BFF now omits the optional personalization explanation for clients that do
not advertise `x-forge-recommendation-client: viewing-mode-v1`. New clients retain
the exact new metadata. Items, ordering, capabilities, request ownership and the
Admin audit remain unchanged; the response does not relabel mode fit as topic fit.

Two regressions failed before this correction (missing/unknown client version).
The corrected route and real client collector suite pass 50 tests, including
modern metadata and capability/card preservation. Sequential correctness,
contract, privacy, performance and maintainability review found no remaining
issue in this correction. The header is a presentation capability, not authority;
all admission and privacy checks remain mandatory. It adds no requests or waits.

Curated candidates are a new source discriminator. Earlier tabs still need a
reload to display that newly recovered inventory; those cases were previously
empty. No existing healthy semantic/profile row depends on curated parsing.

## Production destination slug finding

The real selected-preview journey exposed HTTP 400 on the destination's next
recommendation request: `origins-of-christmas--episode-1` is a valid canonical
content slug, but the optional delivery seed-slug field rejected repeated
hyphens. Feat-514 records this pre-existing mismatch. Two regressions reproduced
it; the fix reuses `tryAsContentSlug` and retains the 191-character bound. Invalid
path/query shapes still fail before Admin access. Sequential correctness,
security, API-contract and simplicity review found no additional issue in the
one-line schema correction. Production recheck remains a release gate.
