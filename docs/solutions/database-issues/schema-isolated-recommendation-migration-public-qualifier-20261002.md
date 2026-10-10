---
title: "Run public-qualified data migrations inside isolated recommendation test schemas"
date: "2026-10-02"
module: "Admin Recommendations"
problem_type: "database_issue"
component: "recommendation_test_fixtures"
severity: "medium"
symptoms:
  - "Current-schema recommendation tests fail while loading migration 0127"
  - "A cleanup RESET search_path reports an aborted transaction after the original error"
root_cause: "fixture_schema_drift"
resolution_type: "test_fixture_fix"
tags: [recommendations, postgres, migrations, testing]
---

# Public-qualified migration in an isolated schema fixture

Migration `0127_recommendation_legacy_stage_bulk_retirement` explicitly locks and truncates `public.recommendation_candidate_stage_evidence` and updates a related `public` run table. Production migration SQL is correct for the deployed public schema. Recommendation runtime tests instead build tables in a unique schema and set `search_path` to that schema, then `public`. Loading the production SQL unchanged touches public and fails when that table is absent. The failed transaction can make cleanup's `RESET search_path` hide the first error.

In `apps/admin/src/services/recommendations/current-schema.test-fixture.ts`, resolve only migration 0127's `public.recommendation_candidate_` qualifiers through the fixture search path. The lock, update and truncation still execute against the isolated tables. Keep production migration SQL byte-for-byte unchanged; do not omit the migration merely because an isolated schema begins empty. Historical upgrade tests retain their separate fixed chains.

When validating runtime fixtures, use a freshly generated Prisma client from the current schema. A dependency tree generated on an older commit can make persistence fail with `persistence_unavailable` or produce type errors for new fields even after the PostgreSQL fixture is repaired. A filtered private install can regenerate the client without writing into another worktree's dependencies.
