---
artifactType: plan
sourceIssueNumber: 271
sourceIssueTitle: "fix(infra): ECS CMS task health check failing"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/271"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: #271

## Objective

ECS marks the CMS container healthy and the service stabilizes.

## Planned approach

1. Change health check URL from `http://localhost:1337/_health` to `http://0.0.0.0:1337/_health` in the ECS task definition.
2. If still failing: try `http://127.0.0.1:1337/_health` (avoid IPv6 localhost), or replace `wget` with a probe that exists in the image (e.g. `curl` or Node one-liner).

## Validation

- [ ] Container health check in `infra/aws/modules/cms` uses a URL that succeeds when Strapi is listening on 0.0.0.0:1337
- [ ] No workflow or contract changes; infra/Terraform only

## Source links

- Issue: [#271](https://github.com/JesusFilm/forge/issues/271)
- PRs:
- None
