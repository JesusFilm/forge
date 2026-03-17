# Forge — Claude Code Project Guide

Read AGENTS.md before doing any work. It is the single source of truth for workflow, invariants, and bounded contexts.

## Quick reference

- **Workflow**: Follow the Every-style loop in AGENTS.md: Plan -> Work -> Review -> Compound.
- **Merge conflicts**: Never rebase a feature branch. Use `git merge upstream/main --no-edit`. For `pnpm-lock.yaml` conflicts: accept theirs, `pnpm install --no-frozen-lockfile`, stage, commit.
- **Branch naming**: `feat/<scope>-slug`, `fix/<scope>-slug`, `chore/<scope>-slug`, or `docs/<scope>-slug`
- **Commits**: Conventional format — `feat(scope):`, `fix(scope):`, `chore(scope):`, `docs(scope):`
- **Lint**: `pnpm lint` (CI uses `--max-warnings=0`)
- **Generated code**: Never hand-edit `packages/graphql/src/`. Regenerate when contracts change.
- **Bounded contexts**: One plan doc = one context. One PR = one context. No cross-imports between app contexts.
- **AI publishing**: AI can draft/translate/adapt. AI cannot publish to Strapi.

## Commands

- `/workflows:plan` — build/refresh scoped plan docs before coding
- `/workflows:work` — execute against the approved plan doc
- `/workflows:review` — run review pass and resolve findings
- `/workflows:compound` — capture reusable lessons into docs/rules
- `/work-plan <path>` — Execute full workflow for a specific plan doc

## Session reply and git behavior

- **GitHub link in every message**: When doing tracked GitHub work, include a clickable Markdown link in every message. Use active PR link.
- **Auto commit and push**: Do not ask whether to commit or push after requested changes. Commit and push automatically with a conventional commit message.
- **Shared rules and skills**: When creating or updating rules or skills, make them available to both Claude and Cursor.

## Merged-branch guard

Before committing, verify the current branch's PR is not already merged:

```
gh pr list --repo JesusFilm/forge --head "$(git branch --show-current)" --state merged --json number
```

If non-empty, **stop** — create a new branch from `main` instead.

## Creating PRs

Never pass `\n` escape sequences in API tool string parameters — they render as literal text. Always use `gh` CLI with a HEREDOC for multiline bodies:

```
gh pr create --title "type(scope): description" --body "$(cat <<'EOF'
## Summary
...
EOF
)"
```

Same applies to `gh pr edit`.

## CI checks (use `gh` CLI)

- Verify PR status: `gh pr checks <PR> --repo JesusFilm/forge`
- Read failed logs: `gh run view <RUN_ID> --log-failed`
- View PR reviews: `gh api repos/JesusFilm/forge/pulls/<PR>/comments`

## Bounded context folder guard

Before making any file changes, check the active plan doc scope to determine the bounded context. File changes must stay within that context's folder.

**Context-to-folder mapping:**

| Scope     | Allowed folders     |
| --------- | ------------------- |
| `mobile`  | `apps/mobile/`      |
| `web`     | `apps/web/`         |
| `cms`     | `apps/cms/`         |
| `graphql` | `packages/graphql/` |

Shared files (`pnpm-lock.yaml`, root `package.json`, root configs) are allowed as side effects of dependency changes within the context.

**Rules:**

1. **Check scope first** — read the active plan doc. The `scope` determines which folder you may modify.
2. **No cross-context changes** — a `mobile` plan must not modify `apps/web/`, `apps/cms/`, or `packages/graphql/` unless explicitly scoped and approved. Same for every other context.
3. **Shared packages require justification** — changes to `packages/graphql/` only if the plan explicitly requires a contract/schema change. Codegen output is permitted as a side effect.
4. **If another platform needs changes — stop and escalate:**
   - Do NOT silently modify files outside the bounded context.
   - Create a new plan doc for the other platform's work.
   - Link it in the active plan's references.
   - Inform the human programmer and **wait for confirmation** before proceeding.
5. **Pre-commit check** — before committing, review all staged files. If any file falls outside allowed folders, unstage it and follow rule 4.

## Scoped AGENTS.md files

Each bounded context has its own AGENTS.md with scope-specific rules:

- `apps/web/AGENTS.md` — Next.js web app
- `apps/cms/AGENTS.md` — Strapi CMS
- `packages/graphql/AGENTS.md` — Generated GraphQL client (read-only)

Always read the relevant scoped AGENTS.md before making changes in that area.

## Strapi schema work

When creating or modifying Strapi component schemas, read `apps/cms/AGENTS.md` first.
It contains the full schema architecture guide: component file format, naming conventions,
dynamic zones, the Section wrapper pattern, and the complete schema-to-frontend pipeline.
