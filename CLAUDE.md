# Forge — Claude Code Project Guide

Read AGENTS.md before doing any work. It is the single source of truth for workflow, invariants, and bounded contexts.

## Quick reference

- **Workflow**: Always follow the mandatory 9-step workflow in AGENTS.md (Issue → Branch → Plan → Implement → Test → Commits → PR → Checks → Review).
- **Issue dedup**: Before creating a new issue, search for an existing one (`gh issue list --label <scope> --state open` + keyword searches). Reuse if a match exists.
- **Merge conflicts**: Never rebase a feature branch. Use `git merge upstream/main --no-edit`. For `pnpm-lock.yaml` conflicts: accept theirs, `pnpm install --no-frozen-lockfile`, stage, commit.
- **Branch naming**: `feat/123-slug`, `fix/123-slug`, `chore/123-slug`, or `docs/123-slug`
- **Commits**: Conventional format — `feat(scope):`, `fix(scope):`, `chore(scope):`, `docs(scope):`
- **Lint**: `pnpm lint` (CI uses `--max-warnings=0`)
- **Generated code**: Never hand-edit `packages/graphql/src/`. Regenerate when contracts change.
- **Bounded contexts**: One issue = one context. One PR = one context. No cross-imports between app contexts.
- **AI publishing**: AI can draft/translate/adapt. AI cannot publish to Strapi.
- **Infra**: Terraform-only. No manual console changes.

## Commands

- `/find-issue` — Search for GitHub issues to work on
- `/work-issue <number>` — Execute full workflow for a specific issue
- `/handle-pr-review [number]` — Fetch and address PR review comments for the current branch

## Session reply and git behavior

- **GitHub link in every message**: When doing tracked GitHub work, include a clickable Markdown link in every message. Prefer active PR link; if no PR exists, include active issue link.
- **Auto commit and push**: Do not ask whether to commit or push after requested changes. Commit and push automatically with a conventional commit message.
- **Shared rules and skills**: When creating or updating rules or skills, make them available to both Claude and Cursor.

## Merged-branch guard

Before committing, verify the current branch's PR is not already merged:

```
gh pr list --repo JesusFilm/forge --head "$(git branch --show-current)" --state merged --json number
```

If non-empty, **stop** — create a new branch from `main` instead.

## Creating PRs and issues

Never pass `\n` escape sequences in API tool string parameters — they render as literal text. Always use `gh` CLI with a HEREDOC for multiline bodies:

```
gh pr create --title "type(scope): description" --body "$(cat <<'EOF'
## Summary
...
EOF
)"
```

Same applies to `gh issue create`, `gh pr edit`, and `gh issue edit`.

## CI checks (use `gh` CLI)

- Verify PR status: `gh pr checks <PR> --repo JesusFilm/forge`
- Read failed logs: `gh run view <RUN_ID> --log-failed`
- View PR reviews: `gh api repos/JesusFilm/forge/pulls/<PR>/comments`

## Scoped AGENTS.md files

Each bounded context has its own AGENTS.md with scope-specific rules:

- `apps/web/AGENTS.md` — Next.js web app
- `apps/cms/AGENTS.md` — Strapi CMS
- `apps/ai-orchestrator/AGENTS.md` — AI pipeline
- `packages/graphql/AGENTS.md` — Generated GraphQL client (read-only)
- `packages/ai-config/AGENTS.md` — Prompts, policies, eval configs
- `packages/content-models/AGENTS.md` — Shared enums/types
- `mobile/android/AGENTS.md` — Kotlin/Compose native app
- `mobile/ios/AGENTS.md` — SwiftUI native app
- `infra/AGENTS.md` — Terraform stacks

Always read the relevant scoped AGENTS.md before making changes in that area.
