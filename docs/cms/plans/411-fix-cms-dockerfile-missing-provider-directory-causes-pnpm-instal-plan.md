---
artifactType: plan
sourceId: 411
sourceTitle: "fix(cms): Dockerfile missing provider directory causes pnpm install ENOENT"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms): Dockerfile missing provider directory causes pnpm install ENOENT"

## Objective

Docker build completes `pnpm install` step successfully by having the provider's `package.json` available before install.

## Planned approach

1. Add `COPY apps/cms/providers/strapi-provider-email-ses/package.json apps/cms/providers/strapi-provider-email-ses/package.json` before the `pnpm install` RUN step.

## Validation

- [x] Provider package.json is copied before `pnpm install` in Dockerfile
- [x] Docker build passes the install step without ENOENT

## References

- `apps/cms/Dockerfile`
- `apps/cms/package.json` line 24: `\"strapi-provider-email-ses\": \"file:providers/strapi-provider-email-ses\"`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
