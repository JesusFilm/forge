---
artifactType: plan
sourceIssueNumber: 469
sourceIssueTitle: "feat(cms): migrate cms infrastructure to railway"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/469"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #469

## Objective

CMS runs on Railway (app + postgres + object storage + email integration) and legacy CMS AWS infra paths are removed.

## Planned approach

1. Replace CMS plugin/provider config with Railway S3-compatible and Resend providers.
2. Replace ECS/ECR deploy workflow with Railway deploy workflow.
3. Remove legacy infra/workflow references and docs after cutover validation.

## Validation

- [ ] CMS deploys from GitHub Actions to Railway for stage/main
- [ ] CMS storage/email use Railway S3-compatible storage and Resend
- [ ] CMS no longer depends on AWS SSM secret bootstrap flow
- [ ] Repository no longer contains legacy `infra/` folder

## Source links

- Issue: [#469](https://github.com/JesusFilm/forge/issues/469)
- PRs:
- None
