# Restore the normal Studio narration and render workflow

Scope: feat-491 and feat-492. Recover the six retained Peace in the Storm
recordings through canonical narration completion, and fix the isolated hosted
renderer stall so the saved project reaches normal signed Mux review.

## Diagnosis and implementation

1. Reproduce attachment with the actual speech/settings and manifest structure
   in the owned loopback test database. Exercise Manager execution and Admin
   completion, preserving exact identity checks and avoiding provider dispatch.
2. Replay the retained render input and media in an owned VM qualification job.
   Capture stderr, process/thread limits, progress and retirement. Keep the
   production containment profile and deadline intact.
3. Minimize each failure, state falsifiable hypotheses, and add regression
   coverage at the failing seam before changing production code.
4. Verify scoped tests, types, formatting and CI-sensitive checks. Record the
   established causes and recovery behavior in the solution store.

## Release and acceptance

Use reviewed PR-to-main changes and automatic Railway deployment. Publish and
select any renderer update through the existing main-only immutable release
workflow; never upload local worktree code to the production worker.

Use cached narration in a current-revision admission, retain the requested
60-second layout, render through Studio, and verify all six spoken sections in
the normal Mux review. Do not publish to Watch. Mark tickets complete only after
their acceptance checks pass; retain earlier failed-run evidence.
