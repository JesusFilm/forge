---
title: Recommendation measurement and co-watch shadow integration
type: feat
status: active
date: 2026-09-28
---

## Scope and authority

Deliver the independent scopes of feat-387, feat-373, and feat-545 through focused
pull requests. The source requirements are their content-discovery roadmap tickets
and U20/U6 in `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md`.
This batch authorizes implementation, shadow inspection, evidence review, and CI
repairs. It does not authorize changing production flags, broadening the pilot,
activating experiments, promoting candidates, direct production deployment, or
installing deferred monitoring resources.

The starting revision is `7bfed3f9fc228bfd5e3353697f91d7e6a05c9464` from
`origin/main`. Existing open PRs and active tasks were checked before dispatch;
no duplicate implementation of these three tickets was found. PR #2410 already
records the Datadog deferral. The shared checkout contains unrelated uncommitted
work and is excluded from all edits.

## Ownership and sequencing

| Scope       | Owner                    | Files and boundary                                                                                                                             |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| feat-387    | Dedicated GPT-6 Sol task | Co-watch-specific Admin services, projection, workflow, candidate contract, inspection UI, tests, own ticket and evidence                      |
| feat-373    | Dedicated GPT-6 Sol task | Watch exposure registry and primitive, surface instrumentation, bounded ingestion and Admin exposure reporting, tests, own ticket and evidence |
| feat-545    | Dedicated GPT-6 Sol task | Existing-evidence reconciliation, bounded read-only diagnostics, own ticket and evidence; runtime changes only for demonstrated defects        |
| Integration | Parent                   | `docs/roadmap/README.md`, reciprocal dependency changes if justified, cross-PR review, integration verification, release record                |

Each implementation task uses a distinct Git branch and worktree. Shared Prisma,
GraphQL assembly, and Admin navigation changes are possible integration points;
review these before merging. Generated GraphQL outputs must be regenerated from
the combined schema. No dependency is introduced between feat-373 and feat-387.
Any new roadmap ID is allocated by the parent.

## Requirements and acceptance

1. **Co-watch:** eligible finalized revision contributions, ordered bounded
   transitions, session/pair/distinct-viewer deduplication, decay and quality
   weights, support/confidence/shrinkage, popularity-corrected lift, versioned
   published features, profile-selected anchors, semantic fallback, and an
   inspectable shadow terminal decision. Prove revision replacement, deletion,
   and rebuild equivalence. Live candidate delivery must remain unchanged.
2. **Exposure:** finite registry and one portable visibility/dwell primitive;
   separate served, rendered, eligible, selected, repeated and capability states;
   expose partial instrumentation explicitly. Early selection never creates an
   impression. Admin reconciles counts, CTR dimensions, duplicate rate, gaps and
   capability. Telemetry must not block Watch or player startup.
3. **Closeout:** every retained discrepancy needs an evidence-backed resolution
   or an explicit owner-accepted limitation. Historical missing joins cannot be
   inferred from fresh success. Keep browser status-zero observations separate
   and require continued trusted activity/non-retry evidence for natural 409s.
4. **Status:** completion requires the ticket's Admin/evidence gates; code
   availability, deployment, shadow evaluation, and live exposure are reported
   independently. Keep feat-545 open and its downstream blocks intact when the
   evidence remains insufficient.

## Parent verification

- Confirm direct prerequisites and reciprocal dependencies for the three tickets.
- Review each focused diff for correctness, tests, maintainability, repository
  standards, agent access and relevant prior learnings, plus security, contracts,
  persistence, reliability and performance where the diff warrants them.
- Check co-watch cannot enter live delivery; confirm privacy-generation fencing,
  bounded queries and immutable publication, and inspect real-Postgres evidence.
- Check exposure window boundaries, hidden-tab and carousel behavior, replay and
  unsupported visibility capability. Require real-browser and comparative
  page-loading evidence beyond unit assertions.
- Check closeout evidence populations, dates, units and missing-data statements
  against retained source artifacts, without duplicating broad production audits.
- Run appropriate combined tests, types, lint, schema drift and formatting after
  resolving overlapping changes. Regenerate the roadmap index once from the
  integrated ticket states and validate its lint/format and reciprocal links.
- Follow all focused PR checks through completion; resolve failures and actionable
  review findings. Production verification follows only the normal PR-to-main
  deployment path, with no manual deployments or activation changes.

## Known evidence boundary

All of feat-387's direct prerequisites and feat-373's feat-368 prerequisite are
recorded complete at the starting revision. Some upstream completed infrastructure
tickets retain dependencies on later unfinished readiness work. This historical
roadmap shape does not establish readiness for live influence. This batch
preserves the shadow boundary and does not rewrite those unrelated dependencies.

## Durable reporting

Maintain a final integration record under `docs/operations/` with the reviewed
commit and PR identities, checks and their limitations, ticket status, remaining
evidence, and deployment/exposure state. Capture only reusable implementation or
verification findings in `docs/solutions/`; avoid restating the activity log.
