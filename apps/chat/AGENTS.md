# Chat Agent Guide

Scope: `apps/chat`.

## Alignment

`apps/chat/CLAUDE.md` is canonical detail for this app.

## Do

- Keep Forge replies flowing through `src/lib/chat-stub.ts` and the existing
  conversation session: Seeker for granted users, stub otherwise.
- Keep the chat page a single full-screen surface.
- Follow `apps/web`'s engineering config (eslint extends root, strict
  `src/` tsconfig) and the repo prettier rules (no semicolons).
- Run lint, typecheck, and test before pushing.

- Preserve the existing auth, Seeker, history and ownership boundaries. New
  integrations require a roadmap ticket. feat-551 authorizes only the gated,
  temporary Apologist comparison; its transcript stays in memory.
- When changing comparison, read `docs/operations/apologist-comparison.md` and
  update feat-593 if its removal paths or symbols move.

## Do not

- Do not import internals from other apps; no app may import from
  `apps/chat`.
- Do not assign a `jesusfilm.org` DNS entry to the deployed service.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
