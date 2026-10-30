---
date: 2026-10-05
draft_id: "04"
title: "Complete and refresh catalog generations with cost reports"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2569
roadmap: feat-590
draft_blocked_by: ["03"]
---

# 04: Complete and refresh catalog generations with cost reports

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Turn the source-generation path into a repeatable catalog build that can resume
after interruption, complete atomically, and publish a private generation and
cost/coverage report in Admin. A later refresh includes new content and analytics
and reconsiders old sources for newly possible connections.

Provide the same authenticated refresh entry point for future scheduling, but
leave recurring execution disabled until the user chooses cadence after seeing
the first actual build report.

## Acceptance criteria

- [ ] A build declares its catalog/input cutoff and accounts for every eligible source as completed with connections, completed with no accepted connections, or failed. Failure is not silently recorded as valid empty coverage.
- [ ] Batches/checkpoints are resumable and idempotent; duplicate callbacks/retries do not duplicate edges, and stale attempts cannot complete a newer build.
- [ ] A generation becomes ready for private review only after all required source work and validation complete. Failed/partial builds preserve the previous complete generation.
- [ ] Refreshing with a new target or new analytics can change recommendations for existing sources, not only newly added sources.
- [ ] Admin displays progress, qualified failures/coverage, model usage/cost, warehouse query usage/cost, elapsed time, and resulting stored size. Real retry charges remain included; estimated billing is labeled.
- [ ] The first build has no user-imposed model spend/runtime ceiling. Per-call reliability limits, cancellation, and bounded checkpoint/diagnostic retention still apply; no unlimited raw-output history is created.
- [ ] Large build writes require a capacity preflight. Insufficient storage stops the attempt explicitly and preserves the previous complete generation rather than silently truncating accepted connections or exhausting protected headroom.
- [ ] A fixed A/B generation cannot be mutated by a refresh. Build completion never activates public serving.
- [ ] Native persistence and workflow tests cover interruption/resume, replay, stale completion, a failed source, explicit empty success, complete publication, new-target discovery, and cost accounting.
- [ ] A runnable first-build procedure distinguishes fixture evidence from an actual authorized catalog run. Missing warehouse/model access is an explicit run prerequisite, not a successful execution claim.
- [ ] No schedule is enabled automatically. Future cadence can be configured without creating a second generation path.

## Implementation context

Use existing runtime checkpoints and authenticated Admin generation contracts.
Keep model payloads out of broad workflow history. Coordinate through durable
generation state rather than an in-memory loop that loses progress on restart.
Public activation and storage-capacity acceptance are separate dependent slices.

## Blocked by

- #2568

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
