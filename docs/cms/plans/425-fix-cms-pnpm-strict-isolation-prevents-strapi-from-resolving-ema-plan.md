---
artifactType: plan
sourceIssueNumber: 425
sourceIssueTitle: "fix(cms): pnpm strict isolation prevents Strapi from resolving email provider"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/425"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #425

## Objective

Strapi resolves `strapi-provider-email-ses` at runtime in the Docker container.

## Planned approach

1. Add `.npmrc` with `public-hoist-pattern[]=strapi-provider-*` — hoists the provider to `/workspace/node_modules/` which is in the Node resolution path from any nested `.pnpm/` package.

## Validation

- [ ] Create `.npmrc` with `public-hoist-pattern` that hoists Strapi provider to root `node_modules/`
- [ ] Regenerate `pnpm-lock.yaml`
- [ ] Provider resolves at runtime from `@strapi/email`'s context

## Source links

- Issue: [#425](https://github.com/JesusFilm/forge/issues/425)
- PRs:
- None
