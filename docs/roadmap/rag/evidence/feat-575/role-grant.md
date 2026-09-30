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

## Production receipt

Pending the normal PR-to-main Railway autodeploy. After deployment, record the
deployment ID, successful migration and grant pre-deploy steps, the receipt's
expiry-update result, the absence of broader update permissions, service
health, and the operator who verified the logs. Do not copy database URLs,
passwords, OAuth values, session tokens or corpus text into this record.
