---
date: 2026-10-05
title: Precomputed recommendation ticket review
status: published
roadmap: feat-590
tracker: JesusFilm/forge
publication: verified
issue_url: https://github.com/JesusFilm/forge/issues/2565
---

# Precomputed recommendation ticket review

The user approved the testing boundaries and ticket breakdown. The spec is
published as [#2565](https://github.com/JesusFilm/forge/issues/2565), with ten
child issues. Issue bodies, readiness labels, native parent relationships, and
the native dependency graph were re-fetched and verified. Local review numbers
below map to GitHub issues in the publication table.

The user confirmed that Sandcastle was intentionally removed. Its runner check
is no longer applicable; GitHub verification passed independently. Implementation
will use orchestrated Codex chats directly.

The kickoff prompt is saved as
`docs/plans/2026-10-05-precomputed-video-recommendation-orchestrator-prompt.md`.
It directs a future orchestrator to create GPT-6 Sol chats, use Matt Pocock's
implement workflow, and prohibit Compound Engineering skills. No implementation
chats were started while creating this prompt.

## Published issues

| Review ID | GitHub issue                                            | Blocked by   |
| --------- | ------------------------------------------------------- | ------------ |
| 01        | [#2566](https://github.com/JesusFilm/forge/issues/2566) | None         |
| 02        | [#2567](https://github.com/JesusFilm/forge/issues/2567) | #2566        |
| 03        | [#2568](https://github.com/JesusFilm/forge/issues/2568) | #2567        |
| 04        | [#2569](https://github.com/JesusFilm/forge/issues/2569) | #2568        |
| 05        | [#2570](https://github.com/JesusFilm/forge/issues/2570) | #2566        |
| 06        | [#2571](https://github.com/JesusFilm/forge/issues/2571) | #2570        |
| 07        | [#2572](https://github.com/JesusFilm/forge/issues/2572) | #2571        |
| 08        | [#2573](https://github.com/JesusFilm/forge/issues/2573) | #2572        |
| 09        | [#2574](https://github.com/JesusFilm/forge/issues/2574) | #2569, #2573 |
| 10        | [#2575](https://github.com/JesusFilm/forge/issues/2575) | #2574        |

## Approved testing boundaries

1. **Build to Admin review:** invoke the authenticated generation path with
   controlled provider/warehouse inputs, persist through actual Admin contracts
   into native PostgreSQL, and inspect the saved comparison and build report.
2. **Watch to experiment result:** use the existing Web-to-Admin serving and
   evidence contracts, then verify persisted visit/click counts and the result
   through the authorized report surface.

Native database tests prove transaction, identity, retention, and physical-size
claims within those boundaries. Focused browser checks prove the comparison,
card behavior, navigation, and loading impact. Tests assert observable outcomes;
controlled providers do not stand in for database or attribution correctness.

## Approved breakdown

| Draft | Ticket                                                     | Blocked by | Independently verifiable delivery                                                     |
| ----- | ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| 01    | Inspect saved recommendations in Admin                     | None       | A stored fixture generation is reviewable beside the incumbent, with reasons/evidence |
| 02    | Generate explainable source recommendations with Astra     | 01         | A selected source's model-generated connections appear in the Admin comparison        |
| 03    | Use historical analytics in model decisions                | 02         | Qualified warehouse evidence informs a source build and has visible provenance        |
| 04    | Complete and refresh catalog generations with cost reports | 03         | A resumable catalog build produces a complete private generation and actual usage     |
| 05    | Serve saved recommendations on private Watch previews      | 01         | The existing Watch row serves saved, language-filtered choices and correct recovery   |
| 06    | Assign stable A/B arms and count eligible visits           | 05         | Private test visits keep their arm and count even when delivery returns no cards      |
| 07    | Count recommendation clicks against eligible visits        | 06         | Clicks join to actual served cards and contribute at most once per eligible visit     |
| 08    | Publish durable CTR results without activating a winner    | 07         | Admin and an authorized AI retrieve the same qualified, versioned result              |
| 09    | Bound experiment storage and prove cleanup capacity        | 04, 08     | Combined build/traffic storage is measured, bounded, and safely cleaned               |
| 10    | Control A/B launch, promotion, and rollback manually       | 09         | Explicit authorized controls pass an isolated launch/evaluate/promote/rollback run    |

Only immediate blockers are listed; transitive prerequisites are inherited.
The first preview enables two paths: generation and private Watch measurement.
The Watch path uses fixture generations while warehouse access is pending. The
storage slice joins both paths because it must measure their combined footprint.

Each ticket includes its own behavior, scope, and verification. These are
vertical slices, not separate schema/API/UI work queues. Final rehearsal
supplements, rather than replaces, verification in each preceding ticket.

## Requirement coverage

User story numbers refer to the spec's numbered list.

| User stories | Delivering tickets |
| ------------ | ------------------ |
| 1–11         | 01, 02, 05, 07     |
| 12–17        | 01, 02, 04         |
| 18–22        | 03                 |
| 23–24        | 01, 02, 03, 05     |
| 25–29        | 04, 09, 10         |
| 30–33        | 06, 07, 08         |
| 34–37        | 07, 08             |
| 38–39        | 08, 10             |
| 40           | 10                 |
| 41–42        | 01, 04, 08, 09     |
| 43           | 10                 |

Historical warehouse reads remain included. BigQuery export, new analytics
infrastructure, automatic promotion, and an automatically selected refresh
schedule remain excluded throughout.

## External inputs and release boundaries

- Warehouse location/schema and authenticated read access are needed for live
  history-backed execution. Fixture adapter tests can proceed without them.
- Model account access is needed for a live Astra smoke and the first catalog
  run. Fixture results never establish model quality or actual spending.
- Human traffic, trusted bot signals, and the selected inference method inform
  the numeric stopping rule before public A/B start.
- Physical volume headroom and retention throughput determine storage readiness.
  The large-build preflight must protect capacity before the first real run;
  the combined capacity slice strengthens it with measured production-shaped data.
- Public launch and later promotion remain explicit operations after code
  delivery. Missing input or readiness evidence leaves those operations disabled;
  it does not justify inventing a passing result.

## Publication procedure used

1. Publish the reviewed spec to JesusFilm/forge with the configured
   `ready-for-agent` label; record its URL in the roadmap and local spec metadata.
2. Publish the approved child tickets in dependency order, replacing draft
   parent and blocker references with actual GitHub issue identities. Keep
   dependent issues out of the runnable set until native relationships exist.
3. Use native GitHub sub-issue and blocked-by relationships, then apply the
   readiness label to the child tickets. A parent spec remains a parent rather
   than a directly executable implementation ticket.
4. Re-fetch every issue and verify the required headings, readiness label,
   parent, and native dependency graph. An unblocked ticket's Blocked by section
   must be exactly `None (can start immediately).`; blocked tickets contain only
   one `- #<issue-number>` line per blocker.
5. Sandcastle runner verification is not applicable after its user-requested
   removal. Validate through GitHub directly and keep feature-level roadmap
   status in progress.

The parent title/body was not edited by the ticket-publication step. All local
child bodies now contain their real parent and blocker references. The verified
issue graph is also recorded in `publication.json`. Unrelated existing issues
and workspace edits remain outside this task.
