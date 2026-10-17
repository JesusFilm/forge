# Portal session renewal role grant

## Reviewed change

Forge PR [#2499](https://github.com/JesusFilm/forge/pull/2499) adds
`apps/rag/scripts/grant-portal-session-renewal.ts` to the RAG Railway pre-deploy
command after Prisma migrations and before service start. It connects as the
configured restricted portal session role, verifies its existing privileges
and database-cluster identity, grants only `UPDATE (expires_at)` through the
migration administrator connection, then verifies the restricted role again.
The command prints a receipt with the database and role names and permission
booleans, without connection strings or session values. Portal startup repeats
the restricted-role verification so a skipped pre-deploy command fails visibly.

## Isolated PostgreSQL verification

- Fresh local database migrations applied; restricted-role grant test passed.
- A second grant run passed without changing the permission set.
- Giving the test role a non-portal table read caused provisioning to stop.
- Pointing the administrator URL at a second PostgreSQL cluster with the same
  database name caused `portal_database_target_mismatch`; the role on that
  second cluster still lacked expiry update permission.

## Production deployment observation

- PR #2499 merged as Forge commit `8bbd2826070eef17f5786026088269fa4e49f370`
  on 30 September 2026.
- Railway production RAG service deployment ID:
  `5eab6ff4-8962-4d1e-8870-aff0c6d955e4`.
- GitHub's Railway status for that service reported `success` at
  `2026-09-30T03:50:28Z`; the production environment deployment reported
  `success` at `2026-09-30T03:51:42Z`.
- A direct read of the production `/v1/health` route returned HTTP 200.
- The merged service verifies the restricted portal role before startup. Its
  successful start is evidence that the role could update `expires_at` and
  lacked the broader permissions checked by that code. This does **not** prove
  whether the pre-deploy grant command applied a new grant or found an existing
  one.

The private Railway pre-deploy log was unavailable in this workspace, so its
redacted `portal_session_renewal_grant` receipt and migration lines were not
independently inspected. An operator with Railway access should check those
lines and add the receipt result here. Do not copy database URLs, passwords,
OAuth values, session tokens or corpus text into this record.
