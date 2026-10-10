---
date: 2026-04-12
topic: manager-job-detail-error-log-visibility
related:
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md
  - docs/brainstorms/2026-04-12-job-detail-enrichment-review-player-brainstorm.md
  - docs/plans/2026-04-12-feat-job-detail-enrichment-review-player-plan.md
  - docs/solutions/integration-issues/manager-transcription-routing-artifact-boundary-20260412.md
  - docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md
  - docs/solutions/ui-bugs/manager-review-player-before-after-toggle-buttons-2026-04-12.md
---

# Manager Job Detail Error Log Visibility

## What We're Building

Hide the manager job detail `Error Log` card unless the job has logged errors.
The page already treats `job.errors` as the source of truth for error details:
the header only links to `#error-log` when `job.errors.length > 0`, while the
body still renders a full error card with `No errors recorded.` for clean jobs.

The requested behavior is to make the body match the header. Jobs with errors
should keep the current detailed table and anchor target. Jobs without logged
errors should not spend page space on an empty diagnostic block, so the review
player and remaining job detail content can move up naturally.

## Why This Approach

The recommended approach is the smallest product change: render the existing
error section only when `job.errors.length > 0`.

We considered three options:

- Hide the error card entirely when there are no errors. This matches the user
  request, preserves the existing data contract, and avoids introducing a new
  empty-state pattern for a diagnostic-only block.
- Keep a smaller "No errors" status row. This would preserve an explicit clean
  signal, but the job header and status badge already carry normal job state,
  and a new mini-state would add page chrome without helping operators act.
- Show the block for failed jobs even when `job.errors` is empty. This protects
  against inconsistent job data, but it would turn an instrumentation gap into
  UI behavior. Planning should instead verify failed jobs normally persist at
  least one `JobError`.

## Key Decisions

- Use `job.errors` as the only visibility gate for the error block.
- Preserve the existing error table, count, formatting, and `#error-log` anchor
  whenever `job.errors.length > 0`.
- Remove the visible `No errors recorded.` card state from job details.
- Do not change how errors are recorded, normalized, or appended to job state.
- Let the review player remain below the error section when errors exist and
  move directly below the steps table when errors do not exist.
- Treat a failed job with no `job.errors` entries as a data-recording concern
  for a separate follow-up, not as a reason to keep an empty block visible.

## Resolved Questions

- The empty state should disappear entirely, not shrink into a smaller status
  row.
- The change should be scoped to Manager job details, not the jobs list or
  workflow error recording.
- The existing header behavior is the pattern to mirror: only expose the Error
  Log affordance when errors are present.
- The review player docs that say "below Error Log" still apply when errors
  exist; when there are no errors, the hidden block simply stops occupying that
  spot.

## Open Questions

No product-level blockers remain for planning.

## Next Steps

Proceed to planning for a narrow Manager UI fix. The likely implementation
entry point is `apps/manager/src/features/jobs/live-job-detail-screen.tsx`, with
verification focused on both zero-error jobs and jobs with at least one logged
error.
