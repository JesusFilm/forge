---
artifactType: issue
issueNumber: 452
issueTitle: "fix(web): make env vars required now that SSM distributes secrets"
issueUrl: "https://github.com/JesusFilm/forge/issues/452"
state: "CLOSED"
closedAt: "2026-03-13T03:17:15Z"
labels: ["fix", "web"]
linkedPrs: []
---

# Issue Artifact: #452

## Background

With AWS SSM Parameter Store now distributing secrets for web deployments (epic #68), the `STRAPI_API_TOKEN` and `STRAPI_PREVIEW_SECRET` env vars are guaranteed to be present at runtime. The current `z.string().optional()` validations and defensive null checks are no longer necessary and weaken the fail-fast contract.

## Expected outcome

Env validation enforces presence of server-side secrets, and preview route drops the redundant nil guard.

## Acceptance criteria

- [ ] `apps/web/src/env.ts`: `STRAPI_API_TOKEN` and `STRAPI_PREVIEW_SECRET` use `z.string()` (not `.optional()`)
- [ ] `apps/web/src/app/api/preview/route.ts`: remove redundant `!env.STRAPI_PREVIEW_SECRET ||` guard
- [ ] Build passes

## Possible solution(s)

1. Remove `.optional()` from both server env vars in `env.ts`
2. Simplify preview route secret comparison

## References

- Parent epic: #68
- `apps/web/src/env.ts`
- `apps/web/src/app/api/preview/route.ts`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
