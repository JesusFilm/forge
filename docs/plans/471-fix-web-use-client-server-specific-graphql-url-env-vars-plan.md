---
artifactType: plan
sourceIssueNumber: 471
sourceIssueTitle: "fix(web): use client/server specific GraphQL URL env vars"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/471"
linkedPrs: []
---

# Plan Artifact: #471

## Objective

Web client code resolves GraphQL URL by runtime: client-side uses `NEXT_PUBLIC_GRAPHQL_URL`, server-side uses `PUBLIC_GRAPHQL_URL`.

## Planned approach

1. Detect runtime with `typeof window !== 'undefined'` and select env var accordingly.
2. Keep one fallback path for local/default URL if env vars are missing.

## Validation

- [ ] Client-side requests use `NEXT_PUBLIC_GRAPHQL_URL`
- [ ] Server-side requests use `PUBLIC_GRAPHQL_URL`
- [ ] Existing web client construction still works in both runtimes

## Source links

- Issue: [#471](https://github.com/JesusFilm/forge/issues/471)
- PRs:
- None
