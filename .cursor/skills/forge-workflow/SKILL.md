---
name: forge-workflow
description: Follow the mandatory Every-style Plan → Work → Review → Compound workflow for Forge.
---

# Forge Workflow

Mandatory sequence for all work. Never skip steps.

## Checklist

```
- [ ] 1. Plan
- [ ] 2. Work
- [ ] 3. Review
- [ ] 4. Compound
- [ ] 5. PR + checks
```

## Steps

### 1. Plan

Create or update a plan doc in `docs/<scope>/plans/` before code changes.
Prefer `/workflows:plan` semantics and ensure scope + acceptance criteria are explicit.

### 2. Work

From `main`: `fix/<scope>-slug` or `feat/<scope>-slug`, then implement with `/workflows:work` semantics.

### 3. Review

Run `/workflows:review` style review and resolve findings.

### 4. Compound

Capture learnings into docs/rules/skills (`/workflows:compound` semantics).

### 5. PR + checks

Use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`), open PR to `main`, include plan doc path, and ensure all checks pass.

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
