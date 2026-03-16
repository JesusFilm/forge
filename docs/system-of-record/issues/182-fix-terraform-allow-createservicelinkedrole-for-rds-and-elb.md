---
artifactType: issue
issueNumber: 182
issueTitle: "fix(terraform): allow CreateServiceLinkedRole for RDS and ELB"
issueUrl: "https://github.com/JesusFilm/forge/issues/182"
state: "CLOSED"
closedAt: "2026-03-04T00:44:56Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #182

## Background

Terraform apply (aws/prod) fails because the apply role policy does not allow `iam:CreateServiceLinkedRole`. RDS and ELB creation require this when their service-linked roles do not exist yet.

- RDS: "Verify that you have permission to create service linked role"
- ELB: "not authorized to perform: iam:CreateServiceLinkedRole on resource: arn:aws:iam::...:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing"

## Expected outcome

Apply role can create AWS service-linked roles (e.g. for RDS, Elastic Load Balancing) so terraform apply succeeds.

## Acceptance criteria

- [ ] Apply role policy allows `iam:CreateServiceLinkedRole` on service-linked role ARNs
- [ ] Terraform apply (aws/prod) can create RDS and ALB when SLRs are missing
- [ ] No new permissions for IAM users/groups or non-forge resources

## Possible solution(s)

1. Add a statement to `github_actions_terraform_apply` policy: allow `iam:CreateServiceLinkedRole` with resource `arn:aws:iam::*:role/aws-service-role/*` (scoped to SLRs only).

## References

- Run: https://github.com/JesusFilm/forge/actions/runs/22648896805
- Apply role policy: `infra/aws/github/terraform.tf`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
