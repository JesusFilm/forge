# ADR-0003 — Data access uses Drizzle's query builder behind the ports

- Status: Forge-superseded — Forge uses Prisma plus bounded raw SQL. Retained
  for historical rationale; do not restore Drizzle.
- Date: 2026-05-27
- Issue/PR: #20
- Related: ADR-0001 (ports & the import law), ADR-0002 (halfvec embeddings)

## Context

The data layer was a hybrid: Drizzle defined the schema + migrations, but every
adapter query was hand-written SQL over the postgres-js client — Drizzle's query
API was never used. Issue #20 asked us to move to a single ORM (Prisma a leading
candidate) so we aren't writing raw SQL by hand, and to record the choice
deliberately this time rather than letting it be a default.

## Decision

Keep **Drizzle as the single data-access tool**: continue using it for schema +
migrations, and adopt its **query builder** for adapter CRUD. The pgvector
(`<=>` on `halfvec`) and full-text (`tsvector`) hot paths stay as `sql\`…\``fragments — no ORM can type those (ADR-0002) — but they interleave *inside*
Drizzle queries, so each adapter file reads in one idiom. Nothing changes above
the ports (ADR-0001): the change is confined to the inside of`src/adapters`.

## Alternatives rejected

- **Prisma (full ORM)** — needs a second schema representation (hand-synced or
  introspected) and forces a `$queryRaw` context-switch for the vector/FTS paths
  it can't model. "Team familiarity" is the only real pull, and it's weak in an
  agentic codebase where the next contributor reads the docs, not muscle memory.
  It adds the most surface to help the CRUD that needs help least.
- **Kysely** — a clean typed builder, but a new dependency with its own table
  types to maintain; Drizzle already owns the schema and ships here today.
- **Status quo (raw SQL everywhere)** — already parameterized and
  injection-safe, but verbose for the `ON CONFLICT` upserts and untyped against
  column renames. Readability and compile-time safety are the reasons to move.

## Consequences

- (+) One tool (Drizzle) for schema + CRUD; typed upserts; raw SQL shrinks to the
  two queries no ORM could express anyway.
- (–) One narrow import-law relaxation (ADR-0001): adapters may import
  `src/db/schema.ts`, an internal module we own. The vector search stays partly
  raw regardless.
- Ports are unchanged, so the existing fakes-only unit tests, the two
  real-Postgres integration tests, `pnpm eval`, and `pnpm smoke` are the parity
  gate for the implementation.
- **This ADR records the decision only.** The implementation (rewriting the
  adapter CRUD onto the query builder) is a separate PR tracked by issue #20.
