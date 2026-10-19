---
id: "feat-740"
title: "Reconcile five recommendation content-profile mismatches"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: []
tags:
  - "recommendations"
  - "content-quality"
  - "admin"
---

## Problem

Editorial curation found five sources whose title, existing profile, or transcript
language needs reconciliation. Their six recommendations remain flagged drafts.

## Entry Points — Read These First

1. `docs/plans/2026-10-19-editorial-related-video-selection.md`
2. `docs/recommendations/editorial-2026-10-19/recommendations.json`
   (committed choices); `output/editorial-recommendations/catalogue.json`
   (local ignored evidence export from feat-739).
3. `apps/admin/AGENTS.md` and `apps/admin/CLAUDE.md` before implementation.

## Grep These

- `cmp78utff0ghcqm01ppype541` — Delivering The Demoniac: profile concerns blind guides.
- `cmp78uu4i0ghiqm01lqwq5erd` — Jesus Heals the Paralytic: profile concerns the Pharisee and tax collector.
- `cmp783vir03feqm01iu0jas61` — Jesus Spends Time with Sinners: profile concerns other teachings.
- `cmp78e30308k6qm01w674orig` — Vessel: profile emphasizes shepherd/door imagery.
- `cmp78j4xc0b44qm01ejb8ufxg` — Who is the Messiah?: transcript language appears mislabeled.
- `title-profile-mismatch-or-transcript-language-issue`

## What To Build

Check the underlying clips and correctly aligned transcript evidence; determine
whether the title, transcript association, or profile is incorrect. Correct the
appropriate source through the normal reviewed flow, then revise each affected
editorial selection against verified evidence.

## Constraints

- Do not infer the correct content from the title alone.
- Preserve the evidence flag until the discrepancy is resolved.
- No direct production deployment; use the normal PR-to-main flow for code changes.

## Verification

- Record verified content and the cause of each of the five discrepancies.
- Each revised slate has six distinct existing non-self targets and reasons.
- Run validation appropriate to any corrected source-data or code path.
