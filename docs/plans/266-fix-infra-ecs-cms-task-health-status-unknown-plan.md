---
artifactType: plan
sourceIssueNumber: 266
sourceIssueTitle: "fix(infra): ECS CMS task health status unknown"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/266"
linkedPrs: []
---

# Plan Artifact: #266

## Objective

ECS Tasks show Healthy/Unhealthy in the console after adding a container healthCheck to the CMS task definition.

## Planned approach

1. Add healthCheck to container_definitions in infra/aws/modules/cms/main.tf (wget or curl to http://localhost:1337/\_health). Chosen.
2. Rely only on ALB health check (no change to ECS UI; status stays Unknown).

## Validation

- [ ] CMS ECS task definition includes a container healthCheck (e.g. hit /\_health)
- [ ] New tasks report Healthy when /\_health succeeds

## Source links

- Issue: [#266](https://github.com/JesusFilm/forge/issues/266)
- PRs:
- None
