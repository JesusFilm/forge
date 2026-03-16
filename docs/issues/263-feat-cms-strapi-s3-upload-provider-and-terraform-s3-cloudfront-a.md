---
artifactType: issue
issueNumber: 263
issueTitle: "feat(cms): Strapi S3 upload provider and Terraform S3/CloudFront assets"
issueUrl: "https://github.com/JesusFilm/forge/issues/263"
state: "CLOSED"
closedAt: "2026-03-06T11:14:21Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #263

## Background

CMS media should be stored in S3 and served via CloudFront instead of local disk. Need official Strapi S3 upload provider, Terraform wiring for existing assets module, and doc-compliant setup (IAM, CORS, CSP).

## Expected outcome

- Strapi Media Library uses S3 for uploads (path prefix `/cms/` in bucket).
- Assets served via existing CloudFront custom domain; no long-lived AWS keys (ECS task role).
- Strapi admin can display thumbnails (CORS, security middleware per Strapi S3 docs).

## Acceptance criteria

- [ ] `@strapi/provider-upload-aws-s3` installed and configured (plugins.ts); credentials optional for ECS task role.
- [ ] Terraform: CMS task receives AWS_BUCKET, CDN_URL, CDN_ROOT_PATH; task role has s3:GetObject, PutObject, PutObjectAcl, DeleteObject on `cms/*` prefix.
- [ ] Terraform: assets module exposes cdn_url; S3 bucket CORS allows Strapi admin origin for thumbnails.
- [ ] Security middleware allows CDN_URL in img-src and media-src when set.
- [ ] No regression for local dev (no S3 when AWS_BUCKET unset).

## Possible solution(s)

1. Add provider dependency and conditional upload config; use env for baseUrl/rootPath; omit credentials when unset so SDK uses task role.
2. Terraform: assets output cdn_url; platform passes assets_cdn_url and assets_cdn_root_path ("cms") to CMS module; CMS env and IAM scoped to cms/\*.
3. S3 CORS for cms_admin_origin (https://ALB domain); middleware contentSecurityPolicy when CDN_URL set (per Strapi docs).

## References

- [Strapi Amazon S3 provider](https://docs.strapi.io/cms/configurations/media-library-providers/amazon-s3)
- `infra/aws/modules/assets`, `infra/aws/modules/cms`, `apps/cms/config/plugins.ts`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
