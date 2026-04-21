---
status: complete
priority: p2
issue_id: "023"
tags: [manager, auth, embeddings, config, api]
dependencies: []
---

# Remove `MANAGER_EMBEDDING_OVERRIDE_API_KEY` and use generic `MANAGER_API_KEY` for override approval

## Problem Statement

The manager override route currently uses a dedicated `MANAGER_EMBEDDING_OVERRIDE_API_KEY` for programmatic approval of destructive embedding overrides. The team has decided that this extra secret is not worth the added configuration overhead, and that generic `MANAGER_API_KEY` callers should be allowed to approve overrides again even though that reintroduces the previously identified broad-credential review finding.

## Findings

- `apps/manager/src/lib/auth.ts` currently validates Bearer callers for the override route against `MANAGER_EMBEDDING_OVERRIDE_API_KEY`, not `MANAGER_API_KEY`.
- `apps/manager/src/config/env.ts` exposes `MANAGER_EMBEDDING_OVERRIDE_API_KEY` as a distinct manager env var.
- `apps/manager/src/lib/auth.test.ts` now asserts that the generic manager key is rejected for override approval.
- The dedicated override key was introduced as a response to a review finding about overly broad manager credentials being able to approve CMS overwrites.
- The team explicitly accepts reintroducing that finding in exchange for a simpler auth/config story.

## Proposed Solutions

### Option 1: Remove `MANAGER_EMBEDDING_OVERRIDE_API_KEY` entirely

**Approach:** Delete the dedicated override API key config and switch the override route auth helper back to validating programmatic callers with `MANAGER_API_KEY`.

**Pros:**

- Simplest manager deployment config
- Restores one-key behavior for programmatic manager clients
- Reduces auth branching in the override path

**Cons:**

- Reintroduces the broad-credential risk that any valid manager API key can approve destructive CMS overwrites
- Loses a narrower boundary for override-specific automation

**Effort:** 1-2 hours

**Risk:** Medium

---

### Option 2: Keep the override key but support `MANAGER_API_KEY` as an alias

**Approach:** Accept both keys temporarily, then decide later whether to remove the dedicated override key.

**Pros:**

- Lower rollout friction
- Keeps the narrower credential available for clients that want it

**Cons:**

- Does not actually simplify the auth model
- Keeps the broader-credential finding alive anyway

**Effort:** 1-2 hours

**Risk:** Low

## Recommended Action

Implement Option 1. Remove `MANAGER_EMBEDDING_OVERRIDE_API_KEY` from manager config and tests, switch override-programmatic auth back to `MANAGER_API_KEY`, and update tests/messages accordingly. Leave a note in code review or docs that the broad manager-credential tradeoff is intentional.

## Technical Details

**Affected files:**

- `apps/manager/src/config/env.ts`
- `apps/manager/src/lib/auth.ts`
- `apps/manager/src/lib/auth.test.ts`
- `apps/manager/src/app/api/jobs/[id]/embedding-sync/override/route.test.ts`
- `apps/manager/vitest.setup.ts`
- Any docs/tests mentioning `MANAGER_EMBEDDING_OVERRIDE_API_KEY`

**Database changes (if any):**

- No schema change required.

## Resources

- `todos/009-complete-p2-scope-programmatic-override-authority.md`
- `todos/010-complete-p2-bind-override-route-to-reviewed-compare-state.md`

## Acceptance Criteria

- [x] `MANAGER_EMBEDDING_OVERRIDE_API_KEY` is removed from active manager config paths.
- [x] Programmatic override approval uses `MANAGER_API_KEY`.
- [x] Tests are updated to reflect the accepted broad-manager-key behavior.
- [x] The intentional security tradeoff is documented in the todo/work log or associated review context.

## Work Log

### 2026-04-10 - Created

**By:** Codex

**Actions:**

- Reviewed the dedicated override API key flow introduced in the branch.
- Captured the team decision to simplify back to `MANAGER_API_KEY` for programmatic overrides.
- Recorded that reintroducing the broad manager-credential review finding is an intentional tradeoff, not an accident.

**Learnings:**

- This is primarily a policy/config simplification, not a technical necessity.
- The route can stay concurrency-safe and compare-bound even if programmatic auth becomes broader again.

### 2026-04-10 - Completed

**By:** Codex

**Actions:**

- Removed `MANAGER_EMBEDDING_OVERRIDE_API_KEY` from manager config and test setup.
- Switched programmatic override auth back to generic `MANAGER_API_KEY` and updated route/auth tests to reflect the accepted broad-key behavior.
- Kept the reviewed-fingerprint and stale-compare protections on the override route unchanged.

**Learnings:**

- The team’s accepted tradeoff is now encoded directly in the auth path: simpler config, broader programmatic authority.
