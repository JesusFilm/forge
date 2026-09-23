# Forge RAG database: corpus and R1 consumer registry

[Open the SVG](schema.svg) · [PNG for sharing](schema.png) · [Mermaid source](schema.mmd) · [Registry draft PR #2397](https://github.com/JesusFilm/forge/pull/2397)

![Existing corpus tables and proposed R1 consumer registry](schema.svg)

Blue groups contain the eight existing `public` tables. Amber contains the five
new `consumer_private` tables proposed in R1, in the **same RAG database**.
Solid arrows point from parent to child and represent actual foreign keys;
dotted arrows are logical references, not database constraints. Every child FK
is non-null. Parent-to-child cardinality is 1 to zero-or-many except embeddings
(zero-or-one) and memberships (one-or-many at transaction commit, with at least
one owner). Owners are rows in `members`, not a separate identity table.

## Sources and scope

Inspected on 2026-09-23, without connecting to any database:

- Existing schema: worktree base `fc299b20285c13d664e7f44365664731526ffedd`,
  `apps/rag/prisma/schema.prisma` and all three SQL migrations through
  `20260904000000_add_raw_document_promotion_index`. These files are unchanged
  in fetched main `77eb63fbb`.
- R1 SQL: [migration at `a562de94ab9d0522dc2002d3d265535839797753`](https://github.com/JesusFilm/forge/blob/a562de94ab9d0522dc2002d3d265535839797753/apps/rag/prisma/migrations/20260923000000_consumer_registry_foundation/migration.sql).
  Also inspected that revision's `src/adapters/postgres/consumer-registry.ts`
  and `docs/roadmap/rag/evidence/feat-527/j040-r1-consumer-registry.md`.
- SQL migrations are authoritative for constraints, raw types, indexes and
  triggers. The registry is intentionally raw SQL and absent from Prisma's
  public datamodel. “Existing” means committed schema, not independently
  verified production deployment. R1 is a frozen draft snapshot and may change.

## Important constraints and findings

- All four corpus FKs use `ON DELETE CASCADE`, `ON UPDATE NO ACTION`.
  The four registry FKs use `ON DELETE RESTRICT`; update behavior defaults to
  `NO ACTION`. No registry table has a corpus FK.
- `sources.key` and `consumers.name` are unique. Document canonical URLs are
  unique **per source**. Membership, environment and usage keys are composite;
  GitHub user IDs and environment names are not globally unique in their tables.
- `chunks.source_id` and `chunks.document_id` are independent FKs. The database
  does not enforce that the chunk's source equals its document's source.
  There is no unique `(document_id, ord)` constraint.
- `raw_documents.source_key`, `language_change_audits.document_id` and
  `language_change_audits.source_key` are not FKs. Dotted lines show useful joins;
  the audit-to-source logical link is omitted to reduce crossing lines.
  Acquisition caches are independent, keyed by URL, with no database relation
  to raw documents. Raw history is not unique by canonical URL.
- `chunks.search_tsv` is stored and generated using
  `to_tsvector('english', text)`. Tags and search vectors have GIN indexes;
  embeddings use HNSW with `halfvec_cosine_ops`. Each chunk has at most one
  embedding row, even across models. UUID PKs default to `gen_random_uuid()`
  except `chunk_embeddings.chunk_id`, which is inherited from its chunk.
- Registry consumer and environment state default to `pending`. Their CHECKs
  constrain values, not state transitions. Consumer identity update/deletion
  guards prevent changing ID/name or deleting a consumer through normal DML.
- Deferred constraint triggers check for an owner after consumer INSERT and
  member UPDATE/DELETE. The membership trigger locks the parent before UPDATE
  or DELETE and rejects moving a membership to another consumer. Multiple
  owners are permitted by SQL. The current adapter creates the initial owner
  atomically and only lets an owner add/remove ordinary members; it has no
  ownership-transfer API. These are DML invariants, not restrictions on a
  privileged administrator bypassing triggers or truncating tables.
- GitHub IDs are positive `bigint` values, not handles or FKs to a local user
  table. Audit actor membership and audit completeness are not DB-enforced;
  the adapter writes bounded lifecycle actions in its transactions.
- `allowed_source_keys` defaults to an empty array and prohibits NULL elements.
  SQL does not validate source existence, uniqueness, or the meaning of an empty
  list. The diagram does not infer an authorization policy from it.
- `usage_daily` stores counts by consumer, environment, date and outcome;
  counts cannot be negative. UTC day is the intended reporting convention in
  the PR notes, **not enforced by the SQL `date` type**. R1 has no usage writer
  or reporting path. No request text, bearer, IP or per-request identity is stored
  in this aggregate table.
- R1 revokes PUBLIC access to the private schema, tables and functions and
  adds no serving, corpus-reader or report grants. This is not a claim that
  database owners/superusers cannot access it. Credentials, HTTP admission,
  issuance/rotation and lifecycle policy remain outside this R1 snapshot.

## Regenerate

From the repository root, use Node/npm and Chromium. Dependencies are installed
outside the repository; no application dependency or lockfile change is needed.
The SVG is a deterministic-layout documentation artifact, not a database export.

```bash
mkdir -p /home/jacobuntu/j054-render
PUPPETEER_SKIP_DOWNLOAD=true npm install --prefix /home/jacobuntu/j054-render @mermaid-js/mermaid-cli@11.12.0 prettier@3.8.1
printf '%s\n' '{"executablePath":"/snap/bin/chromium","args":["--no-sandbox"]}' > /home/jacobuntu/j054-render/puppeteer.json
/home/jacobuntu/j054-render/node_modules/.bin/mmdc -i docs/diagrams/rag-database/schema.mmd -o docs/diagrams/rag-database/schema.svg -p /home/jacobuntu/j054-render/puppeteer.json -b white -w 3000
```

The home-directory tool location avoids Snap Chromium’s private `/tmp` namespace. Adjust `executablePath` and the tool directory for another machine. Use `--no-sandbox` only in a trusted
rendering environment with this local source. The included PNG can be regenerated
by replacing `schema.svg` with `schema.png` in the render command. The SVG is
zoomable; send the file or GitHub artifact link for full-size viewing.

## Validation and limitations

Completed review compared all 13 table names and all eight FK relationships to the
pinned SQL, including composite keys, cardinality, delete actions, owner triggers
and privacy boundaries. Mermaid CLI rendered successfully, and visual inspection confirmed readable labels and no clipped nodes in the zoomable artifact;
Prettier and `git diff --check` passed for the changed documentation. No migration
or application tests are necessary for this documentation-only change, and no
live database validation or production inspection was performed.

This is a selected-column diagram: routine timestamps, descriptive corpus fields,
cache/acquisition metadata, ordinary B-tree indexes, trigger function signatures,
Prisma's migration bookkeeping and database roles are omitted for readability.
`?` means nullable only for fields displayed individually; consult SQL for the
full column inventory. Logical joins are annotations, not new schema proposals.
The durable lesson is to inspect SQL alongside Prisma: raw-schema registry tables,
trigger-based owner requirements and vector/search indexes are not fully described
by Prisma alone.
