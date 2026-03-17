---
name: forge-workflow
description: Follow the mandatory plan-doc → branch → work → commits → PR workflow for Forge.
---

# Forge Workflow

Mandatory sequence for all work. Never skip steps.

## Checklist

```
- [ ] 1. Plan doc first
- [ ] 2. Branch
- [ ] 2b. Agent naming ({scope}-{slug})
- [ ] 3. Plan
- [ ] 4. Work
- [ ] 5. Commits
- [ ] 6. PR
- [ ] 7. Checks
- [ ] 8. Post check passing
```

## Steps

### 1. Plan doc first

Create or update a plan doc in `docs/<scope>/plans/` before code changes.
Plan doc must contain: Background, Expected outcome, Acceptance criteria, Possible solution(s), References.

### 2. Branch

From `main`: `fix/<scope>-slug` or `feat/<scope>-slug`.

### 3. Plan

When creating an execution plan (todo list), write it into the active plan doc before starting work.

### 4. Work

Changes within the bounded context of the active plan doc. If contracts change: run `pnpm turbo run generate --filter=@forge/graphql` in the same PR and tick "Regeneration Required: yes" in PR template.

### 5. Commits

Series of commits—one per small block. Conventional format: `feat:`, `fix:`, `chore:`, `docs:`. Atomic and reviewable.

### 6. PR

Open PR targeting `main`. Title format: `type(scope): description`. Fill PR template (Summary, Contracts Changed, Regeneration Required, Validation). Include active plan doc path in description.

### 7. Checks

All CI checks must pass. Use `mcp_GitHub_pull_request_read` with `method: get_status` to verify. Re-run or fix failures.

### 8. Post check passing

Resolve all review comments—fix or explain why not. Add PR comment summarizing how each was handled.

## Resolving merge conflicts

**Never rebase a feature branch to resolve PR merge conflicts.** Use `git merge` instead.

```
git fetch upstream main
git merge upstream/main --no-edit
```

If `pnpm-lock.yaml` conflicts (most common case):
1. Accept upstream's version: `git checkout --theirs pnpm-lock.yaml`
2. Reinstall to merge in the branch's deps: `pnpm install --no-frozen-lockfile`
3. Stage and complete the merge: `git add pnpm-lock.yaml && git commit --no-edit`
4. Push: `git push`

For source file conflicts, resolve manually, stage, and complete the merge commit.

## Invariants

- One plan doc = one bounded context. One PR = one bounded context.
- Canonical content in Strapi only. AI drafts; AI cannot publish.
- Contracts are source of truth. Generated clients are read-only.
- Never hand-edit `packages/graphql/*`. Regenerate when contracts change.
