---
artifactType: plan
sourceIssueNumber: 392
sourceIssueTitle: "fix(cms): knex acquireConnection loses `this` context in internal-api-token bootstrap"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/392"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #392

## Objective

CMS boots successfully — advisory lock acquisition uses bound method calls so knex's `this.pool` resolves correctly.

## Planned approach

1. Keep a reference to `client` and call `client.acquireConnection()` / `client.releaseConnection()` directly instead of extracting methods.

## Validation

- [ ] `acquireConnection` and `releaseConnection` called with correct `this` context
- [ ] CMS bootstrap no longer crashes with `pool` TypeError
- [ ] CI passes

## Source links

- Issue: [#392](https://github.com/JesusFilm/forge/issues/392)
- PRs:
- None
