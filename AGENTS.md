# Forge Agent Guide

Use this file as the quick execution map. `CLAUDE.md` holds the detailed repo conventions; keep the two aligned.

## Core model

- Web, mobile, and TV read from admin.
- `apps/admin` GraphQL schema drives contracts for `apps/web` via `packages/admin-graphql`.
- `apps/admin` GraphQL schema drives contracts for consumers via `packages/admin-graphql`.
- Both typed-client packages emit gql.tada introspection; never hand-edit `*-env.d.ts` outputs.
- Deploy on Railway with Cloudflare edge controls.

## Execution checklist

- Check `docs/roadmap/` for a relevant ticket before starting.
- If a ticket exists, set `status: "in-progress"` before making changes.
- If no ticket exists, create one in the correct lane using the next sequential `feat-NNN` ID and the format defined in `CLAUDE.md`.
- Check `docs/solutions/` for prior patterns and `todos/` for unresolved findings when they apply to your scope.
- Use `CONCEPTS.md` for shared domain vocabulary when orienting to content, search, embeddings, and media concepts.
- Read the package-local guide for the area you are changing before editing.
- Before pushing or opening/updating a PR, run PR-focused validation for the touched scope, including format and CI-sensitive checks.
- When the work is done, update the roadmap ticket to `status: "complete"`. Create a follow-up `feat-NNN` ticket if additional work is discovered.

## Compound Engineering

- Follow the Compound Engineering loop: `ce:plan` -> `ce:work` -> `ce:review` -> `ce:compound`.
- Start with explicit scope in `docs/plans/` or `docs/<scope>/plans/` when planning is needed.
- Use Compound Engineering to brainstorm against the roadmap ticket before implementation when that workflow is available in your environment.
- After completion, compound durable learnings back into docs or rules.

## Roadmap rules

- Keep roadmap files in `docs/roadmap/` with YAML frontmatter.
- Keep dependencies bidirectional: if a feature `depends_on` another feature, add the reverse entry to `blocks`.
- Keep feature bodies agent-optimized: exact file paths, grep patterns, types, constraints, and verification.

## Boundaries

- One PR should stay within one scope unless explicitly broadened.
- No cross-imports between app contexts.
- Never hand-edit generated GraphQL env/types outputs.
- If the admin Pothos schema changes, regenerate `apps/admin/schema.graphql` AND `packages/admin-graphql` types in the same PR.
- Production deploys must go through the normal PR-to-main flow. Do not run
  `railway up`, trigger Railway redeploys, or otherwise publish local worktree
  code directly to production unless the user explicitly declares a break-glass
  emergency and names the target service/environment in that same request.

## Package guidance

- `apps/web/AGENTS.md` + `apps/web/CLAUDE.md`
- `apps/manager/AGENTS.md` + `apps/manager/CLAUDE.md`
- `apps/admin/AGENTS.md` + `apps/admin/CLAUDE.md`
- `apps/mobile/CLAUDE.md`
- `apps/tv/CLAUDE.md`
- `apps/roadmap/CLAUDE.md`
- `apps/chat/AGENTS.md` + `apps/chat/CLAUDE.md`
- `packages/admin-graphql/CLAUDE.md`
