---
name: forge-workflow
description: Follow Forge's required GitHub workflow from issue intake through review follow-up. Use when starting tracked work in this repo or when the user asks to follow the Forge workflow.
---

# Forge Workflow

Read `AGENTS.md` first. If you will touch a bounded context with its own `AGENTS.md`, read that file before editing code.

## Required sequence

### 1. Issue first

Search for an existing open issue before creating a new one.

- Use `gh issue list --repo JesusFilm/forge --label <scope> --state open`.
- Use keyword searches with `gh issue list --repo JesusFilm/forge --search "<terms>" --state open`.
- Reuse the existing issue if it already covers the requested work.

If no issue exists, create one with the **Bounded Context Work Item** template before making code changes.

- Title format: `type(scope): description`
- Required sections: Background, Expected outcome, Acceptance criteria, Possible solution(s), References

### 2. Branch

Start from `main` and create a bounded branch:

```bash
git checkout main
git pull origin main
git checkout -b <type>/<issue-number>-<short-slug>
```

Accepted prefixes in this repo: `feat`, `fix`, `chore`, `docs`.

### 3. Agent naming

Use the session or agent name `<issue-number>-<slug>`.

### 4. Plan

After reading the relevant code and before editing, post the execution plan as a comment on the issue:

```bash
gh issue comment <issue> --repo JesusFilm/forge --body "<plan>"
```

### 5. Work

Keep the change inside the issue's bounded context.

- Touch only the folders allowed by `AGENTS.md` and any scoped `AGENTS.md`.
- Never hand-edit generated files under `packages/graphql/`.
- If contracts change, run `pnpm turbo run generate --filter=@forge/graphql` in the same PR.
- AI can draft content, but must not publish to Strapi.

### 6. Commits

Make small, reviewable commits with conventional commit subjects:

- `feat(scope): ...`
- `fix(scope): ...`
- `chore(scope): ...`
- `docs(scope): ...`

### 7. PR

Open a PR against `main` with the same title as the issue and include `Resolves #<issue>` in the body. Fill out the repo PR template.

If the branch needs the latest `main`, merge it. Do not rebase the feature branch.

```bash
git fetch origin main
git merge origin/main --no-edit
```

For `pnpm-lock.yaml` conflicts:

1. `git checkout --theirs pnpm-lock.yaml`
2. `pnpm install --no-frozen-lockfile`
3. `git add pnpm-lock.yaml`
4. `git commit --no-edit`

### 8. Checks

Use GitHub CLI to verify CI:

```bash
gh pr checks <pr> --repo JesusFilm/forge
```

If a run fails, inspect it with:

```bash
gh run view <run-id> --log-failed
```

### 9. Post-check passing

Resolve review feedback by either fixing the issue or explaining why no code change is needed.

- Reply directly on each actionable review thread.
- Resolve the thread after replying when the feedback is handled.
- Post a PR summary comment describing what changed, what was declined, and any blockers.

## Invariants

- One issue = one bounded context.
- One PR = one bounded context.
- Canonical content lives in Strapi only.
- Generated clients are read-only artifacts.
- Infra changes are Terraform-only.
