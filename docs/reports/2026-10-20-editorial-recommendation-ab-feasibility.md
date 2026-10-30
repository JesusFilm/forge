# Editorial recommendation A/B feasibility — 20 October 2026

**Owner decision, 20 October: remove the producer and measurement-certification
prerequisites and run an ordinary public A/B test of the saved editorial import.
The qualification/private-pilot proposal in this historical assessment is
superseded by feat-746 and the public saved-generation plan. Regeneration is
unnecessary.**

This assessment covers `editorial-catalog-20261019-v1`. It does not activate an
experiment, change production, or claim that the editorial work ran through the
shared-reading producer.

## Evidence and limits

- Current remote `main` inspected: `0527226c949d3cb0523339b45d8eef017272613f`.
- PR #2809 inspected at `4d5d57f30678f9fecb9163ce03dfad7a5934facb`: open, unmerged,
  with a successful CI gate when queried. The import receipt records completion
  independently of merging this PR. [PR][pr]
- The committed production readback records 1,031 source rows, 6,147 links,
  1,017 six-choice sources, nine five-choice sources, five empty sources, no
  missing targets, no self-links, and unchanged public controls. These are
  **19 October receipt observations**, not a fresh database read. [Receipt][receipt]
- After the owner signed in, the deployed Admin pages were inspected read-only.
  The observations below verify the generation, serving pointer, absence of
  experiments/baseline/capacity receipts, and displayed launch blockers. Web
  environment values, independent calibration infrastructure, database-wide link
  totals, and deployed commit identities were not independently verified.
- The shared checkout has unrelated edits and a September base. Current source
  was fetched and inspected in a temporary snapshot without changing its branch
  or application files.

## Authenticated production observations

Observed on 20 October 2026 in Pacific/Auckland:

- [Public readiness](https://admin.jesusfilm.org/dashboard/recommendations/precomputed/public)
  shows incumbent serving, pointer version 1, no selected experiment/generation,
  no baseline started, no launch-capacity receipt, and no prepared public cohort.
- Its unresolved reasons are `numeric_policy_not_agreed`,
  `end_to_end_loss_limit_not_agreed`, `verified_incumbent_baseline_missing`,
  `web_request_health_incomplete`, `actual_catalog_build_unverified`,
  `launch_capacity_unavailable`, and `launch_capacity_stale`. It shows 1,031
  authoritative eligible sources versus 1,031 generation sources.
- [Private visits](https://admin.jesusfilm.org/dashboard/recommendations/precomputed/visits)
  says no private test is configured and does not show the creation form.
  The public page does show the operator-only baseline button. Under inspected
  main's rendering conditions, this implies the Admin private-test flag is not
  enabled, rather than missing experiment permission. This is an inference from
  UI plus source, not a direct environment read. Verify the Web flag separately.
- [JESUS in English](https://admin.jesusfilm.org/dashboard/recommendations/precomputed?generation=editorial-catalog-20261019-v1&source=cmp76xcw602imny01vnsbwwy9&audio=english)
  shows the exact generation as complete, `codex-editorial-session`, content-only,
  six saved/playable choices, and no language/publication gap. It displays zero
  imported model calls, consistent with an import rather than new inference.
- With canonical audio slug `spanish-latin-american`, the same source has five
  playable saved choices; `Know God (Episode 3): Jesus` is filtered as audio
  unavailable. This is a real example of six stored links becoming five cards.
  The unqualified string `spanish` produces no matches and must not be treated
  as a valid Spanish-language coverage measurement.
- The comparison explicitly labels its incumbent slate as anonymous contextual
  output; real measured Watch delivery can compose different recommendations.
  Admin comparison alone is not an end-to-end experiment smoke test.

## What is feasible now

| Activity                                                           | Assessment                                                              | What it establishes                                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Admin comparison                                                   | Supported by the completed saved generation                             | Editorial relevance, reasons, and current playable choices for a selected source/audio language   |
| Invited private 50/50 test                                         | Supported by existing code; live configuration still needs verification | Sticky assignment, real Watch delivery, empty/failed rows, accepted clicks, and fallback behavior |
| Public 50/50 experiment using this generation unchanged            | Rejected by current launch qualification                                | Requires a reviewed code change for editorial provenance plus normal launch evidence              |
| Declaring a statistically qualified winner from the private report | Unsupported by design                                                   | Private reports always remain inconclusive                                                        |

Private configuration checks the operator permission, Admin test flag, incumbent
routing, disabled preview manifest, completed generation, and source-set digest.
It does not require Astra, historical analytics, or model-call receipts. It freezes
the generation and incumbent routing and uses browser-sticky 50/50 assignment.
The Web path additionally requires its test flag and a valid experiment tester
cookie. [Private admission][private] [Web delivery][web-delivery]

The primary measure already counts eligible Watch visits with at least one
accepted recommendation click divided by all eligible visits in the assigned arm.
Empty, failed, and fallback visits stay in the denominator. Technical fallback
retains the assigned arm and records actual delivery; valid empty lists hide the
row. Card CTR is a separate diagnostic. The private report cannot certify a
winner because human eligibility and event loss are unverified. [CTR contract][ctr]

## Concrete private pilot

1. Read the deployed Admin visits page and public readiness page. Confirm the
   generation still exists, incumbent routing is valid, and the public pointer
   remains on the incumbent. Check that no other private test overlaps the proposed
   window: admission currently uses `findFirst` over active private tests without
   selecting an experiment from the tester link. [Private admission][private]
2. Verify `RECOMMENDATION_PRECOMPUTED_TEST_ENABLED=1` on Admin,
   `WATCH_PRECOMPUTED_RECOMMENDATIONS_TEST_ENABLED=true` on Web, the signing secret,
   and canonical origin. Confirm the operator has
   `operate:recommendation-experiments`. Create a short, explicitly dated private
   test for this generation through
   `/dashboard/recommendations/precomputed/visits`. [Admin UI][visits-ui]
3. Issue **experiment** tester links using
   `createRecommendationExperimentTesterLink`, which targets
   `/watch/api/recommendations/experiment-tester`. The existing
   `create-recommendation-tester-link.ts` CLI calls the ordinary preview helper;
   those preview links do not enroll users in this A/B test. A small operator
   wrapper or CLI mode would make experiment-link issuance repeatable. Keep signed
   links private. [Token helpers][tokens] [Existing CLI][tester-cli]
4. Verify both arms in real browsers: stable assignment across reloads/navigation,
   accepted clicks attributed to the correct visit and generation, and unchanged
   ordinary visitor behavior. Private preview credentials take precedence over
   experiment enrollment; use clean browser profiles for the smoke checks.
5. Include popular films, chapters, several target audio languages, a five-choice
   source, and one of the five withheld sources. Inspect list quality and playback,
   not just whether a row renders. Keep normal page-loading and delivery latency
   evidence alongside the visual checks.
6. Use the private visit/click panels for operational findings. If saving versioned
   CTR reports, declare the fixture policy before the first visit. Do not interpret
   a small invited sample or its fixture thresholds as evidence for public rollout.
   [CTR contract][ctr]

The private pilot can proceed without new generation work. Admin currently offers
no private creation form; configuration and experiment-link issuance must be
resolved before it can start. Web configuration and end-to-end delivery remain
unverified, so there is no confirmed launch date.

## Why public launch currently fails

The imported manifest is protocol 1, `modelId=codex-editorial-session`, and
`inputMode=content_only`, with no generated model-call ledger. This is honest
editorial provenance. The live gate instead requires a qualified protocol 2/3/4
catalog, `gpt-6-astra`, `historical_analytics`, a historical qualification digest,
matching full-catalog coverage, and positive model-call count. It returns
`actual_catalog_build_unverified` for this import. [Import contract][import]
[Live gate][gate]

This is enforced beyond the readiness UI: preparation loads and validates live
evidence; public start separately checks generation protocol/GA qualification
and build capacity; launch-capacity attestation also requires protocol/GA and
build-capacity evidence. Removing one displayed warning would not make this
generation launchable. [Public control][control] [Capacity][capacity]

Recommended implementation: introduce a narrowly scoped qualification for reviewed
editorial imports, binding the original generation/input/source-set digests,
review provenance, accepted links, exclusions, and current catalog coverage.
Use it consistently in readiness, capacity, prepare, and start. Preserve the
generation's original identity and provenance. Keep human verification, assignment,
CTR health, measured storage, rollback, and manual activation requirements intact.
Do not fake an Astra model ID or model-call receipts, mutate a completed generation,
or enable the isolated-fixture path in production.

## Measurement and schedule requirements

The public infrastructure exists, but code presence is not operational readiness.
Its current contract requires:

- Real Turnstile verification, matching Web/Admin human-proof configuration,
  durable Web hourly counters, and authenticated Admin reads of those counters.
- A qualified incumbent baseline: 168 collection hours, 24 late-click hours, and
  five minutes of grace. If no valid baseline exists, launch is at least roughly
  **eight days after collection begins**; baseline start schedules the next UTC
  hour. Incomplete or unhealthy evidence needs repair and a fresh window.
- A frozen numeric policy based on observed CTR and independent browsers, and a
  launch-capacity receipt no older than 30 minutes. Historical GA page views are
  not this baseline.
- A browser-sticky 50/50 cohort lasting **one UTC calendar month**, followed by
  its declared late-event window. Insufficient samples or unhealthy measurement
  yield an inconclusive result; the code does not extend the cohort automatically.
  [Launch runbook][launch]

The runbook proposes 11,000 eligible visits and 11,000 independent browsers per
arm, 80% planned power, and a two-percentage-point detectable effect. These are
proposals, not approved settings or evidence that current traffic can supply the
sample. Even the nominal browser floor implies at least 22,000 independent
browsers across the month; repeat visits and effective sample size matter. No
fresh eligible-traffic rate or defensible completion forecast was available here.
Start the qualified baseline while implementing editorial qualification, then
agree the effect size and stopping policy using its actual counts. [Launch runbook][launch]

Final winner certification also requires an independently signed measurement-loss
calibration covering the complete cohort and late-click horizon. The receipt is
not a launch-time gate, but its collector must be operating from the beginning.
Without the receipt, final evaluation returns `final_calibration_pending`; it
cannot certify promotion. The repository documents the verifier but does not
establish a provisioned independent production collector. Sampled Datadog RUM
alone does not meet the current complete-census contract. Verify current
infrastructure before promising a decision-grade test. [CTR contract][ctr]

These requirements can be reconsidered through an explicit experiment-design
decision if they exceed the desired pilot's needs. Quietly disabling them would
change what the report can legitimately conclude.

## Content and coverage considerations

- 6,147 accepted links reconcile as `1017 × 6 + 9 × 5`; the five withheld sources
  are valid empty results. They are about 0.49% of source rows, but their traffic
  share is unknown. Keep them in the declared cohort denominator or define any
  exclusion before assignment; never remove them after seeing outcomes.
- The artifact verifies at least one playable published dub, not coverage for
  every audio language. Delivery rechecks current publication, Watch visibility,
  translated presentation, and exact audio-language playback. Measure resulting
  empty/partial rates, especially for the highest-traffic languages.
- The editorial artifact describes 262 individually tailored sources and 769
  sources sharing editorial decisions. That is acceptable as a candidate ranking
  approach, but is not measured evidence of usefulness. Resolve the five known
  evidence mismatches in their existing follow-up before claiming complete
  editorial coverage. [Artifact notes][artifact] [Reader][reader]

## Verification performed

- Queried PR status and CI; fetched current remote main and PR head.
- Ran the PR's offline validator: passed for the original 1,031 sources and 6,186
  draft links, including CSV/JSON/HTML agreement. This does not validate current
  production language coverage or substitute for the 6,147-link import receipt.
- Executed the actual pure `evaluatePrecomputedLiveFacts` function from inspected
  main, using the imported provenance and otherwise synthetic passing facts:
  result `["actual_catalog_build_unverified"]`. A synthetic qualified generated
  catalog returned `[]`. This isolates the provenance incompatibility; none of
  the synthetic baseline, traffic, or capacity values are live evidence.
- Authenticated production Admin checks confirmed the serving/readiness state
  and sampled English/Latin American Spanish playback filtering described above.
- No application edits, production writes, experiment creation, activation,
  deployment, or messages to other people were performed.

Tracked follow-up: `feat-746`, editorial qualification and private-pilot operator
preparation. Existing `feat-590` continues to own the broader experiment and
measurement work; this assessment does not complete that feature.

Repository housekeeping: PR #2809's IDs 739/740/741 now collide with different
topic-experience tickets on current main. Reassign those IDs and internal links
before merging the PR. This does not invalidate its already recorded import.

[pr]: https://github.com/JesusFilm/forge/pull/2809
[receipt]: https://github.com/JesusFilm/forge/blob/4d5d57f30678f9fecb9163ce03dfad7a5934facb/docs/recommendations/editorial-2026-10-19/import-receipt.json
[artifact]: https://github.com/JesusFilm/forge/blob/4d5d57f30678f9fecb9163ce03dfad7a5934facb/docs/recommendations/editorial-2026-10-19/README.md
[import]: https://github.com/JesusFilm/forge/blob/4d5d57f30678f9fecb9163ce03dfad7a5934facb/docs/operations/editorial-recommendation-import.md
[private]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/apps/admin/src/services/recommendations/precomputed/visit-admission.ts
[visits-ui]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/apps/admin/src/app/dashboard/recommendations/precomputed/visits/page.tsx
[web-delivery]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/apps/web/src/app/api/recommendations/route.ts
[tokens]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/apps/web/src/lib/recommendation-tester-token.ts
[tester-cli]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/apps/web/scripts/create-recommendation-tester-link.ts
[gate]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/apps/admin/src/services/recommendations/precomputed/live-readiness.ts
[control]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/apps/admin/src/services/recommendations/precomputed/public-control.ts
[capacity]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/apps/admin/src/services/recommendations/precomputed/launch-capacity.ts
[reader]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/apps/admin/src/services/recommendations/precomputed/watch-reader.ts
[launch]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/docs/operations/precomputed-public-control.md
[ctr]: https://github.com/JesusFilm/forge/blob/0527226c949d3cb0523339b45d8eef017272613f/docs/operations/precomputed-ctr-report.md
