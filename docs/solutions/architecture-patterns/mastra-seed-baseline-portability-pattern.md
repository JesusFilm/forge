---
title: "Mastra seed baseline portability pattern"
date: "2026-06-02"
category: "architecture-patterns"
module: "apps/mastra"
problem_type: "architecture_pattern"
component: "service_object"
severity: "medium"
applies_when:
  - "A production Mastra eval baseline must be reused locally without production access"
  - "A seed-only evaluation snapshot needs provenance but must exclude trace, user, or generated-query data"
  - "Operators need a safe export/import loop around Mastra-owned artifacts"
related_components:
  - "apps/admin"
  - "apps/mastra-gateway"
tags:
  - "mastra"
  - "search-eval"
  - "baseline"
  - "portability"
  - "native-evaluation"
  - "artifacts"
related:
  - "docs/solutions/architecture-patterns/mastra-native-evaluation-search-eval-bridge-pattern.md"
  - "docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md"
  - "docs/roadmap/content-discovery/feat-154-production-search-eval-seed-baseline.md"
---

# Mastra Seed Baseline Portability Pattern

## Context

Production search eval baselines need to become local development fixtures, but
local developers should not need production credentials or database access.
The safe boundary is Mastra-owned: production Mastra captures the seed baseline
through Admin's authenticated eval HTTP contract, stores validated
baseline/report artifacts, syncs native Evaluation records, and then exports a
bounded JSON artifact for local import.

This keeps Admin as the live search authority. Mastra never enters the public
search path, never reads Admin Postgres, and never imports Admin code for the
baseline.

## Guidance

Use a constrained baseline posture plus a separate portability workflow:

- The orchestrator's seed-baseline posture should reject generation, trace,
  user-submitted, seed-submission, and promoted-sync flags before any Admin
  search call.
- A callable preflight should verify only readiness facts: Admin eval search
  URL configured, Admin eval bearer present, Mastra service keys present,
  production storage not memory-backed, production database URL present, and
  the artifact root can pass a write/read/delete probe.
- Export should read a named baseline plus selected report ids from the
  Mastra artifact store, then validate seed-only eligibility before returning
  anything.
- Import should validate the entire artifact first, write report artifacts
  before the baseline marker, and reject production imports unless a deliberate
  break-glass flag is enabled.
- Local native Evaluation sync should operate on imported reports through the
  existing `sync-report` path, replacing production-native projections with
  local Dataset, Scorer, and Experiment ids.

Treat the baseline artifact and report artifacts as the portable payload. The
native Evaluation database records are environment-local and should be
recreated or reused locally from the imported report rather than copied from a
production database.

## Why This Matters

An eval baseline is only useful if future work can compare against it without
weakening production boundaries. Direct production database access, raw trace
sampling, or copying runtime storage would make the local eval loop risky and
hard to repeat.

The pattern also protects the baseline from accidental scope creep. A default
flag bundle is not enough: stale callers can still send old generation or
promoted-sync fields. A named constrained posture that rejects non-seed inputs
keeps the first baseline trustworthy.

## When To Apply

- Production eval results need to seed a local development environment.
- The query source is a committed seed set, not user traces or human-promoted
  candidates.
- The artifact must preserve enough provenance for later comparison while
  staying safe to hand off as JSON.
- Native Evaluation records should be visible locally, but production native
  storage should remain isolated.

## Examples

Production capture should use the constrained posture:

```json
{
  "mode": "seed-baseline",
  "baselineName": "prod-seed-baseline-YYYY-MM-DD",
  "searchMode": "hybrid",
  "contentType": "all",
  "generateCandidates": false,
  "submitSeedCandidates": false,
  "nativeSync": true,
  "syncPromoted": false
}
```

The portability route then has three operator actions:

```json
{ "action": "preflight" }
```

```json
{
  "action": "export-baseline",
  "baselineName": "prod-seed-baseline-YYYY-MM-DD",
  "reportIds": ["report-id-from-orchestrator-summary"]
}
```

```json
{
  "action": "import-baseline",
  "artifact": { "kind": "search-eval-baseline-export" }
}
```

After local import, run native sync against the imported report id:

```json
{
  "action": "sync-report",
  "reportId": "report-id-from-export",
  "environmentLabel": "local"
}
```

## Related

- `apps/mastra/src/mastra/workflows/search-eval-orchestrator.ts`
- `apps/mastra/src/mastra/workflows/search-eval-baseline-portability.ts`
- `apps/mastra/src/services/offline-search-eval/baseline-portability.ts`
- `apps/mastra/src/mastra/workflows/search-eval-native-suite.ts`
