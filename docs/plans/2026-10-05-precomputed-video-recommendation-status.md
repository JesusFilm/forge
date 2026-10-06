# Precomputed recommendation orchestration

Updated: 2026-10-06 (Pacific/Auckland).

Parent: https://github.com/JesusFilm/forge/issues/2565.
Draft integration PR: https://github.com/JesusFilm/forge/pull/2578.
Roadmap: [feat-590](../roadmap/content-discovery/feat-590-precomputed-video-recommendation-experiment.md), in progress.

The [verification and handoff record](2026-10-05-precomputed-video-recommendation-verification.md)
preserves exact source/integration commits, checks, browser artifacts, review
findings, and recovery history. The [CTR operations note](../operations/precomputed-ctr-report.md)
describes the private reporting contract and limits.

## Integration

- Orchestrator: `01a109d7-dc1c-7600-a2c4-07dee79b4aff`.
- Initial base: `d661b99939e24ba41834adce53c6bad9262bcee9`.
- Branch: `codex/precomputed-video-recommendations`.
- Checkout: `/home/nisal/.codex/worktrees/precomputed-video-recommendations/forge`.
- Latest source commit: `b0892f4e42e67199de7f9617471140be82775381` for the
  #2568 GA reader continuation. All ten source files match independent review
  hashes. Earlier qualification source: `c9b9d6fd6fc283dc810769a1f8baca03113b4a1d`.
  Earlier #2573 sources are `acbb33fe4` and `302dffe31`.
- The PR records the current published integration SHA and [CI checks](https://github.com/JesusFilm/forge/pull/2578/checks).
  Published head `a23bdb342` passed [forge-ci run 37396138013](https://github.com/JesusFilm/forge/actions/runs/37396138013), with all 40 jobs completed and no failures.
- The original dirty `/home/nisal/forge` checkout is preserved.
- Development chats use exactly `gpt-6-sol`; the application model remains
  `gpt-6-astra`. Matt Pocock implement/TDD/code-review workflow only; no
  Compound Engineering skills or agents. Normal hooks remain required.

## Execution ledger

All issues remain open until merge. Dependencies advance on verified acceptance,
not issue closure. Implemented, integrated, merged, and live are distinct.

| Issue | Immediate blockers | State                                       | Integrated work                                          |
| ----- | ------------------ | ------------------------------------------- | -------------------------------------------------------- |
| #2566 | None               | Integrated-and-verified                     | `9a984c544`; saved Admin comparison                      |
| #2567 | #2566              | Integrated-and-verified                     | `c89db0e4e`; bounded Astra producer; no live model smoke |
| #2568 | #2567              | Referrer ingestion in progress              | `b1703cd8c`, `acbe43fc7`, `c9b9d6fd6`, `b0892f4e4`       |
| #2569 | #2568              | Waiting for prerequisites                   | Unassigned                                               |
| #2570 | #2566              | Integrated-and-verified                     | `0a93244a3`; private Watch serving                       |
| #2571 | #2570              | Integrated-and-verified                     | `267a65281`, `b69592b6c`, corrections in `a7f36d778`     |
| #2572 | #2571              | Integrated-and-verified                     | Core `a7f36d778`, UI `af8eba415`                         |
| #2573 | #2572              | Private reporting verified; live incomplete | Sources `acbb33fe4`, `302dffe31`; migration `0134`       |
| #2574 | #2569, #2573       | Waiting for prerequisites                   | Unassigned                                               |
| #2575 | #2574              | Waiting for prerequisites                   | Unassigned                                               |

## Ownership and continuation

Both workers start the approved navigation continuation from
`a23bdb342709cc6fc1f9a13278c842f6428ac2bf`.

Worker A, `01a109e1-47c8-7043-bfd4-a85592cfafc5`, titled
`#2568 Implement referrer and engagement ingestion`, owns Mastra's GA reader,
canonical mapping consumption, historical model tools, source generation and
focused tests. Checkout: `/home/nisal/.codex/worktrees/feat-590-2566/forge`;
branch: `codex/feat-590-2568-referrer`. Its earlier GA reader source
`b0892f4e4` is integrated; earlier branches are preserved.

Worker B, `01a10a28-aa8e-7080-b3d1-c59293f8f4dd`, titled
`#2568 Validate navigation history in Admin`, owns Admin's mapping contract,
completion validation, persisted provenance, comparison display and native
build-through-review tests. Checkout:
`/home/nisal/.codex/worktrees/feat-590-2570/forge`;
branch: `codex/feat-590-2568-referrer-admin`. Earlier #2573 work is integrated
and preserved. The two workers coordinate the backward-compatible wire shape
before semantic edits. Legacy ordered-history provenance keeps its meaning.

The orchestrator owns live GA/model access probes, public catalog discovery,
approved specification changes, integration, shared documents and the single PR.
At most two implementation chats may run. The orchestrator owns integration,
roadmap/ledger updates, and the single PR. Serialize heavy validation with
`/tmp/forge-feat590-heavy-validation.lock`.

## Verified acceptance and qualifications

Private visits use signed browser identity independently of profile learning
controls. Multiple accepted clicks/retries contribute one clicked visit; empty,
failed, and fallback visits remain in the assigned denominator. Individual card
traces require trace-review permission. Raw data retains the ordinary 29-day life.

#2573 transfers expired visits atomically into per-browser counts and arm totals,
retains compact replay markers, and preserves private request provenance after
links expire. Shared transaction fences and the fixed cutoff protect accepted
receipts, snapshots, and delivery summaries. The method uses visit-weighted CTR
with a conservative browser-cluster Student-t approximation. Reports are immutable,
bounded to 32 provisional revisions plus one final result, and cannot activate
or promote anything. Private unverified measurements always remain inconclusive.

Combined checks through migration `0134` passed: 89 precomputed/playback/profile/
Admin-action cases, the exact 20-case profile-scale CI pair, 15 ordinary-delivery
native cases (one intentional skip), 130 default-off Admin regressions, 109 Web
cases, and six retention cases on a fresh migrated database. The first profile
pair run exposed duplicate fixture DDL; the source-chain correction passed all
20 on repeat. Three typechecks and regenerated SDL/client drift checks passed.
The worker full Admin suite passed 8,986 tests (774 skipped, one todo); earlier
verified full Web and Mastra runs are preserved in the detailed record.
Final whole-spec Standards and Spec review against the initial base found zero
confirmed defects in the delivered slices. The known fixture caveat is closed.

Root inspected the #2573 desktop/mobile screenshots and loading data. Eight
alternating warm HTTP samples per mode measured median total response time
178.95ms baseline / 207.8ms with the report, and 61,022 / 78,004 HTML bytes.
Both modes used 19 identical static assets. Tables scrolled within their mobile
containers; no browser console errors were recorded. This is synthetic development
HTTP/layout evidence, not FCP, production auth/database performance, or capacity.

The report API is
`GET /api/recommendations/precomputed/ctr-report?experimentId=...&revision=...`,
using an existing Admin OAuth session cookie and `read:recommendation-aggregates`.
Omit `revision` for the latest saved result. No new AI plugin or bearer credential
was introduced. Evaluation and fixture-policy declaration require operator permission.

The GitHub credential cannot change workflow files. Retention regressions run
through the existing CI entry point; no workflow edit remains. Published history
was preserved when the earlier unpublished workflow revision was rejected.

The #2568 qualification continuation passed independent Standards/Spec review,
with its single source-identifier length/wrapping finding fixed. Combined checks
passed 70 Admin/native, 15 source-build-through-review, 59 default-off and nine
Mastra cases. Both affected package typechecks passed. Full worker suites passed
8,987 Admin and 3,223 Mastra cases before the final bounded cap/wrap fix; focused
checks covered that fix. No migration or GraphQL change was introduced.
Ten alternating synthetic Next samples measured median total response times
130.6ms without qualification and 136.9ms with it, adding 2,189 HTML bytes with
the same 19 static assets. This remains local development evidence.

The GA reader continuation is integrated from `b0892f4e4`: full Mastra tests
passed 3,238 cases (37 configured skips), and final independent review found no
unresolved defects. Real Node impersonation/coverage and aggregate-page reads
succeeded while explicitly retaining source truncation and unknown mappings.
After merging current main `8ebd6500c`, both application typechecks, 15 native
generation-to-Admin cases, 23 Mastra cases, 68 retention unit/workflow cases and
seven fresh PostgreSQL retention cases passed. The additive test conflict kept
both implementations' cases. The completed fixture ticket now uses feat-611;
main's new feat-609 HNSW work is preserved. No history-backed model build or
public experiment activation is implied by these checks.

## External inputs and boundaries

The user signed into GA4 property `320198532` and the Cloud console. Browser
inspection confirmed its existing daily BigQuery link to `cru-ga4-prod-1` and
successful metadata/aggregate reads in `jfp-data-warehouse`. The candidate
`cru-ga4-prod-1.analytics_320198532` remains denied-or-nonexistent, not a verified
source path. Two readable exact-property copies cover only March–July 2023 and
have no viewer/session keys for video starts. They cannot establish transitions.
A combined-event candidate has nonplaceholder keys for mostly 2021–2022 Watch
starts; its lineage, sequence semantics and canonical mapping remain unverified.
See the [GA discovery record](2026-10-06-precomputed-video-recommendation-ga-discovery.md).

The user explicitly restricted historical evidence to verified JesusFilm.org
hosts and exact `/watch` or `/watch/` descendants. Query strings/fragments do not
change scope; unrelated hosts, `/watching`, and other pages are excluded. The
current event source or a verified aggregate transition source and canonical
Video mapping remain unresolved. Remote ADC is now saved with owner-only
permissions and BigQuery API metadata reads succeed. Current GA reports also
contain Watch data: the exact host/path-filtered September 8–October 5 report
shows 283,064 page views and 1,014 `videostarts`. Older warehouse-copy dates do
not describe the live GA reporting range. The direct GA Data API probe failed
with insufficient OAuth scopes because the sign-in command omitted
`analytics.readonly`. Adding it to the default ADC client was subsequently
blocked by Google. The installed SDK lists that scope as being blocked for its
default client; a supported project-owned OAuth client or appropriately
configured service identity was required. The existing Cloud credentials remain
present. No policy bypass was attempted.
Tatai subsequently supplied project `jesusfilm-org-1738781064783` and service
account `watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com`.
Remote impersonation with `analytics.readonly` now succeeds using the existing
Cloud ADC login, and GA Data/Admin API reads return HTTP 200. No downloaded key,
new user login, or agent-created IAM change was needed. The standard API request
works without a quota-project override; explicitly overriding the quota project
returned `USER_PROJECT_DENIED`, so no additional role was requested for that
unnecessary override. API authentication is resolved.

The Watch-filtered report from property creation (June 21, 2022) through October
3, 2026 returned all 200 monthly/event aggregate rows, including 4,006,892
`videostarts` across September 2022–October 2026. This is report coverage, not
verified complete raw-event history. Recent video-ID coverage is incomplete:
720 of 1,017 starts in a separate September 8–October 5 observation have an empty
or unset `mediacomponentid`. Page paths provide a mapping lead. The dedicated
TypeScript reader performs scoped reads with bounded pagination, property-local
cutoff guards and explicit source truncation. Actual live coverage and aggregate
page reads passed; they do not yet constitute a qualified model build.

On 2026-10-06 the user approved validated Watch referrer links plus engagement
for the first build, labeled as navigation evidence. This replaces the original
requirement to prove consecutive playback for this GA input. A bounded probe
confirmed 450,061 destination starts with a Watch referrer, including homepage
and self-referrals, and retrieved 100 of 163,347 pair rows. One pair associated
1,648 starts of the Spanish Birth of Jesus page with the Spanish The Beginning
referrer. These are aggregate associations, not unique navigations or individual
journeys. Canonical endpoint mapping and the connected model-to-Admin build
remain to be verified. Provider-declared historical gaps stay unknown even when
all pages of the separately declared usable interval have been processed.

#2568 navigation ingestion is in progress in both Sol chats; #2569 remains held
until its acceptance is integrated and verified. No unavailable transition,
exposure, bot-filter, or exclusion count becomes zero. No new export/link or
warehouse write is authorized.

#2573 live winner certification remains incomplete: the measured human baseline,
agreed numeric stopping settings, trusted bot qualification, and tracking-loss
evidence are absent. Production cookie forwarding, actual catalog cost, and
measured capacity/headroom also remain prerequisites where required. Fixtures
cannot satisfy these criteria. #2574 and #2575 remain undispatched.

Public experimental serving stays default-off and the incumbent remains available.
Do not merge, deploy, start public A/B traffic, promote a winner, or enable refresh
scheduling without the separate required authority. Preserve useful worktrees and
the owned PostgreSQL 18 integration database on loopback port `32810`.
