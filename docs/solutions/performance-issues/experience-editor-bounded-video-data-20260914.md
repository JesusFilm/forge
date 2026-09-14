---
title: "Measure bounded experience-editor video data without retaining content"
date: "2026-09-14"
module: "apps/admin experience editor"
problem_type: "performance_issue"
tags:
  - "experience-editor"
  - "postgresql"
  - "memory"
  - "measurement"
---

# Experience Editor Bounded Video Data Probe

## Problem

The experience editor historically hydrated every active Dub and nested
language relation for referenced videos. Catalogue growth made the request cost
proportional to total Dub inventory rather than to the authored draft and page
size. Method-call counts or a successful visual smoke do not prove that this
fanout is gone.

## Measurement pattern

`apps/admin/src/scripts/probe-experience-editor-video-data.ts` measures the real
authenticated HTTP boundary so the same harness can run before and after an
internal service refactor. It records a cold request, warm concurrency profiles,
paired public-query samples, response bytes, a stable serialized-Dub marker,
local Admin RSS, emitted SQL counts, pool-timeout log matches, largest-collection
expansion, and repeated open/save idle RSS.

The probe deliberately stores compact numeric evidence only. Target URLs are
SHA-256 fingerprints, credentials and header values are never emitted, and
response bodies are discarded after counting bytes and the configured marker.
This keeps an operational artifact from becoming a second copy of authored
content or language inventory.

SQL means actual PostgreSQL statements, not Prisma method invocations. Feed the
probe an isolated append-only JSONL database log with one statement per line.
Run no unrelated workload against that database during the window. This follows
the selected-dub batching investigation, where ORM calls sometimes emitted no
SQL and only the database-level count exposed the true fanout.

## Gate discipline

Baseline and fixed reports are comparable only when fixture cardinalities,
request definitions, timing, identity, target fingerprints, hardware, and
cold/warm order match. Missing RSS, SQL, pool, public-control, save-cycle, or
largest-collection inputs are reported as evidence gaps. A dry run validates
the redacted contract but is never evidence of a performance improvement.

The 2026-09-14 worktree had no configured database URL and `db:5432` was
unreachable, so no baseline values were manufactured. See
`docs/validation/feat-501/README.md` for the frozen command and outstanding
evidence gate.
