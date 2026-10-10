---
id: "feat-333"
title: "Stale docs: /api/search + Query.search documented as live after #1622 removal"
owner: "unassigned"
priority: "P2"
status: "not-started"
start_date: "2026-09-01"
duration: 1
depends_on: []
blocks: []
tags:
  - "search"
  - "infrastructure"
---

## Problem

Admin's partner search API — the `/api/search` route and the `Query.search`
GraphQL field — was removed in PR
[#1622](https://github.com/JesusFilm/forge/pull/1622), superseded by
`Query.watchSearch`. But the ROOT `CLAUDE.md` and `apps/admin/CLAUDE.md`
still document the retired surface as live: the root file's Known Patterns
carries a "Search API authentication (`/api/search` + `Query.search`)"
bullet describing bearer composition on a route that no longer exists, and
admin's CLAUDE.md has whole sections ("Search API authentication", "Partner
API key store" references to `/api/search`) presenting the mechanism as
operational. These are forward-looking instructions that actively mislead
future agents and operators (e.g. toward provisioning partner keys for a
dead route).

Per the retired-mechanism prose-sweep discipline
(`docs/solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md`):
a retirement's code sweep is structurally blind to PROSE; run a docs sweep
keyed on the mechanism's NAMES and stamp dated supersession notes on
forward-looking hits — additive notes, never rewrites of historical records.

## Entry Points — Read These First

1. `docs/solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md`
   — the discipline this ticket executes (name harvesting, classify by
   content not document type, additive dated notes).
2. Root `CLAUDE.md` — the "Search API authentication" Known Patterns bullet.
3. `apps/admin/CLAUDE.md` — the "Search API authentication (Plan 002 + Plan
   003)" and "Partner API key store" sections.
4. PR #1622 — what was actually removed and what superseded it
   (`Query.watchSearch`).

## Grep These

Harvest names first, then sweep ALL tracked markdown:

```bash
git grep -niE '/api/search|Query\.search|SEARCH_API_KEYS|PartnerApiKey|partner-keys|SEARCH_AUTH_REQUIRED' -- '*.md'
```

Classify every hit BY CONTENT: historical record (plans, completed tickets'
Resolutions, dated solution docs — leave verbatim) vs forward-looking
instruction (CLAUDE.md patterns, runbooks, README recipes — stamp a dated
supersession note naming `Query.watchSearch` / the removal PR).

## What To Build

- Dated supersession notes (additive) on every forward-looking hit; highest
  risk surfaces first (root CLAUDE.md pattern bullet, admin CLAUDE.md
  operator runbook sections).
- Decide (and note) the status of adjacent still-real infrastructure the
  sections describe: the `PartnerApiKey` table, the `partner-keys` CLI, the
  `/dashboard/partner-keys` page, and the `isAnyKnownBearer` composition —
  what remains live for OTHER consumers vs what is dead with the route.
  Notes must not claim more retirement than actually happened.

## Constraints

- ADDITIVE notes only — never rewrite historical records (completed
  tickets, plans, dated solution docs stay verbatim).
- This ticket changes documentation only — no code, no schema, no env.
- Do not delete the sections — future readers need the history plus the
  supersession pointer.

## Verification

- The name-sweep grep re-run shows every forward-looking hit now carries an
  adjacent dated supersession note.
- A fresh reader of either CLAUDE.md cannot conclude `/api/search` or
  `Query.search` is live.
