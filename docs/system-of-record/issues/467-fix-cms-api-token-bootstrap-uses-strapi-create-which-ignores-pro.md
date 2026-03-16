---
artifactType: issue
issueNumber: 467
issueTitle: "fix(cms): API token bootstrap uses Strapi create() which ignores provided accessKey"
issueUrl: "https://github.com/JesusFilm/forge/issues/467"
state: "CLOSED"
closedAt: "2026-03-15T21:44:11Z"
labels: ["fix", "cms"]
linkedPrs: []
---

# Issue Artifact: #467

## Background

The `ensureInternalApiToken` bootstrap in `apps/cms/src/internal-api-token.ts` calls `apiTokenService.create()` to provision the internal API token. However, Strapi v5's `create()` method **always generates a random `accessKey`** via `crypto.randomBytes(128)` and ignores the `accessKey` field passed in the input payload.

This means the token stored in the database is hashed from a random key that is immediately discarded, while the web app sends the value from `STRAPI_INTERNAL_API_TOKEN` — causing every GraphQL request to return **401 Unauthorized**.

The token also gets "rotated" on every restart because `isTokenMatch` can never match the stored hash (which belongs to a discarded random key).

## Expected outcome

The bootstrap should write the hashed version of `STRAPI_INTERNAL_API_TOKEN` directly to the database, bypassing `apiTokenService.create()`. After a CMS restart, GraphQL requests from the web app using the matching `STRAPI_API_TOKEN` should authenticate successfully.

## Acceptance criteria

- [ ] `createReadOnlyToken` bypasses `apiTokenService.create()` and writes directly to `admin::api-token` with a properly hashed + encrypted access key
- [ ] Token is NOT rotated on every restart when the env value hasn't changed
- [ ] Web app can successfully query `/graphql` using the token from `STRAPI_API_TOKEN`

## Possible solution(s)

1. Use `strapi.db.query("admin::api-token").create()` directly with `apiTokenService.hash(accessKey)` and `encryptionService.encrypt(accessKey)` — matching what Strapi's own `create()` does internally, but with the provided key instead of a random one.

## References

- Strapi v5 api-token service source: `node_modules/@strapi/admin/dist/server/server/src/services/api-token.mjs` (line 128: `crypto.randomBytes(128)`)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
