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
- Latest integrated source commits: `acbb33fe45e6bf213df33878340d4fb32ae455e3`
  and `302dffe31ee140022ff8a416087043b1cdbc5425` for #2573. Application/package
  files match those reviewed worker bytes; root also clarified the operations
  note and consolidated this ledger.
- The PR records the current published integration SHA and [CI checks](https://github.com/JesusFilm/forge/pull/2578/checks).
  The preceding published head `af8eba415` passed 42 checks with six skipped.
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
| #2568 | #2567              | Fixture integrated; live blocked            | `b1703cd8c`, `acbe43fc7`; GA access pending              |
| #2569 | #2568              | Waiting for prerequisites                   | Unassigned                                               |
| #2570 | #2566              | Integrated-and-verified                     | `0a93244a3`; private Watch serving                       |
| #2571 | #2570              | Integrated-and-verified                     | `267a65281`, `b69592b6c`, corrections in `a7f36d778`     |
| #2572 | #2571              | Integrated-and-verified                     | Core `a7f36d778`, UI `af8eba415`                         |
| #2573 | #2572              | Private reporting verified; live incomplete | Sources `acbb33fe4`, `302dffe31`; migration `0134`       |
| #2574 | #2569, #2573       | Waiting for prerequisites                   | Unassigned                                               |
| #2575 | #2574              | Waiting for prerequisites                   | Unassigned                                               |

## Ownership and continuation

Worker B owns #2573 fixes: `01a10a28-aa8e-7080-b3d1-c59293f8f4dd`, titled
`#2573 Publish durable CTR results without activating a winner`.
Checkout: `/home/nisal/.codex/worktrees/feat-590-2570/forge`;
branch: `codex/feat-590-2573`. Its two source commits are integrated; preserve
this checkout for any CI correction. Earlier branches are preserved.

Worker A, `01a109e1-47c8-7043-bfd4-a85592cfafc5`, completed the final whole-spec
review and remains available for the GA handoff. Its current title is
`#2565 Review integrated precomputed recommendations`.
Checkout: `/home/nisal/.codex/worktrees/feat-590-2566/forge`;
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

## External inputs and boundaries

At 05:05 UTC, the user was notified that GA access setup had been reached and
asked to inspect the Watch property's existing **Admin → Product Links → BigQuery
Links** entry and provide non-secret project/property IDs. No human answer has
arrived. Provider, dataset/location, history, schema, canonical Video mapping,
and read authorization remain unverified. No new export/link or warehouse write
is authorized. #2568 live acceptance and #2569 remain blocked.

#2573 live winner certification remains incomplete: the measured human baseline,
agreed numeric stopping settings, trusted bot qualification, and tracking-loss
evidence are absent. Production cookie forwarding, actual catalog cost, and
measured capacity/headroom also remain prerequisites where required. Fixtures
cannot satisfy these criteria. #2574 and #2575 remain undispatched.

Public experimental serving stays default-off and the incumbent remains available.
Do not merge, deploy, start public A/B traffic, promote a winner, or enable refresh
scheduling without the separate required authority. Preserve useful worktrees and
the owned PostgreSQL 18 integration database on loopback port `32810`.
