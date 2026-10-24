# Subtitle recovery credential boundary — feat-787

Scope: PR #2350 only, starting at `213a3d7daad176ebc579fdfe44897d055b599a74`, in the existing registered worktree. No base integration is required for this mergeable PR; preserve published history and the `main` target.

## Plan

1. Remove caller-controlled configuration from both registered schemas. Revalidate the step input before any transport, including direct step/time-travel entry paths.
2. Keep trusted test dependencies in a separate code-only argument. Execute resolves only mapped operator env; it never forwards caller data as dependencies.
3. Pin the already documented public Manager host and recovery endpoint, reject userinfo/fragments/queries and any alternate destination or transport, and set `redirect: "error"`. No recovery-specific private/local exception is documented, so none is introduced.
4. Verify dummy-only schema/execute wiring, env mapping/default execution, redirect refusal, timeouts, byte cancellation, counts and safe errors. Preserve evented scheduling without starting a scheduler or workflow.
5. Run guarded scoped validation, self-review, compound durable guidance and create one local commit. Hand exact evidence to a fresh independent reviewer; do not push or change PR state.

## Allocation and validation boundaries

The branch's maximum roadmap ID was 522; live `origin/main` at `aa3c8fe7a32c82661a7296c90ca64a5ff6109f20` has maximum 786. No parent triage allocation reserves 787. Allocate feat-787 in the platform lane; do not renumber existing collisions or complete the broader feat-397 Lab ticket.

Use existing dependencies. Put test caches, temporary files, typecheck build info and evidence under `/mnt/worktrees/checkouts/t3/Forge/pr-triage-20261024-r1/2350-implementation/`. No installs, build, live endpoints, secrets, paid models or background heavy processes are needed.
