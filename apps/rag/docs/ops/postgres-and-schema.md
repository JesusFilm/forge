# PostgreSQL schema operations

Forge RAG owns a distinct PostgreSQL database. These procedures migrate and
verify schema only; they never copy corpus rows or deploy local code.

## Local fresh-database proof

```sh
docker compose -f apps/rag/docker-compose.yml up -d --wait postgres
DATABASE_URL=postgresql://forge:forge@localhost:5435/forge_rag pnpm --filter @forge/rag db:migrate:deploy
DATABASE_URL=postgresql://forge:forge@localhost:5435/forge_rag pnpm --filter @forge/rag db:migrate:status
DATABASE_URL=postgresql://forge:forge@localhost:5435/forge_rag pnpm --filter @forge/rag db:drift:check
DATABASE_URL=postgresql://forge:forge@localhost:5435/forge_rag pnpm --filter @forge/rag db:verify
```

Run `db:migrate:deploy` a second time to prove idempotence. It must report no
pending migrations. The integration suite requires `DATABASE_URL`; it fails
instead of skipping when no real database is configured.

## Railway production provisioning

Fixed targets are Railway project `forge`, environment `production`, database
service `@forge/rag-postgres`, and application service `@forge/rag`. Stop if
the selected targets differ.

1. Create a dedicated PostgreSQL service named `@forge/rag-postgres`.
2. Add `DATABASE_URL` to `@forge/rag` as a Railway reference to the database
   service. Never copy the connection string into a transcript.
3. Set the application service Config-as-code Path exactly to
   `apps/rag/railway.toml`. Confirm the resulting deployment metadata names that
   config file; `configFile: null` means Railway ignored it.
4. Merge through the normal PR-to-main path. Never run `railway up`.
5. For the initial schema-only deployment, run the checked-in migration from a
   clean checkout of merged `main` with Railway production variables and an
   approved connection to `@forge/rag-postgres`. The application service has no
   start command until feat-428, so Railway cannot yet reach its configured
   pre-deploy phase. Do not add a placeholder runtime to bypass that boundary.
6. Run `pnpm --filter @forge/rag db:migrate:status` and
   `pnpm --filter @forge/rag db:drift:check` against the same target, then run
   the metadata-only SQL below through the approved database connection.
7. During feat-428, confirm the first runnable service deployment executes the
   already configured `pnpm --filter @forge/rag db:migrate:deploy` pre-deploy
   command successfully. That proves deployment automation; it is not a
   prerequisite for provisioning the empty schema in this ticket.

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NULL AS active
FROM "_prisma_migrations" ORDER BY migration_name;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
SELECT format_type(a.atttypid, a.atttypmod) AS embedding_type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
WHERE c.relname = 'chunk_embeddings' AND a.attname = 'embedding';
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' ORDER BY indexname;
SELECT
  (SELECT count(*) FROM sources) AS sources,
  (SELECT count(*) FROM documents) AS documents,
  (SELECT count(*) FROM chunks) AS chunks,
  (SELECT count(*) FROM chunk_embeddings) AS chunk_embeddings,
  (SELECT count(*) FROM raw_documents) AS raw_documents,
  (SELECT count(*) FROM http_cache) AS http_cache,
  (SELECT count(*) FROM robots_cache) AS robots_cache;
SELECT 1 AS readable;
```

Expected: vector is installed; the initial migration is finished and active;
all seven RAG tables exist; embedding type is `halfvec(1536)`; HNSW, JSON GIN,
and generated-tsvector GIN indexes exist; every reported row count is zero; the
simple read succeeds. Record target identifiers, deployment ID, and pass/fail
only. Do not record credentials, URLs, migration checksums, or corpus content.

Rollback before corpus copy is destructive only to the new empty target: retain
the failed deployment evidence, delete/recreate only `@forge/rag-postgres`, and
rerun the normal deploy after fixing the migration. The legacy jfrag database
remains untouched.
