# Forge — Claude Code Project Guide

Read AGENTS.md before doing any work. It is the single source of truth for workflow, invariants, and bounded contexts.

## Quick reference

- **Workflow**: Always follow the mandatory 9-step workflow in AGENTS.md (Issue → Branch → Plan → Implement → Test → Commits → PR → Checks → Review).
- **Branch naming**: `feat/123-slug` or `fix/123-slug`
- **Commits**: Conventional format — `feat(scope):`, `fix(scope):`, `chore(scope):`, `docs(scope):`
- **Lint**: `pnpm lint` (CI uses `--max-warnings=0`)
- **Generated code**: Never hand-edit `packages/graphql/src/`. Regenerate when contracts change.
- **Bounded contexts**: One issue = one context. One PR = one context. No cross-imports between app contexts.
- **AI publishing**: AI can draft/translate/adapt. AI cannot publish to Strapi.
- **Infra**: Terraform-only. No manual console changes.

## Commands

- `/find-issue` — Search for GitHub issues to work on
- `/work-issue <number>` — Execute full workflow for a specific issue

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
