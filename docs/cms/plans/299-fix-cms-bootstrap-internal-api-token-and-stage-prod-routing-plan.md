---
artifactType: plan
sourceIssueNumber: 299
sourceIssueTitle: "fix(cms): bootstrap internal api token and stage/prod routing"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/299"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #299

## Objective

CMS bootstraps a read-only internal token from env (create if missing, rotate when changed), and infra routes token values by environment exactly as requested.

## Planned approach

1. Add Strapi bootstrap logic in `apps/cms/src/index.ts` using Strapi admin api-token service.
2. Add SSM parameters for internal API token in `infra/aws/modules/cms/main.tf` and inject into ECS container secrets.
3. Read stage/prod token parameters in `infra/vercel/data.tf` and set Vercel project env vars in `infra/vercel/main.tf`.
4. Read stage token in `infra/github/data.tf` and expose as a GitHub Actions secret in `infra/github/actions.tf`.

## Validation

- [ ] On CMS startup, if `STRAPI_INTERNAL_API_TOKEN` exists, Strapi ensures a read-only API token exists.
- [ ] Existing token is rotated/updated to env value when mismatched.
- [ ] CMS ECS task injects `STRAPI_INTERNAL_API_TOKEN` from SSM.
- [ ] Vercel `preview` uses stage token; Vercel `production` uses prod token.
- [ ] GitHub build secret uses stage token regardless of branch.
- [ ] Terraform validate passes for affected stacks.

## Source links

- Issue: [#299](https://github.com/JesusFilm/forge/issues/299)
- PRs:
- None
