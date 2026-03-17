# Forge Agent Guide

This file is the quick execution map. `CLAUDE.md` is the full source of truth; keep both aligned.

## Core model

- Canonical content lives in Strapi.
- `apps/cms` GraphQL schema drives contracts.
- `packages/graphql` is the typed client layer.
- `apps/web` and `apps/mobile` consume `packages/graphql`.
- Deploy on Railway with Cloudflare edge controls.

## Compound workflow

Use the loop: `ce:plan` -> `ce:work` -> `ce:review` -> `ce:compound`.

- Start with explicit scope in plan docs under `docs/plans/` or `docs/<scope>/plans/`.
- Check `docs/solutions/` before implementing.
- Check `todos/` for unresolved findings.
- After completion, compound learnings back into docs/rules.

## Boundaries

- One PR should stay within one bounded context unless explicitly scoped.
- No cross-imports between app contexts.
- Never hand-edit generated GraphQL env/types outputs.
- If CMS schema changes, regenerate GraphQL types in the same PR.

## Package guidance

Also read package-local guides before edits:

- `apps/web/AGENTS.md` + `apps/web/CLAUDE.md`
- `apps/mobile/AGENTS.md` + `apps/mobile/CLAUDE.md`
- `apps/cms/AGENTS.md` + `apps/cms/CLAUDE.md`
- `packages/graphql/AGENTS.md` + `packages/graphql/CLAUDE.md`
