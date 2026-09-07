# RAG read-only database principal

Production evaluation and dashboard reads authenticate directly to PostgreSQL.
They do not use the RAG HTTP bearer registry. The database owner remains the
credential for Prisma migrations and explicitly authorized maintenance; the
read path uses a separate login whose effective privileges permit only
connection, schema usage, and table selection.

## Roles and guarantees

`db:provision-readonly` maintains two cluster roles:

- `forge_rag_readonly` is a `NOLOGIN` group granted `CONNECT`, `USAGE` on the
  `public` schema, and `SELECT` on current and future tables created there by the
  provisioning owner.
- `forge_rag_evaluator` is the default login and inherits only that group. Set
  `JFRAG_READONLY_ROLE_NAME` to another safe lowercase identifier when separate
  evaluation and dashboard logins are required.

The command removes `TEMPORARY` on the RAG database and `CREATE` on its `public`
schema from `PUBLIC`. It also removes `PUBLIC` execution of PostgreSQL's
persistent large-object mutators and grants it explicitly to the provisioning
owner. PostgreSQL grants are additive, so these shared revocations are required:
revoking them only from the new login would not override privileges inherited
by every login through `PUBLIC`. The database owner retains its ownership and
explicit large-object rights.

The login is created without superuser, database creation, role creation,
replication, or row-security-bypass attributes and defaults each transaction to
read-only. Object grants are the hard boundary; the transaction default is
additional protection.

## Local proof

Start the package PostgreSQL container and apply current migrations. Generate a
64-character lowercase hexadecimal password outside logs, then inject it into
the two commands without committing or printing it:

```sh
docker compose -f apps/rag/docker-compose.yml up -d
DATABASE_URL=postgresql://forge:forge@localhost:5435/forge_rag \
  pnpm --filter @forge/rag db:migrate:deploy
JFRAG_READONLY_PASSWORD=<generated-64-hex-value> \
DATABASE_URL=postgresql://forge:forge@localhost:5435/forge_rag \
  pnpm --filter @forge/rag db:provision-readonly --local
JFRAG_POSTGRESQL_READONLY_DB_URL=<local-reader-url> \
  pnpm --filter @forge/rag db:verify-readonly --local
```

The verifier requires the connected username to match
`JFRAG_READONLY_ROLE_NAME` or `forge_rag_evaluator`. It checks role attributes,
database and schema creation, object ownership, DML grants, writable sequences,
and unexpected memberships. It proves a table read succeeds and proves
persistent DDL, temporary DDL, `INSERT`, `UPDATE`, and `DELETE` are denied. Each
negative probe is transaction-wrapped and rolls back if it unexpectedly
succeeds. The catalog and active probes also reject large-object ownership or
execution of built-in large-object mutators.

The PostgreSQL integration test provisions the reader and then reconnects with
the original owner credential. It proves that the owner can still create and
drop a persistent table, create a temporary table, and insert, update, and
delete both a probe row and a real `sources` row. It also proves the owner can
create and remove a PostgreSQL large object. The reader then selects from the
new table, proving the future-table default grant, before cleanup. The test
asserts that neither the source row nor persistent table remains. Run that proof
together with the existing adapter and raw-document-promotion write suites:

```sh
DATABASE_URL=postgresql://forge:forge@localhost:5435/forge_rag \
  pnpm --filter @forge/rag exec vitest run --no-file-parallelism \
  tests/adapters.integration.test.ts \
  tests/raw-document-promotion.integration.test.ts \
  tests/readonly-role.integration.test.ts
```

## Railway production procedure

This is a manual database administration action after the provisioning code has
merged. It is deliberately absent from `railway.toml`: builds, Prisma
pre-deploy migrations, service startup, and normal autodeploy must never create
or rotate a database login.

1. Confirm Railway project `forge`, environment `production`, RAG PostgreSQL
   service, and its immutable identifiers. Confirm the owner URL targets that
   database and retain a tested rollback credential.
2. Inventory existing non-owner logins before removing the database's
   `PUBLIC` temporary-object grant, the `public` schema's `PUBLIC` creation
   grant, and `PUBLIC` execution of PostgreSQL large-object mutators. Explicitly
   grant the required function execution to every approved writer before it
   runs again. Stop if an affected workload has not been identified and handled.
3. Generate a 32-byte random password as 64 lowercase hexadecimal characters
   outside the transcript. Put it temporarily in the approved secret receiver
   as `JFRAG_READONLY_PASSWORD`; never pass it as a command argument.
4. With the owner URL injected as `JFRAG_POSTGRESQL_DB_URL`, the exact host in
   `JFRAG_EXPECTED_POSTGRES_HOST`, and the deliberate
   `JFRAG_ALLOW_PROD_ROLE_PROVISION=1` signal, run:

   ```sh
   doppler run --project forge-rag --config prd -- \
     pnpm --filter @forge/rag db:provision-readonly --production
   ```

5. Construct the reader URL from the same approved Railway public endpoint,
   database name, new username, and generated password. Store it only as
   `JFRAG_POSTGRESQL_READONLY_DB_URL` in Doppler `forge-rag/prd`. Do not replace
   the Railway service's owner `DATABASE_URL`; Prisma pre-deploy migrations
   still require ownership. Evaluation and dashboard startup reject the URL
   unless its username exactly matches `JFRAG_READONLY_ROLE_NAME`, which defaults
   to `forge_rag_evaluator`.
6. Run `env:check production-read`, then
   `db:verify-readonly --production`, through the same Doppler target. Record
   only target identity, role name, aggregate privilege counts, and pass/fail.
   Remove the temporary standalone password secret after the URL is stored and
   verified.
7. Rerun the blocked production migration-status and evaluation preflight. Do
   not proceed if the expected-host guard, migration state, or read-only proof
   fails.

Railway's PostgreSQL service exposes its owner URL automatically and keeps
service-to-service traffic private by default. The derived reader URL is a
separate application secret; Railway does not automatically create it as a
reference variable. The role persists with the PostgreSQL data volume, but a
restore or database replacement requires the privilege verifier before reuse.
If a later migration creates objects under another owner or outside `public`,
extend and rerun provisioning before the read workflow uses those objects.

## Rotation and rollback

For rollback-safe rotation, provision a new versioned login name with
`JFRAG_READONLY_ROLE_NAME`, store and verify its URL, and switch the
production-read secret to it. Retain the previous reader URL through the
rollback window, then revoke and drop the old login with an explicitly reviewed
owner session. Rerunning provisioning with the same login changes its password
immediately and is appropriate only when retaining the old credential is not a
requirement. A rollback must never restore owner credentials to the
production-read variable.
