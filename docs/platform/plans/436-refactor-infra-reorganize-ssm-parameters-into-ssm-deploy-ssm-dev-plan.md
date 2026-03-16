---
artifactType: plan
sourceIssueNumber: 436
sourceIssueTitle: "refactor(infra): reorganize SSM parameters into ssm_deploy/ssm_dev per module"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/436"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #436

## Objective

- CMS SSM split into `ssm_deploy.tf` (deploy-time secrets) and `ssm_dev.tf` (developer secrets)
- Web extracted into its own module (`infra/aws/modules/web/`) with matching `ssm_deploy.tf` / `ssm_dev.tf`
- Shared secrets (PREVIEW_SECRET, STRAPI_INTERNAL_API_TOKEN) generated in CMS and referenced by web
- STRAPI_REVALIDATE_TOKEN dropped (not yet needed)
- STRAPI_PREVIEW_TOKEN renamed to PREVIEW_SECRET (CMS) / STRAPI_PREVIEW_SECRET (web) to match Strapi 5 docs

## Planned approach

Not provided in source issue.

## Validation

- [x] CMS `main.tf` contains no SSM/KMS/ephemeral resources
- [x] CMS `ssm_deploy.tf` has deploy KMS key + all deploy SSM params
- [x] CMS `ssm_dev.tf` has dev KMS alias + all dev SSM params including STRAPI_INTERNAL_API_TOKEN and PREVIEW_SECRET
- [x] Web module exists at `infra/aws/modules/web/` with own KMS key
- [x] Web `ssm_dev.tf` has only NEXT_PUBLIC_GRAPHQL_URL (pointing to localhost)
- [x] Preview route uses `?secret=` param matching Strapi 5 convention
- [x] Revalidate route and all STRAPI_REVALIDATE_TOKEN references removed
- [x] .env.example files updated

## Source links

- Issue: [#436](https://github.com/JesusFilm/forge/issues/436)
- PRs:
- None
