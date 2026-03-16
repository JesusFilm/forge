---
artifactType: issue
issueNumber: 396
issueTitle: "feat(cms): add SES email provider for forge.jesusfilm.org"
issueUrl: "https://github.com/JesusFilm/forge/issues/396"
state: "CLOSED"
closedAt: "2026-03-12T01:14:48Z"
labels: ["cms", "feat"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #396

## Background

Strapi CMS currently has no production email provider configured. It falls back to the default `sendmail` provider which won't work in Fargate. Email is needed for user management flows (password reset, email confirmation) and future notification features.

## Expected outcome

CMS can send transactional emails from `noreply@forge.jesusfilm.org` via AWS SES, using the ECS task role (no static credentials).

## Acceptance criteria

- [ ] SES domain identity verified for `forge.jesusfilm.org` with DKIM DNS records
- [ ] ECS task role has `ses:SendEmail` and `ses:SendRawEmail` permissions
- [ ] Custom Strapi email provider using `@aws-sdk/client-sesv2` (supports IAM task role)
- [ ] Email plugin configured in `config/plugins.ts` (SES in production, sendmail fallback for local dev)
- [ ] `EMAIL_DEFAULT_FROM` and `EMAIL_DEFAULT_REPLY_TO` env vars in ECS task definition
- [ ] `.env.example` updated with new email env vars

## Possible solution(s)

1. **Custom provider over official `@strapi/provider-email-amazon-ses`** — the official package uses deprecated `node-ses` and doesn't support ECS task roles (strapi/strapi#22600). A lightweight custom provider using `@aws-sdk/client-sesv2` respects the default credential chain (task role).

2. SES domain identity + DKIM in Terraform (CMS module), gated to prod-only creation (stage shares the zone/identity).

## References

- strapi/strapi#22600 — official SES provider doesn't support task roles
- Existing S3 upload uses task role pattern (no explicit creds in ECS)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
