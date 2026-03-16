---
artifactType: plan
sourceIssueNumber: 263
sourceIssueTitle: "feat(cms): Strapi S3 upload provider and Terraform S3/CloudFront assets"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/263"
linkedPrs: []
---

# Plan Artifact: #263

## Objective

- Strapi Media Library uses S3 for uploads (path prefix `/cms/` in bucket).
- Assets served via existing CloudFront custom domain; no long-lived AWS keys (ECS task role).
- Strapi admin can display thumbnails (CORS, security middleware per Strapi S3 docs).

## Planned approach

1. Add provider dependency and conditional upload config; use env for baseUrl/rootPath; omit credentials when unset so SDK uses task role.
2. Terraform: assets output cdn_url; platform passes assets_cdn_url and assets_cdn_root_path ("cms") to CMS module; CMS env and IAM scoped to cms/\*.
3. S3 CORS for cms_admin_origin (https://ALB domain); middleware contentSecurityPolicy when CDN_URL set (per Strapi docs).

## Validation

- [ ] `@strapi/provider-upload-aws-s3` installed and configured (plugins.ts); credentials optional for ECS task role.
- [ ] Terraform: CMS task receives AWS_BUCKET, CDN_URL, CDN_ROOT_PATH; task role has s3:GetObject, PutObject, PutObjectAcl, DeleteObject on `cms/*` prefix.
- [ ] Terraform: assets module exposes cdn_url; S3 bucket CORS allows Strapi admin origin for thumbnails.
- [ ] Security middleware allows CDN_URL in img-src and media-src when set.
- [ ] No regression for local dev (no S3 when AWS_BUCKET unset).

## Source links

- Issue: [#263](https://github.com/JesusFilm/forge/issues/263)
- PRs:
- None
