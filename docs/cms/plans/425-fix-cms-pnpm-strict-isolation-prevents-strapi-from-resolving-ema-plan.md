---
artifactType: plan
sourceId: 425
sourceTitle: "fix(cms): pnpm strict isolation prevents Strapi from resolving email provider"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms): pnpm strict isolation prevents Strapi from resolving email provider"

## Objective

Strapi resolves `strapi-provider-email-ses` at runtime in the Docker container.

## Planned approach

1. Add `.npmrc` with `public-hoist-pattern[]=strapi-provider-*` — hoists the provider to `/workspace/node_modules/` which is in the Node resolution path from any nested `.pnpm/` package.

## Validation

- [ ] Create `.npmrc` with `public-hoist-pattern` that hoists Strapi provider to root `node_modules/`
- [ ] Regenerate `pnpm-lock.yaml`
- [ ] Provider resolves at runtime from `@strapi/email`'s context

## References

- #411, #415 — prior fixes
- `apps/cms/config/plugins.ts` line 67 — provider config
- `apps/cms/Dockerfile`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
