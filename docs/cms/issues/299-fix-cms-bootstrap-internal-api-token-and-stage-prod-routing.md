---
artifactType: issue
issueNumber: 299
issueTitle: "fix(cms): bootstrap internal api token and stage/prod routing"
issueUrl: "https://github.com/JesusFilm/forge/issues/299"
state: "CLOSED"
closedAt: "2026-03-10T21:48:47Z"
labels: ["fix", "cms"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #299

## Background

Strapi should ensure an internal API token exists at startup when `STRAPI_INTERNAL_API_TOKEN` is provided. We also need deterministic stage/prod secret routing from SSM so only Vercel production uses the prod token, while Vercel preview and GitHub builds use stage.

## Expected outcome

CMS bootstraps a read-only internal token from env (create if missing, rotate when changed), and infra routes token values by environment exactly as requested.

## Acceptance criteria

- [ ] On CMS startup, if `STRAPI_INTERNAL_API_TOKEN` exists, Strapi ensures a read-only API token exists.
- [ ] Existing token is rotated/updated to env value when mismatched.
- [ ] CMS ECS task injects `STRAPI_INTERNAL_API_TOKEN` from SSM.
- [ ] Vercel `preview` uses stage token; Vercel `production` uses prod token.
- [ ] GitHub build secret uses stage token regardless of branch.
- [ ] Terraform validate passes for affected stacks.

## Possible solution(s)

1. Add Strapi bootstrap logic in `apps/cms/src/index.ts` using Strapi admin api-token service.
2. Add SSM parameters for internal API token in `infra/aws/modules/cms/main.tf` and inject into ECS container secrets.
3. Read stage/prod token parameters in `infra/vercel/data.tf` and set Vercel project env vars in `infra/vercel/main.tf`.
4. Read stage token in `infra/github/data.tf` and expose as a GitHub Actions secret in `infra/github/actions.tf`.

## References

- Request: internal token bootstrap + stage/prod routing
- Related infra files: `infra/aws/modules/cms/main.tf`, `infra/vercel/*`, `infra/github/*`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
