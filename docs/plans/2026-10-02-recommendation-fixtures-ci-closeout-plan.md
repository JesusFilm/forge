---
title: Recommendation fixtures and co-watch CI closeout
type: chore
status: complete
date: 2026-10-02
---

# Recommendation fixtures and co-watch CI closeout

## Scope

Close `feat-611` and `feat-591` on current main. Keep the playback upgrade's historical migration chain and production expiry check; make request and served-item timestamps consistent with the fixed historical expiry. Load the complete recommendation migration chain in the runtime viewing-mode fixture so owner-release filtering exercises the current schema.

Add the four existing co-watch PostgreSQL suites to `admin-schema-drift`. Use the owned `forge_test` database for refresh and measurement reuse, and the separately migrated `forge_feat565_test` database for trial authority and source query. Keep the suites' safety guards and assertions intact.

The current schema fixture also needs to run the 0127 legacy-stage retirement in its owned schema. Exercise the deterministic last-known-good fallback drill on PostgreSQL and Redis after the fixture repair.

## Verification

Run the named fixtures and co-watch suites against local PostgreSQL/pgvector with their exact database harnesses. Check that bad database setup fails closed. Run Admin typecheck, scoped lint and Prettier, then confirm required PR checks. Check workflow push permission before pushing.

## Boundaries

No recommendation runtime change, production operation, schema migration edit or global policy edit. The parent owner reconciles the shared closeout record and merges the PR.
