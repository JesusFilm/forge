# Forge Agent Guide

This file is the quick execution map. `CLAUDE.md` is the full source of truth; keep both aligned.

## Core model

- Canonical content lives in Strapi.
- `apps/cms` GraphQL schema drives contracts.
- `packages/graphql` is the typed client layer.
- `apps/web` and `apps/mobile` consume `packages/graphql`.
- Deploy on Railway with Cloudflare edge controls.

## Roadmap

Work is tracked in `docs/roadmap/` as markdown files with YAML frontmatter. Always check for a relevant ticket before starting work.

- **Before work**: find the ticket in `docs/roadmap/`, set `status: "in-progress"`.
- **After work**: set `status: "complete"`. If follow-up work is needed, create a new `feat-NNN` file.
- **New work**: create a ticket in the appropriate lane directory. Use the next sequential `feat-NNN` ID. Follow the format in `CLAUDE.md` exactly — agent-optimized body with entry points, grep patterns, types, constraints, and verification.
- **Dependencies**: if your feature depends on another, add it to `depends_on` and add your ID to the other feature's `blocks`.
- **Brainstorm**: run `/ce:brainstorm docs/roadmap/{lane}/feat-NNN-{slug}.md` to start work on a ticket.

## Compound workflow

Use the loop: `ce:plan` -> `ce:work` -> `ce:review` -> `ce:compound`.

- Start with explicit scope in plan docs under `docs/plans/` or `docs/<scope>/plans/`.
- Check `docs/roadmap/` for the relevant feature ticket.
- Check `docs/solutions/` before implementing.
- Check `todos/` for unresolved findings.
- After completion, compound learnings back into docs/rules.
- Update the roadmap ticket status to `complete`.

## Boundaries

- One PR should stay within one scope unless explicitly broadened.
- No cross-imports between app contexts.
- Never hand-edit generated GraphQL env/types outputs.
- If CMS schema changes, regenerate GraphQL types in the same PR.

## Package guidance

Also read package-local guides before edits:

- `apps/web/AGENTS.md` + `apps/web/CLAUDE.md`
- `apps/mobile/AGENTS.md` + `apps/mobile/CLAUDE.md`
- `apps/cms/AGENTS.md` + `apps/cms/CLAUDE.md`
- `apps/roadmap/CLAUDE.md`
- `packages/graphql/AGENTS.md` + `packages/graphql/CLAUDE.md`
