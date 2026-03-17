---
artifactType: plan
sourceId: 471
sourceTitle: "fix(web): use client/server specific GraphQL URL env vars"
linkedPrs: []
scope: "web"
---

# Plan Artifact: "fix(web): use client/server specific GraphQL URL env vars"

## Objective

Web client code resolves GraphQL URL by runtime: client-side uses `NEXT_PUBLIC_GRAPHQL_URL`, server-side uses `PUBLIC_GRAPHQL_URL`.

## Planned approach

1. Detect runtime with `typeof window !== 'undefined'` and select env var accordingly.
2. Keep one fallback path for local/default URL if env vars are missing.

## Validation

- [ ] Client-side requests use `NEXT_PUBLIC_GRAPHQL_URL`
- [ ] Server-side requests use `PUBLIC_GRAPHQL_URL`
- [ ] Existing web client construction still works in both runtimes

## References

- apps/web/src/lib/client.ts

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
