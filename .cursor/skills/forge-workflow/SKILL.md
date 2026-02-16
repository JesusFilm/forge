---
name: forge-workflow
description: Follow the mandatory GitHub issue → branch → plan → work → commits → PR → checks workflow for Forge. Use when doing any work in Forge, creating issues, branches, PRs, or when the user asks to follow the workflow.
---

# Forge Workflow

Mandatory sequence for all work. Never skip steps.

## Checklist

```
- [ ] 1. Issue first
- [ ] 2. Branch
- [ ] 3. Plan
- [ ] 4. Work
- [ ] 5. Commits
- [ ] 6. PR
- [ ] 7. Checks
- [ ] 8. Post check passing
```

## Steps

### 1. Issue first

Create GitHub issue using **Bounded Context Work Item** template before any code. If user requests work and no issue exists, create the issue first—never start coding without an issue.

**Body:** Background, Expected outcome, Acceptance criteria, Possible solution(s), References.

**Title:** `type(scope): description` (e.g. `feat(web): add validation`, `fix(cms): schema fix`). Labels and assignee auto-applied.

### 2. Branch

From `main`: `fix/123-slug` or `feat/123-slug` (issue number + slug).

### 3. Plan

When creating an execution plan (todo list), post it as a comment on the issue before starting work.

### 4. Work

Changes within the bounded context of the issue. If contracts change: run codegen in same PR and tick "Regeneration Required: yes" in PR template.

### 5. Commits

Series of commits—one per small block. Conventional format: `feat:`, `fix:`, `chore:`, `docs:`. Atomic and reviewable (e.g. `fix: resolve #123`).

### 6. PR

Rebase on `main`, open PR targeting `main`. Same title format as issue. Fill PR template (Summary, Contracts Changed, Regeneration Required, Validation). Include `Resolves #123` in description.

### 7. Checks

All CI checks must pass. Use `mcp_GitHub_pull_request_read` with `method: get_status` to verify. Re-run or fix failures.

### 8. Post check passing

Resolve all review comments—fix or explain why not. Add PR comment summarizing how each was handled.

## Invariants

- One issue = one bounded context. One PR = one bounded context.
- Canonical content in Strapi only. AI drafts; AI cannot publish.
- Contracts are source of truth. Generated clients are read-only.
- Never hand-edit `packages/clients/*`. Regenerate when contracts change.
