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
- Latest source commit: `c9b9d6fd6fc283dc810769a1f8baca03113b4a1d` for the
  #2568 qualification continuation. Root verified its tree matches independent
  review and that integrated application/package/test files match exactly.
  Earlier #2573 sources are `acbb33fe4` and `302dffe31`.
- The PR records the current published integration SHA and [CI checks](https://github.com/JesusFilm/forge/pull/2578/checks).
  Previous published head `9e0cd06c2` passed 44 checks with six skipped; its main CI
  workflow passed 37 jobs with three skipped.
- The original dirty `/home/nisal/forge` checkout is preserved.
- Development chats use exactly `gpt-6-sol`; the application model remains
  `gpt-6-astra`. Matt Pocock implement/TDD/code-review workflow only; no
  Compound Engineering skills or agents. Normal hooks remain required.

## Execution ledger

All issues remain open until merge. Dependencies advance on verified acceptance,
not issue closure. Implemented, integrated, merged, and live are distinct.

| Issue | Immediate blockers | State                                            | Integrated work                                          |
| ----- | ------------------ | ------------------------------------------------ | -------------------------------------------------------- |
| #2566 | None               | Integrated-and-verified                          | `9a984c544`; saved Admin comparison                      |
| #2567 | #2566              | Integrated-and-verified                          | `c89db0e4e`; bounded Astra producer; no live model smoke |
| #2568 | #2567              | Fixture and qualification verified; live blocked | `b1703cd8c`, `acbe43fc7`, source `c9b9d6fd6`             |
| #2569 | #2568              | Waiting for prerequisites                        | Unassigned                                               |
| #2570 | #2566              | Integrated-and-verified                          | `0a93244a3`; private Watch serving                       |
| #2571 | #2570              | Integrated-and-verified                          | `267a65281`, `b69592b6c`, corrections in `a7f36d778`     |
| #2572 | #2571              | Integrated-and-verified                          | Core `a7f36d778`, UI `af8eba415`                         |
| #2573 | #2572              | Private reporting verified; live incomplete      | Sources `acbb33fe4`, `302dffe31`; migration `0134`       |
| #2574 | #2569, #2573       | Waiting for prerequisites                        | Unassigned                                               |
| #2575 | #2574              | Waiting for prerequisites                        | Unassigned                                               |

## Ownership and continuation

Worker B is reusable for #2573 fixes and #2568 mapping/review:
`01a10a28-aa8e-7080-b3d1-c59293f8f4dd`, currently titled
`#2568 Verify Admin loading impact`.
Checkout: `/home/nisal/.codex/worktrees/feat-590-2570/forge`;
preserved branch: `codex/feat-590-2573`. Its two source commits are integrated;
preserve this checkout for any CI correction. Its read-only mapping investigation confirmed
Core GraphQL IDs are preserved as Admin `Video.coreId`, but found no proven
warehouse-to-Core bridge. Earlier branches are preserved.
Its temporary loading verification uses `codex/feat-590-2568-loading` from
`c9b9d6fd6`, without changing committed application code.

Worker A, `01a109e1-47c8-7043-bfd4-a85592cfafc5`, owns the independent #2568
Watch-scope/source-qualification continuation, based on `9e0cd06c2`, now committed
as `c9b9d6fd6` and verified in combination. Its title is
`#2568 Enforce Watch scope and source qualification`. Current-source discovery
and server API authentication remain with the orchestrator.
Checkout: `/home/nisal/.codex/worktrees/feat-590-2566/forge`;
current branch: `codex/feat-590-2568-watch-scope`. Earlier
`codex/feat-590-2571-retention-health` and `codex/feat-590-2568` are preserved.
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
current event source or a verified aggregate transition source, canonical Video
mapping, and local/server API authentication remain unresolved. Browser login
does not establish API authentication. No new export/link or warehouse write is
authorized. #2568 live acceptance and #2569 remain blocked; its independent
qualification boundary is verified. A real source reader must still implement
and prove URL filtering and transition ordering; validating declarations does
not execute either operation.

#2573 live winner certification remains incomplete: the measured human baseline,
agreed numeric stopping settings, trusted bot qualification, and tracking-loss
evidence are absent. Production cookie forwarding, actual catalog cost, and
measured capacity/headroom also remain prerequisites where required. Fixtures
cannot satisfy these criteria. #2574 and #2575 remain undispatched.

Public experimental serving stays default-off and the incumbent remains available.
Do not merge, deploy, start public A/B traffic, promote a winner, or enable refresh
scheduling without the separate required authority. Preserve useful worktrees and
the owned PostgreSQL 18 integration database on loopback port `32810`.
