---
artifactType: plan
sourceId: 396
sourceTitle: "feat(cms): add SES email provider for forge.jesusfilm.org"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "feat(cms): add SES email provider for forge.jesusfilm.org"

## Objective

CMS can send transactional emails from `noreply@forge.jesusfilm.org` via AWS SES, using the ECS task role (no static credentials).

## Planned approach

1. **Custom provider over official `@strapi/provider-email-amazon-ses`** — the official package uses deprecated `node-ses` and doesn't support ECS task roles (strapi/strapi#22600). A lightweight custom provider using `@aws-sdk/client-sesv2` respects the default credential chain (task role).

2. SES domain identity + DKIM in Terraform (CMS module), gated to prod-only creation (stage shares the zone/identity).

## Validation

- [ ] SES domain identity verified for `forge.jesusfilm.org` with DKIM DNS records
- [ ] ECS task role has `ses:SendEmail` and `ses:SendRawEmail` permissions
- [ ] Custom Strapi email provider using `@aws-sdk/client-sesv2` (supports IAM task role)
- [ ] Email plugin configured in `config/plugins.ts` (SES in production, sendmail fallback for local dev)
- [ ] `EMAIL_DEFAULT_FROM` and `EMAIL_DEFAULT_REPLY_TO` env vars in ECS task definition
- [ ] `.env.example` updated with new email env vars

## References

- strapi/strapi#22600 — official SES provider doesn't support task roles
- Existing S3 upload uses task role pattern (no explicit creds in ECS)

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
