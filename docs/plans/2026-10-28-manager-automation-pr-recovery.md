# Manager automation and enrichment PR recovery

## Goal

Bring existing PRs #870, #886, #1087 and #916 to a genuinely mergeable state, including working recurring automation support. User explicitly authorized delegated work and repeated implementation/review/fix loops. Do not merge or deploy production.

## Units and ownership

1. Automation foundation and #870: Admin owns durable automation definitions, run history, atomic leases, candidate selection and recurring execution. Manager uses Admin GraphQL, with generated SDL/introspection updated together. Adapt the old Agentic dry-run workflow to the current Mastra app rather than restoring retired apps or Strapi clients. Root owns Admin schema, migrations, generated artifacts and this integration.
2. #886: complete real subtitle execution using current Mastra service boundaries; preserve Manager artifact/state ownership and Mux synchronization. Work in an isolated checkout. Do not change Admin schema or generated clients. Begin with failing proof for the prototype-only path and report evidence.
3. #1087: first audit its current green branch and ownership gates without changes. Implement its graph after the subtitle runtime contract is committed; preserve callback admission, run ownership, default-off engine controls and existing security fixes.
4. #916: recover the remaining mobile shell/modal improvements onto current main in an isolated checkout. Preserve the current JSON response fix and explicit final-click creation. Keep established colors and verify desktop/mobile layouts plus page-load performance.

The two backend execution PRs share contracts and therefore integrate sequentially. UI work may proceed in parallel. Keep historical branch tips recoverable; do not overwrite an active worktree. Root owns final PR updates and integration. Delegates may commit isolated unit results, but must not merge PRs or deploy.

## Verification and loop

For each unit inspect existing tests, gather failing or characterization evidence, implement, run focused tests, typecheck, lint and formatting. Exercise real database concurrency/recovery for automation persistence and real callback/artifact chains for execution. Use deterministic adapters for provider tests; do not claim paid live execution from mocks. Browser smoke must cover the source-subtitle dry-run creation shown in the report, persistence, manual report, scheduling and pause/resume, as well as mobile modal behavior.

Run independent source/security reviews against exact candidate commits. Apply actionable findings and repeat; preserve previous findings and responses in each review round. Update PR descriptions around the final scope, resolve conflicts, publish validated branches, and use T3 CI watching to resume after check events. A green placeholder is incomplete. A PR is ready only with no unresolved material findings, required checks passing, and a clean merge base (or a clearly declared stack dependency).

## Tracking

Root automation work: feat-907. Use existing branch tickets for #886 and #1087, reserving feat-892 and feat-908 if new recovery tickets are needed. UI recovery reserves feat-891. Do not allocate colliding IDs independently. Record progress outside this plan body.
