---
status: complete
priority: p2
issue_id: "022"
tags: [cms, manager, auth, embeddings, config]
dependencies: []
---

# Remove `STRAPI_EMBEDDING_SYNC_TOKEN` and use `STRAPI_INTERNAL_API_TOKEN` for embedding sync

## Problem Statement

The embeddings sync flow currently carries two CMS-side bearer credentials: `STRAPI_EMBEDDING_SYNC_TOKEN` for `inspect` / `if_missing`, and `STRAPI_INTERNAL_API_TOKEN` for broader internal writes and override. The team has decided that sync should just use `STRAPI_INTERNAL_API_TOKEN` everywhere, so the extra sync token should be removed to simplify config and reduce token-surface drift between CMS and manager.

## Findings

- `apps/cms/src/api/embedding/controllers/embedding.ts` still accepts either `STRAPI_EMBEDDING_SYNC_TOKEN` or `STRAPI_INTERNAL_API_TOKEN` for mode-aware non-destructive sync.
- `apps/cms/src/index.ts` bootstraps both the internal token and the embeddings sync token on startup.
- `apps/cms/src/bootstrap/internal-api-token.ts` defines a managed API token named `forge-embedding-sync-api-token` sourced from `STRAPI_EMBEDDING_SYNC_TOKEN`.
- `apps/manager/src/services/cmsClient.ts` prefers `STRAPI_EMBEDDING_SYNC_TOKEN` and only falls back to `STRAPI_INTERNAL_API_TOKEN` for `embedding_sync`.
- `apps/manager/src/config/env.ts` exposes `STRAPI_EMBEDDING_SYNC_TOKEN` as a distinct manager env var.
- The branch already moved destructive override onto `STRAPI_INTERNAL_API_TOKEN`, so using the same token for sync would align the manager-to-CMS credential model.
- This change trades away the narrower sync-specific env surface. In the current codebase, that separation is mostly operational rather than a hard permission boundary because the managed Strapi API tokens are still full-access tokens.

## Proposed Solutions

### Option 1: Remove `STRAPI_EMBEDDING_SYNC_TOKEN` entirely

**Approach:** Delete the sync-token env/config/bootstrap path and require `STRAPI_INTERNAL_API_TOKEN` for all mode-aware embedding sync calls from manager to CMS.

**Pros:**

- Simplest runtime and deployment config
- One canonical CMS credential for all embedding sync/override flows
- Removes fallback logic and token drift between apps

**Cons:**

- Loses the ability to configure a distinct sync-only secret
- Makes future least-privilege separation slightly harder unless reintroduced later

**Effort:** 1-3 hours

**Risk:** Medium

---

### Option 2: Keep the env var name as a deprecated alias

**Approach:** Standardize behavior on `STRAPI_INTERNAL_API_TOKEN`, but continue reading `STRAPI_EMBEDDING_SYNC_TOKEN` temporarily with deprecation messaging.

**Pros:**

- Easier deployment migration
- Lower immediate rollout risk

**Cons:**

- Leaves config ambiguity around longer
- Delays the simplification the team wants

**Effort:** 2-4 hours

**Risk:** Low

## Recommended Action

Implement Option 1. Remove `STRAPI_EMBEDDING_SYNC_TOKEN` from CMS bootstrap, manager env parsing, and manager CMS-client resolution, then require `STRAPI_INTERNAL_API_TOKEN` for all mode-aware embedding sync and override calls. Update tests and env/docs in the same pass.

## Technical Details

**Affected files:**

- `apps/cms/src/api/embedding/controllers/embedding.ts`
- `apps/cms/src/api/embedding/controllers/embedding.test.ts`
- `apps/cms/src/bootstrap/internal-api-token.ts`
- `apps/cms/src/index.ts`
- `apps/cms/.env.example`
- `apps/cms/railway.variables.env`
- `apps/manager/src/config/env.ts`
- `apps/manager/src/services/cmsClient.ts`
- `apps/manager/src/services/cmsClient.test.ts`
- Any tests or docs that mention `STRAPI_EMBEDDING_SYNC_TOKEN`

**Database changes (if any):**

- No schema change required.
- CMS bootstrap should stop creating or rotating the managed `forge-embedding-sync-api-token`.

## Resources

- `todos/007-pending-p2-limit-embedding-api-token-capabilities.md`
- `todos/008-complete-p2-fail-closed-for-sync-token-misconfiguration.md`
- `todos/012-complete-p2-make-override-compare-and-write-atomic.md`

## Acceptance Criteria

- [x] `STRAPI_EMBEDDING_SYNC_TOKEN` is removed from active CMS and manager config paths.
- [x] Mode-aware embedding sync in CMS requires `STRAPI_INTERNAL_API_TOKEN`.
- [x] Manager embedding sync calls use `STRAPI_INTERNAL_API_TOKEN` without sync-token fallback logic.
- [x] CMS bootstrap no longer creates or rotates a managed embedding sync token.
- [x] Tests and env/docs are updated to reflect the single-token model.

## Work Log

### 2026-04-10 - Created

**By:** Codex

**Actions:**

- Reviewed the current CMS and manager token split for embedding sync.
- Confirmed that `STRAPI_INTERNAL_API_TOKEN` predates this branch, while `STRAPI_EMBEDDING_SYNC_TOKEN` was introduced in the embedding CMS sync work.
- Captured the agreed simplification: sync should just use `STRAPI_INTERNAL_API_TOKEN` everywhere.

**Learnings:**

- Removing the sync token simplifies the deployment story more than it reduces a hard permission boundary, because the current managed Strapi tokens are still full-access.

### 2026-04-10 - Completed

**By:** Codex

**Actions:**

- Removed `STRAPI_EMBEDDING_SYNC_TOKEN` from active CMS and manager config/auth paths.
- Updated the CMS controller to require `STRAPI_INTERNAL_API_TOKEN` for mode-aware sync and refreshed the error messaging to match.
- Stopped CMS bootstrap from creating or rotating the managed embedding sync token.
- Verified the touched scope with focused CMS/manager tests, typecheck, and eslint.

**Learnings:**

- The resulting model is simpler to operate: one internal CMS credential now covers sync and override flows.
