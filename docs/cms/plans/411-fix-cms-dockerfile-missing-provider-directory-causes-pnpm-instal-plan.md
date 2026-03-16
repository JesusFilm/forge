---
artifactType: plan
sourceIssueNumber: 411
sourceIssueTitle: "fix(cms): Dockerfile missing provider directory causes pnpm install ENOENT"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/411"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #411

## Objective

Docker build completes `pnpm install` step successfully by having the provider's `package.json` available before install.

## Planned approach

1. Add `COPY apps/cms/providers/strapi-provider-email-ses/package.json apps/cms/providers/strapi-provider-email-ses/package.json` before the `pnpm install` RUN step.

## Validation

- [x] Provider package.json is copied before `pnpm install` in Dockerfile
- [x] Docker build passes the install step without ENOENT

## Source links

- Issue: [#411](https://github.com/JesusFilm/forge/issues/411)
- PRs:
- None
