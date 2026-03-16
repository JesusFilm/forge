---
artifactType: issue
issueNumber: 469
issueTitle: "feat(cms): migrate cms infrastructure to railway"
issueUrl: "https://github.com/JesusFilm/forge/issues/469"
state: "CLOSED"
closedAt: "2026-03-15T23:00:53Z"
labels: ["cms", "feat"]
linkedPrs: []
---

# Issue Artifact: #469

## Background

Current CMS infra is AWS/Terraform/ECS-centric and we are intentionally moving away from that stack.

## Expected outcome

CMS runs on Railway (app + postgres + object storage + email integration) and legacy CMS AWS infra paths are removed.

## Acceptance criteria

- [ ] CMS deploys from GitHub Actions to Railway for stage/main
- [ ] CMS storage/email use Railway S3-compatible storage and Resend
- [ ] CMS no longer depends on AWS SSM secret bootstrap flow
- [ ] Repository no longer contains legacy `infra/` folder

## Possible solution(s)

1. Replace CMS plugin/provider config with Railway S3-compatible and Resend providers.
2. Replace ECS/ECR deploy workflow with Railway deploy workflow.
3. Remove legacy infra/workflow references and docs after cutover validation.

## References

- Railway migration plan in current session
- Related issue #467

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
