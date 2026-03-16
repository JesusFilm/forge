---
artifactType: plan
sourceIssueNumber: 452
sourceIssueTitle: "fix(web): make env vars required now that SSM distributes secrets"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/452"
linkedPrs: []
scope: "web"
---

# Plan Artifact: #452

## Objective

Env validation enforces presence of server-side secrets, and preview route drops the redundant nil guard.

## Planned approach

1. Remove `.optional()` from both server env vars in `env.ts`
2. Simplify preview route secret comparison

## Validation

- [ ] `apps/web/src/env.ts`: `STRAPI_API_TOKEN` and `STRAPI_PREVIEW_SECRET` use `z.string()` (not `.optional()`)
- [ ] `apps/web/src/app/api/preview/route.ts`: remove redundant `!env.STRAPI_PREVIEW_SECRET ||` guard
- [ ] Build passes

## Source links

- Issue: [#452](https://github.com/JesusFilm/forge/issues/452)
- PRs:
- None
