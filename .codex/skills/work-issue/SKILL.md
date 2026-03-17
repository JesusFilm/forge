---
name: work-issue
description: Execute the Forge workflow for a specific GitHub issue. Use when the user gives an issue number and wants end-to-end implementation in this repo.
argument-hint: [issue-number]
---

# Work Issue

Work on GitHub issue `#$ARGUMENTS` in `JesusFilm/forge`. Follow `AGENTS.md`, `CONTRIBUTING.md`, and any scoped `AGENTS.md` for touched folders.

Set `ISSUE=$ARGUMENTS` and keep the issue number attached to all workflow steps.

## Required flow

### 1. Read the issue

Inspect the issue first:

```bash
gh issue view "$ISSUE" --repo JesusFilm/forge
```

Confirm the issue title uses `type(scope): description`, then work only inside that bounded context.

### 2. Branch

Create a fresh branch from `main`:

```bash
git checkout main
git pull origin main
TYPE=feat
SLUG=short-slug
git checkout -b "${TYPE}/${ISSUE}-${SLUG}"
```

Use the session name `"$ISSUE"-<slug>`.

### 3. Plan

Read the relevant code, then post the execution plan before editing:

```bash
gh issue comment "$ISSUE" --repo JesusFilm/forge --body "<plan>"
```

### 4. Implement

- Stay within the issue's bounded context.
- Never hand-edit generated files under `packages/graphql/`.
- If contracts change, run `pnpm turbo run generate --filter=@forge/graphql`.

### 5. Test and build

Run the relevant validation for the touched area. Default baseline:

```bash
pnpm lint
```

Also run the focused tests and builds needed for the affected workspace.

### 6. Commits

Create one conventional commit per logical block of work.

### 7. Push and create PR

Push the branch and create a PR against `main` with the same `type(scope): description` title as the issue. Include `Resolves #$ISSUE` in the PR body and store the PR number in `PR` for the later steps.

If the branch needs the latest `main`, merge it. Do not rebase.

```bash
git fetch origin main
git merge origin/main --no-edit
PR=$(gh pr view --repo JesusFilm/forge --json number --jq '.number')
```

### 8. Wait for CI and fix failures

Monitor checks with:

```bash
gh pr checks "$PR" --repo JesusFilm/forge
```

When a check fails:

```bash
gh run view <run-id> --log-failed
```

Fix the issue, commit, push, and repeat until all checks pass.

### 9. Handle review comments

- Ignore resolved threads.
- Focus on unresolved CodeRabbit, CodeQL, or human feedback.
- Skip optional nitpicks unless the user asks for them.
- Reply on each actionable thread, resolve it when handled, and post a summary PR comment.

## Non-negotiable rules

- One issue = one bounded context.
- One PR = one bounded context.
- AI can draft or adapt content, but cannot publish to Strapi.
- Infra changes are Terraform-only.
