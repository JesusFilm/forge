---
title: "Transport-independent RAG contracts and pure port-based retrieval cores"
date: 2026-08-27
category: architecture-patterns
module: apps/rag + packages/rag-contracts
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Moving a retrieval service without importing its transport, database, or provider adapters"
  - "Sharing versioned retrieval contracts across independent consumers"
  - "Protecting retrieval against mixed embedding models and accidentally unbounded source scopes"
  - "Publishing a deterministic, drift-tested OpenAPI contract"
related_components: [api_layer, testing_framework, tooling]
tags:
  [
    rag,
    retrieval,
    ports-and-adapters,
    embedding-model,
    source-scope,
    openapi,
    contract-drift,
  ]
---

# Transport-independent RAG contracts and pure port-based retrieval cores

PR [#2073](https://github.com/JesusFilm/forge/pull/2073) is open and unmerged as of 2026-08-27. It demonstrates a reusable relocation pattern: put consumer-facing wire contracts in `packages/rag-contracts`, put transport-independent mechanisms and I/O ports in `apps/rag`, and defer database, provider, HTTP, and deployment adapters to later work.

## Context

Copying an external service entrypoint and its adapters first imports deployment assumptions before the target repository has stabilized the domain contract. The Forge migration instead establishes the public retrieval vocabulary as a runtime-validated package, then ports the behavior behind abstract ports.

Earlier migration analysis reached the same sequencing decision: “migrate first” means giving the existing bounded context a behaviorally equivalent Forge home, not redesigning every retrieval system during relocation (session history). Retrieval remains an evidence-producing service—it returns ranked, cited passages while consumer applications retain audience policy and answer generation.

The shared package owns strict runtime schemas for citations, retrieval policy, ranked results, and `/v1` request and response envelopes ([retrieval.ts](../../../packages/rag-contracts/src/retrieval.ts)). The app owns pure acquisition, indexing, language-resolution, and retrieval mechanisms. Its port definitions explicitly leave concrete implementations to adapters and composition-root wiring ([ports.ts](../../../apps/rag/src/contracts/ports.ts)).

## Guidance

### Make the wire contract a runtime-validated package

Define consumer-visible requests, responses, policies, citations, and results once. Infer TypeScript types from the runtime schemas instead of maintaining parallel interfaces. Keep those objects strict so unexpected fields fail at the boundary.

Generate OpenAPI from those same schemas. The generator assembles the `/v1/health` and `/v1/search` components and writes deterministic JSON ([generate-openapi.ts](../../../packages/rag-contracts/scripts/generate-openapi.ts)). A drift test compares the committed artifact with a fresh in-memory build ([openapi-drift.test.ts](../../../packages/rag-contracts/tests/openapi-drift.test.ts)). The committed document is generated evidence, not a second editable source of truth.

### Model effects as ports and keep mechanisms pure

Ports describe fetching, state, raw-document storage, embedding, corpus writes, corpus search, and document assembly without selecting an implementation. Mechanisms accept these ports as dependencies. For example, the retriever receives only an embedder and corpus search store; it does not construct a database client or provider SDK ([retrieve.ts](../../../apps/rag/src/retrieval/retrieve.ts)).

This allows the behavioral port to land before serving and persistence work without inventing placeholder production wiring.

### Make dependency lanes executable

Dependency rules should enforce the architecture after the initial port. The RAG rules confine core modules to their lane plus contracts, prohibit production imports from fakes, reject cross-app imports and cycles, and reserve composition for `main.ts` ([.dependency-cruiser.cjs](../../../apps/rag/.dependency-cruiser.cjs)). The package test command runs these rules alongside unit tests.

### Make fakes faithful to the port contract

In-memory fakes are valuable only when they preserve behavior that production adapters must later implement. The corpus-search fake applies filters, scores and sorts candidates, limits results, and reports embedding-model provenance ([corpus-search-store.ts](../../../apps/rag/src/fakes/corpus-search-store.ts)). Vector comparison rejects dimension mismatches rather than silently truncating inputs ([vector-math.ts](../../../apps/rag/src/fakes/vector-math.ts)).

Fakes-only success does not prove database or deployment integration. The next adapter phase still needs discriminating PostgreSQL and pgvector tests. See [Mocked-shape vs real-contract testing discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md).

### Encode retrieval safety structurally

An optional source allowlist has three states:

- omitted: no source restriction;
- populated: permit only named sources;
- explicitly empty: permit nothing.

The retriever returns before embedding when the allowlist is empty, and the fake store independently preserves the same deny-all behavior. This prevents an empty authorization scope from becoming unrestricted retrieval or incurring provider cost ([retrieve.test.ts](../../../apps/rag/src/retrieval/retrieve.test.ts)).

Query and stored document vectors are comparable only when they share model provenance. The embedder port exposes its model and dimensions, the store may report corpus models, and retrieval rejects a known incompatible corpus. The compatibility guard is cached briefly, but empty-corpus and failure results are not retained indefinitely. The active model is also passed into the store filter so rows with recorded provenance can be restricted to the compatible model; production adapters must enforce equivalent provenance semantics. Equal dimensions alone are insufficient; see [OpenRouter-only embedding provider contract](../best-practices/openrouter-only-embedding-provider-contract.md).

### Bound work at both layers

The public schema bounds requested result count. The mechanism over-fetches enough candidates to survive cutoff and deduplication, while applying its own absolute ceiling. Its order remains explicit: validate model compatibility, embed the query, fetch bounded candidates, apply score cutoff and preference, deduplicate, limit results, then construct citations. Full-document assembly is opt-in and batched only for winners.

## Why This Matters

The split creates two stable seams. Consumers can validate `/v1` payloads without depending on a service runtime, database client, or provider SDK. Domain mechanisms can be exercised entirely in memory. Generated-artifact drift tests prevent wire documentation from diverging, while dependency rules prevent later work from eroding the bounded context.

It also makes unsafe edge cases testable before adapters exist: an empty authorization scope denies access before expensive work, known model mismatches fail closed, incompatible vector dimensions fail loudly, and candidate and response sizes remain bounded.

## When to Apply

- Moving a domain service between repositories or runtimes.
- Giving multiple consumers a stable wire contract before a replacement server exists.
- Separating domain behavior from database, provider, HTTP, or deployment code.
- Preserving behavior during a migration without importing legacy infrastructure wholesale.
- Making retrieval authorization, embedding provenance, and resource bounds locally provable.

Do not interpret this stage as operational readiness. Concrete adapters, transport handlers, authentication, database conformance, deployment, and post-deploy smoke checks remain separate phases.

## Examples

Consumer-neutral validation:

```ts
const request = searchRequestSchema.parse(input)
const response: SearchResponse = {
  results: await retriever.search(request.query, request.policy),
}
```

Pure behavior with fake ports:

```ts
const retriever = createRetriever({
  embedder: new FakeEmbedder(),
  search: new FakeCorpusSearchStore(seed),
})

const results = await retriever.search("grace", {
  allowedSourceKeys: ["jesusfilm-org"],
  topK: 5,
})
```

Deterministic contract verification:

```sh
pnpm --filter @forge/rag-contracts contract:generate
pnpm --filter @forge/rag-contracts test
```

## Related

- [JFRAG migration programme](https://github.com/JesusFilm/jesusfilm-rag/issues/130)
- [Shared contracts and pure-core relocation scope](https://github.com/JesusFilm/jesusfilm-rag/issues/159)
- [Canonical `/v1` contract origin](https://github.com/JesusFilm/jesusfilm-rag/issues/12)
- [Adapter and pgvector follow-up](https://github.com/JesusFilm/jesusfilm-rag/issues/160)
- [HTTP service and post-deploy verification follow-up](https://github.com/JesusFilm/jesusfilm-rag/issues/161)
- [Compile shim empty returns hide downstream contract drift](../best-practices/compile-shim-empty-return-hides-downstream-contract-drift.md)
