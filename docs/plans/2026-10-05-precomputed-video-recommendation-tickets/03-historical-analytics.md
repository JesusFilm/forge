---
date: 2026-10-05
draft_id: "03"
title: "Use historical analytics in model decisions"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2568
roadmap: feat-590
draft_blocked_by: ["02"]
---

# 03: Use historical analytics in model decisions

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Allow the offline source-generation workflow to explore the authorized historical
GA warehouse through read-only tools and use qualified aggregate evidence in
recommendation decisions. Admin shows the source coverage and provenance used by
the saved result, including gaps and uncertain historical bot filtering.

The warehouse is believed to be BigQuery but its location and access are not yet
verified. Build the adapter with explicit fixtures while access is pending;
do not invent a dataset or treat the existing GA4 summary client as a warehouse.

## Acceptance criteria

- [ ] Source discovery verifies the provider, schema, history, and Video identifier mapping once authorized access is available. Without it, the operation reports unavailable input rather than a successful history-backed build.
- [ ] Authentication stays server-side and tools are read-only. Keys, credentials, and individual viewer identities do not enter model prompts or saved recommendation output.
- [ ] The model can inspect definitions and query the full authorized historical range through bounded/paginated responses. Truncation and incomplete pagination are visible and never presented as complete coverage.
- [ ] Suitable engagement and video-transition aggregates are computed at the source. Legacy IDs/URLs map to canonical Videos; unknown mappings are reported rather than guessed.
- [ ] The model can weigh content and analytics while still requiring an explainable connection. Lack of exposure is not treated as evidence of poor quality.
- [ ] Native and warehouse evidence retain separate provenance and are not double-counted. Unknown historic bot filtering is labeled unknown, while live A/B eligibility retains its separate policy.
- [ ] Saved build metadata includes query/range/cutoff, result hashes/counts, measurement qualification, mapping coverage, and query usage/cost qualification without storing raw user-level warehouse rows.
- [ ] Adapter and build-to-review tests cover missing access, schema/mapping gaps, pagination, zero metrics, missing exposure, overlapping evidence, and read-only enforcement.
- [ ] No BigQuery export, write identity, destination dataset, export outbox, or new analytics database is introduced.

## Implementation context

The non-secret warehouse location and authorized service configuration are
external inputs for a live smoke. Their absence must not be hidden by fixtures.
Reuse Google authentication patterns without assuming existing SEO permissions
authorize this warehouse.

## Blocked by

- #2567

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
