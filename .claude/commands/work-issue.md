Work on GitHub issue #$ARGUMENTS in the repo JesusFilm/forge. Follow all rules in AGENTS.md, CONTRIBUTING.md, and .cursor/rules/gh-workflow.mdc exactly.

Set ISSUE=$ARGUMENTS and use it throughout. Use agent/session name `$ARGUMENTS-{slug}`(e.g.`95-expo-env-config`).

## Checklist

```text
- [ ] 1. Issue
- [ ] 2. Branch
- [ ] 3. Plan
- [ ] 4. Implement
- [ ] 5. Test & Build
- [ ] 6. Commits
- [ ] 7. PR
- [ ] 8. Checks
- [ ] 9. Review comments
```

## 1. Read the issue

- Run `gh issue view $ISSUE --repo JesusFilm/forge` to understand scope, acceptance criteria, and bounded context.
- Determine the issue type (`feat` or `fix` or `chore` or `docs`) from the issue title format `type(scope): description`.

## 2. Branch

- Checkout main: `git checkout main && git pull origin main`
- Create branch: `git checkout -b {type}/$ISSUE-short-slug`

## 3. Plan

- After reading all relevant code, post your execution plan as a comment on the issue:
  `gh issue comment $ISSUE --repo JesusFilm/forge --body "<plan>"`
- Never start coding before the plan comment is posted.

## 4. Implement

- Make changes within the bounded context only. Touch only impacted folders listed in AGENTS.md.
- Never hand-edit generated files in `packages/graphql/src/`.
- Never add cross-imports between bounded app contexts.
- If contracts change, run codegen in the same PR and tick "Regeneration Required: yes" in the PR template.

## 5. Test & Build

- Run `pnpm lint` and fix any warnings (CI uses `--max-warnings=0`).
- Run relevant tests for the affected workspace.
- Run `pnpm build` for affected packages to verify no build errors.

## 6. Commits

- One commit per small logical block of work.
- Conventional format: `feat(scope): description`, `fix(scope): description`, `chore(scope): description`, `docs(scope): description`.
- Keep commits atomic and reviewable (e.g. `fix: resolve #$ISSUE`).

## 7. Push & Create PR

- Rebase on main: `git fetch origin main && git rebase origin/main`
- Push: `git push -u origin HEAD`
- Create PR with `gh pr create --repo JesusFilm/forge` using:
  - Title: `type(scope): description` (same format as issue title)
  - Body: fill the PR template (Summary, Contracts Changed, Regeneration Required, Validation). Include `Resolves #$ISSUE`.
- Store the PR number from the output.

## 8. Wait for CI & fix failures

- Monitor: `gh pr checks <PR> --repo JesusFilm/forge`
- On failure: read logs with `gh run view <RUN_ID> --log-failed`, fix the issue, commit, and push.
- Repeat until all checks pass.

## 9. Handle review comments

- Fetch comments: use `gh api` or `gh pr view <PR> --repo JesusFilm/forge --json reviews,comments`.
- **Filter actionable**: ignore resolved threads. Focus on unresolved CodeRabbit, CodeQL, or human comments. Skip nitpicks marked "optional" unless explicitly requested.
- For each actionable comment: fix the issue or explain why it doesn't need addressing.
- One commit per logical fix, conventional format.
- Push: `git push`
- Post a summary comment on the PR:

```markdown
## Review feedback addressed (<sha>)

**Fixed:**

- [comment]: [what changed]

**Not changed:**

- [comment]: [reason]
```

- Re-check CI after pushing: `gh pr checks <PR> --repo JesusFilm/forge`

## Invariants

- One issue = one bounded context. One PR = one bounded context.
- Canonical content lives in Strapi only. AI drafts; AI cannot publish.
- Contracts are source of truth. Generated clients are read-only artifacts.
- Never hand-edit `packages/graphql/*`. Regenerate when contracts change.
- Infra changes are Terraform-only.

Do NOT skip any step. Do NOT publish to Strapi. Do NOT edit generated clients manually.
