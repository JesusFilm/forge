---
artifactType: plan
sourceId: 469
sourceTitle: "feat(cms): migrate cms infrastructure to railway"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "feat(cms): migrate cms infrastructure to railway"

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

## References

- Railway migration plan in current session
- Related issue #467

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
