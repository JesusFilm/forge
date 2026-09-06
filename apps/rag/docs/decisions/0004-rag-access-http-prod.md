# ADR-0004 — RAG access is via the production `/v1` HTTP API

- Status: Forge-amended — scoped, read-only `/v1` access remains accepted, but
  production is no longer the exclusive network route.
- Date: 2026-06-15
- Issue/PR: #36 (consumer token allocation)
- Related: ADR-0001 (ports & the import law), ADR-0002 (embeddings)

**Forge migration note.** The public `/v1` contract and scoped bearer semantics
remain intact. Forge-owned consumers may call the same service over Railway's
private network, while external consumers use the public route. Local engine
work and deterministic tests still use a local database/fixture corpus. Current
deployment and authentication procedures live in
[`../ops/http-service.md`](../ops/http-service.md).

## Context

Consumer systems and the engineers of the RAG itself ("RAG Engine Devs") both
need a working RAG to call. The first instinct was to give each person a local
copy of the corpus — a production DB backup restored locally, or a local
re-crawl + re-index. Both are costly: a DB dump puts a database credential on
laptops and moves large vector data; a local re-index costs hours of crawl plus
per-person embedding spend. The forcing question: what is the actual access
path, given the RAG is reached over an HTTP retrieval API, not by querying its
database?

## Decision

**Access the RAG exclusively through its `/v1` HTTP API, pointed at the
production deployment** — for both consumers and for RAG Engine Devs doing
development/integration. Production is the only deployed environment today, and
that is acceptable because the `/v1` boundary is **read-only over public
content** (no write surface — see `AGENTS.md`): a leaked or misused bearer token
can only run searches, never mutate or drop anything.

- **Consumers** authenticate with a **scoped, read-only, revocable** bearer
  token — a per-consumer source-key allowlist via `SERVE_BEARER_TOKENS`
  (`src/serving/http/auth.ts`). The _process_ for allocating these tokens is
  tracked in #36.
- **RAG Engine Devs** reach the running RAG the same way — over `/v1` against
  production — for development and integration. (Work that changes the engine
  _itself_ still runs the local stack: `docker compose up` + `pnpm acquire` /
  `index` against a local corpus. That is a separate, infrequent path, not the
  general access route.)

## Alternatives rejected

- **Production DB backup → restore locally** — gives each person a full local
  corpus, but puts a `DATABASE_URL` on laptops (a careless or agentic mistake
  could damage prod), ships large vector data, and serves an audience
  (consumers) that never touches SQL. Complexity far exceeds the need. Shelved.
- **Local re-crawl + re-index per person** — fully reproducible and
  credential-free, but costs hours of crawl and per-person embedding spend for
  an endpoint that already exists. Reserved for the rare case of changing the
  engine and needing a local corpus.
- **A staging environment now** — a prod-like `/v1` instance with its own data
  would isolate dev/test load from production, but standing one up today is
  overkill: load is low and the read-only/public boundary makes hitting prod
  safe. **Deferred, not rejected** — see Consequences.

## Consequences

- (+) Zero per-person setup for the common case: request a `/v1` base URL + a
  token and call search. No database credentials on laptops; the
  read-only/public boundary bounds a leaked token to "can run searches."
- (–) Development/integration traffic shares production's serving instance and
  DB. Mitigations: scoped, rate-limited, revocable tokens (rate limiting is a
  follow-up — the `/v1` app has none today, #36); keep heavy/automated load
  (CI, load tests) off production; reproducible tests use a small local fixture
  corpus rather than live prod.
- **Deferred future option (explicit, so it is not re-litigated):** if
  production load ever becomes a problem, stand up a **staging environment
  populated from a production backup** and point RAG Engine Devs (and
  heavy/automated load) at staging instead of production. This is the _only_
  place the production-backup idea retains a role — a future load-relief
  measure, not a developer-onboarding mechanism. Not in scope now.
