---
artifactType: issue
issueNumber: 271
issueTitle: "fix(infra): ECS CMS task health check failing"
issueUrl: "https://github.com/JesusFilm/forge/issues/271"
state: "CLOSED"
closedAt: "2026-03-06T11:52:04Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #271

## Background

CMS ECS task is failing the container health check. The check uses `wget ... http://localhost:1337/_health` inside the container while the app is configured with `HOST=0.0.0.0`; using `0.0.0.0` in the health check URL may resolve the failure.

## Expected outcome

ECS marks the CMS container healthy and the service stabilizes.

## Acceptance criteria

- [ ] Container health check in `infra/aws/modules/cms` uses a URL that succeeds when Strapi is listening on 0.0.0.0:1337
- [ ] No workflow or contract changes; infra/Terraform only

## Possible solution(s)

1. Change health check URL from `http://localhost:1337/_health` to `http://0.0.0.0:1337/_health` in the ECS task definition.
2. If still failing: try `http://127.0.0.1:1337/_health` (avoid IPv6 localhost), or replace `wget` with a probe that exists in the image (e.g. `curl` or Node one-liner).

## References

- `infra/aws/modules/cms/main.tf` — `aws_ecs_task_definition.cms` container_definitions healthCheck

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
