---
artifactType: plan
sourceId: 392
sourceTitle: "fix(cms): knex acquireConnection loses `this` context in internal-api-token bootstrap"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms): knex acquireConnection loses `this` context in internal-api-token bootstrap"

## Objective

CMS boots successfully — advisory lock acquisition uses bound method calls so knex's `this.pool` resolves correctly.

## Planned approach

1. Keep a reference to `client` and call `client.acquireConnection()` / `client.releaseConnection()` directly instead of extracting methods.

## Validation

- [ ] `acquireConnection` and `releaseConnection` called with correct `this` context
- [ ] CMS bootstrap no longer crashes with `pool` TypeError
- [ ] CI passes

## References

- #302 (introduced the file)
- Stack trace: `knex/lib/client.js:310:15` → `internal-api-token.js:31:27`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
