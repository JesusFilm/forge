---
artifactType: issue
issueNumber: 392
issueTitle: "fix(cms): knex acquireConnection loses `this` context in internal-api-token bootstrap"
issueUrl: "https://github.com/JesusFilm/forge/issues/392"
state: "CLOSED"
closedAt: "2026-03-11T22:32:50Z"
labels: ["fix", "cms"]
linkedPrs: []
---

# Issue Artifact: #392

## Background

CMS crash-loops on startup with `TypeError: Cannot read properties of undefined (reading 'pool')`. The stack trace points to `withTokenBootstrapLock` in `internal-api-token.ts` (introduced in #302).

Root cause: `connection.client?.acquireConnection` and `connection.client?.releaseConnection` are extracted as standalone function references (lines 38–39), losing their `this` binding. When knex's `acquireConnection()` executes, `this` is `undefined`, so `this.pool` throws.

## Expected outcome

CMS boots successfully — advisory lock acquisition uses bound method calls so knex's `this.pool` resolves correctly.

## Acceptance criteria

- [ ] `acquireConnection` and `releaseConnection` called with correct `this` context
- [ ] CMS bootstrap no longer crashes with `pool` TypeError
- [ ] CI passes

## Possible solution(s)

1. Keep a reference to `client` and call `client.acquireConnection()` / `client.releaseConnection()` directly instead of extracting methods.

## References

- #302 (introduced the file)
- Stack trace: `knex/lib/client.js:310:15` → `internal-api-token.js:31:27`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
