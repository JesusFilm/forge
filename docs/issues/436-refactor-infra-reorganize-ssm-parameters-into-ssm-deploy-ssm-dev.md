---
artifactType: issue
issueNumber: 436
issueTitle: "refactor(infra): reorganize SSM parameters into ssm_deploy/ssm_dev per module"
issueUrl: "https://github.com/JesusFilm/forge/issues/436"
state: "CLOSED"
closedAt: "2026-03-13T00:59:43Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #436

## Background

The CMS module's `main.tf` contained all SSM parameter definitions (deploy + dev secrets, KMS keys, ephemeral passwords) mixed with ECS/RDS/IAM resources, making it hard to see which secrets exist and where they belong. The web module's dev SSM lived in `platform/web_dev_ssm.tf` with no clear ownership.

## Expected outcome

- CMS SSM split into `ssm_deploy.tf` (deploy-time secrets) and `ssm_dev.tf` (developer secrets)
- Web extracted into its own module (`infra/aws/modules/web/`) with matching `ssm_deploy.tf` / `ssm_dev.tf`
- Shared secrets (PREVIEW_SECRET, STRAPI_INTERNAL_API_TOKEN) generated in CMS and referenced by web
- STRAPI_REVALIDATE_TOKEN dropped (not yet needed)
- STRAPI_PREVIEW_TOKEN renamed to PREVIEW_SECRET (CMS) / STRAPI_PREVIEW_SECRET (web) to match Strapi 5 docs

## Acceptance criteria

- [x] CMS `main.tf` contains no SSM/KMS/ephemeral resources
- [x] CMS `ssm_deploy.tf` has deploy KMS key + all deploy SSM params
- [x] CMS `ssm_dev.tf` has dev KMS alias + all dev SSM params including STRAPI_INTERNAL_API_TOKEN and PREVIEW_SECRET
- [x] Web module exists at `infra/aws/modules/web/` with own KMS key
- [x] Web `ssm_dev.tf` has only NEXT_PUBLIC_GRAPHQL_URL (pointing to localhost)
- [x] Preview route uses `?secret=` param matching Strapi 5 convention
- [x] Revalidate route and all STRAPI_REVALIDATE_TOKEN references removed
- [x] .env.example files updated

## Possible solution(s)

Not provided in source issue.

## References

- Strapi 5 Preview docs: https://docs-next.strapi.io/user-docs/content-manager/previewing-content
- Related: #67 (cms-deploy), #68 (web-deploy)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
