---
artifactType: issue
issueNumber: 471
issueTitle: "fix(web): use client/server specific GraphQL URL env vars"
issueUrl: "https://github.com/JesusFilm/forge/issues/471"
state: "CLOSED"
closedAt: "2026-03-15T23:15:34Z"
labels: ["fix", "web"]
linkedPrs: []
scope: "web"
---

# Issue Artifact: #471

## Background

The web GraphQL client should choose environment variables based on runtime context. Browser traffic should use the public client-safe URL, while server-side traffic should use the server URL.

## Expected outcome

Web client code resolves GraphQL URL by runtime: client-side uses `NEXT_PUBLIC_GRAPHQL_URL`, server-side uses `PUBLIC_GRAPHQL_URL`.

## Acceptance criteria

- [ ] Client-side requests use `NEXT_PUBLIC_GRAPHQL_URL`
- [ ] Server-side requests use `PUBLIC_GRAPHQL_URL`
- [ ] Existing web client construction still works in both runtimes

## Possible solution(s)

1. Detect runtime with `typeof window !== 'undefined'` and select env var accordingly.
2. Keep one fallback path for local/default URL if env vars are missing.

## References

- apps/web/src/lib/client.ts

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
