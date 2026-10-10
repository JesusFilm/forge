# RAG contracts

Runtime-neutral HTTP `/v1` schemas and inferred TypeScript types for Forge RAG
consumers. Import the public contract from `@forge/rag-contracts`; internal RAG
ports remain owned by `apps/rag`.

`openapi.v1.json` is generated from the runtime schemas. Regenerate it with
`pnpm --filter @forge/rag-contracts contract:generate`; tests fail when the
committed artifact drifts.
