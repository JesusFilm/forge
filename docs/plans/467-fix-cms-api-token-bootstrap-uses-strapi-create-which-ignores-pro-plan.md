---
artifactType: plan
sourceIssueNumber: 467
sourceIssueTitle: "fix(cms): API token bootstrap uses Strapi create() which ignores provided accessKey"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/467"
linkedPrs: []
---

# Plan Artifact: #467

## Objective

The bootstrap should write the hashed version of `STRAPI_INTERNAL_API_TOKEN` directly to the database, bypassing `apiTokenService.create()`. After a CMS restart, GraphQL requests from the web app using the matching `STRAPI_API_TOKEN` should authenticate successfully.

## Planned approach

1. Use `strapi.db.query("admin::api-token").create()` directly with `apiTokenService.hash(accessKey)` and `encryptionService.encrypt(accessKey)` — matching what Strapi's own `create()` does internally, but with the provided key instead of a random one.

## Validation

- [ ] `createReadOnlyToken` bypasses `apiTokenService.create()` and writes directly to `admin::api-token` with a properly hashed + encrypted access key
- [ ] Token is NOT rotated on every restart when the env value hasn't changed
- [ ] Web app can successfully query `/graphql` using the token from `STRAPI_API_TOKEN`

## Source links

- Issue: [#467](https://github.com/JesusFilm/forge/issues/467)
- PRs:
- None
