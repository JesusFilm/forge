---
id: "feat-001"
title: "Architecture Contracts"
owner: "tataihono"
priority: "P0"
status: "not-started"
start_date: "2026-04-01"
duration: 7
depends_on: []
blocks:
  - "feat-003"
  - "feat-008"
  - "feat-019"
tags:
  - "infrastructure"
  - "cms"
  - "graphql"
---

## Entry Points — Read These First

1. `apps/cms/src/api/experience/content-types/experience/schema.json` — Experience schema, the target for generated content
2. `apps/cms/schema.graphql` — full GraphQL schema, the system contract
3. `apps/manager/src/services/embeddings.ts` — embedding dimensions (1536), model (`text-embedding-3-small`)
4. `apps/manager/src/types/job.ts` — existing workflow types
5. `apps/cms/config/database.ts` — PostgreSQL config (Railway)

## Decisions To Make and Document

Each decision becomes a short doc in `docs/architecture/` (create the directory). Format:

```markdown
# Decision: [Title]

## Context

[Why this decision is needed]

## Decision

[The choice]

## Consequences

[What this enables and constrains]
```

**Decision 1: Topic Content Type Schema**

- Define exact fields, relations, hierarchy model
- Output: the JSON schema Nisal implements (see `docs/roadmap/topic-experiences/feat-003-topic-content-type.md` for draft)
- Key question: self-referential hierarchy (manyToOne parentTopic) vs. separate TopicGroup type

**Decision 2: Vector Database**

- Recommend: pgvector on existing Railway PostgreSQL
- Why not managed (Pinecone, Weaviate): adds infrastructure complexity, cost, and a new deployment target. pgvector is sufficient at our scale (< 1M vectors) and keeps everything in one database.
- Document: table schema, index type (HNSW), expected query patterns

**Decision 3: Search API Contract**

- REST custom controller (not GraphQL) — vector queries don't fit Strapi's resolver model
- Define: request params, response shape, pagination, filtering
- Output: the contract Nisal implements and Urim consumes (see `docs/roadmap/content-discovery/feat-010-semantic-search-api.md`)

**Decision 4: Topic URL Structure**

- Options: `/topics/[slug]` (flat) vs `/topics/[parent]/[child]` (nested)
- Recommend: flat `/topics/[slug]` — simpler routing, slugs are unique, avoids URL changes when hierarchy changes
- Affects: `apps/web/src/app/topics/` route structure

**Decision 5: Bulk Experience Write Contract**

- Define: what Ekkasit's pipeline sends, what Nisal's API accepts
- Key question: use Strapi `entityService` (handles dynamic zones natively but slower) vs. raw SQL (fast but dynamic zones are complex in DB)
- Recommend: `entityService` first, optimize only if profiling shows it's too slow

**Decision 6: Experience Template Location**

- Options: CMS content type (editable by non-developers) vs. code (version-controlled, typed)
- Recommend: TypeScript in `apps/manager/src/templates/` — templates are structural, not editorial. They change with the codebase.

**Decision 7: Auth Provider (Q3 Prep)**

- Not needed until June but influences schema decisions now
- Options: Clerk (hosted, fast to integrate), Auth.js (self-hosted, Next.js native), Strapi Users & Permissions (already exists but limited)
- Make the call so Nisal doesn't build things that conflict with it

## Constraints

- Keep decisions short. One page per decision, not a design doc.
- Each decision must unblock at least one person on the team.
- Share decisions in the team channel within 24 hours. Don't let them sit in docs unread.

## Verification

- `ls docs/architecture/` → 7 decision files
- Nisal can start Feature 1 without asking you questions about the schema
- Ekkasit can start Feature 2 without asking where templates live
- Urim can stub the search API without asking about the response shape
