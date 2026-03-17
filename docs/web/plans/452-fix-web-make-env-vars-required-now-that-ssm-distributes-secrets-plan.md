---
artifactType: plan
sourceId: 452
sourceTitle: "fix(web): make env vars required now that SSM distributes secrets"
linkedPrs: []
scope: "web"
---

# Plan Artifact: "fix(web): make env vars required now that SSM distributes secrets"

## Objective

Env validation enforces presence of server-side secrets, and preview route drops the redundant nil guard.

## Planned approach

1. Remove `.optional()` from both server env vars in `env.ts`
2. Simplify preview route secret comparison

## Validation

- [ ] `apps/web/src/env.ts`: `STRAPI_API_TOKEN` and `STRAPI_PREVIEW_SECRET` use `z.string()` (not `.optional()`)
- [ ] `apps/web/src/app/api/preview/route.ts`: remove redundant `!env.STRAPI_PREVIEW_SECRET ||` guard
- [ ] Build passes

## References

- Parent epic: #68
- `apps/web/src/env.ts`
- `apps/web/src/app/api/preview/route.ts`

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
