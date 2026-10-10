---
id: "feat-089"
title: "Agent-Agnostic Repo Instructions"
owner: "josh"
priority: "P2"
status: "complete"
start_date: "2026-04-13"
duration: 1
depends_on: []
blocks: []
tags:
  - "tooling"
  - "documentation"
  - "operations"
---

## Problem

The root instruction files mix stable repo policy with assistant-specific wording and outdated package references. That creates avoidable ambiguity for engineers and agents working outside the original Claude/Cursor context, especially around Compound Engineering workflow hooks and the deprecated `apps/mobile/` package.

## Entry Points — Read These First

1. `AGENTS.md` — quick execution map that should stay short, enforceable, and tool-agnostic.
2. `CLAUDE.md` — detailed repo conventions that `AGENTS.md` points to for deeper guidance.
3. `apps/web/AGENTS.md` — example of a concise package-level guide that separates scope from deeper detail.
4. `apps/mobile-v2/CLAUDE.md` — active mobile target that root docs should reference instead of deprecated `apps/mobile/`.

## Grep These

- `rg -n "/ce:|apps/mobile/|apps/mobile\b|CLAUDE.md is the full source of truth|full source of truth" AGENTS.md CLAUDE.md`
- `rg -n "mobile-v2|Compound Engineering|ce:plan|ce:review|ce:compound" AGENTS.md CLAUDE.md`

## What To Build

1. Rewrite `AGENTS.md` so it is a repo execution guide rather than a Claude-specific shim.
   - Keep it brief.
   - Separate required repo policy from recommended workflow.
   - Replace slash-command examples like `/ce:brainstorm ...` with tool-agnostic guidance such as "use Compound Engineering to brainstorm the ticket".
2. Correct stale package references.
   - Treat `apps/mobile-v2/` as the active mobile app.
   - Explicitly mark `apps/mobile/` as deprecated in the quick guide where relevant.
3. Align `CLAUDE.md` with the same neutral wording where the current text implies one assistant UI.
   - Keep CE command names if they are real workflow concepts.
   - Remove UI-specific slash command assumptions.
4. Preserve actual repo policy.
   - Do not weaken roadmap status rules, validation expectations, generated-file rules, or package boundary guidance.

## Constraints

- Keep the changes scoped to root documentation and roadmap metadata.
- Do not rename `CLAUDE.md` in this ticket.
- Do not rewrite package-local guides unless a root reference would otherwise be incorrect.
- Preserve the short-form purpose of `AGENTS.md`; avoid turning it into a duplicate of `CLAUDE.md`.

## Verification

- `AGENTS.md` reads as agent-agnostic repo guidance and no longer requires Claude-specific slash command syntax.
- Root docs reference `apps/mobile-v2/` as the active mobile app.
- `CLAUDE.md` still captures the same repo policy, but with less assistant-specific wording.
- `git diff -- AGENTS.md CLAUDE.md docs/roadmap/platform/feat-089-agent-agnostic-repo-instructions.md` shows only the intended documentation changes.
