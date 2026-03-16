---
artifactType: issue
issueNumber: 184
issueTitle: "fix(infra): RDS postgres 16.4 invalid — use supported version"
issueUrl: "https://github.com/JesusFilm/forge/issues/184"
state: "CLOSED"
closedAt: "2026-03-04T00:55:55Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #184

## Background

Terraform apply fails: `InvalidParameterCombination: Cannot find version 16.4 for postgres`. RDS does not offer 16.4; current supported minor for PG 16 is 16.8.

## Expected outcome

RDS CMS DB creates successfully with a supported PostgreSQL engine version.

## Acceptance criteria

- [x] `db_engine_version` default is an RDS-supported PostgreSQL 16 minor (e.g. 16.8)
- [ ] `terraform plan` / `apply` for platform prod no longer errors on CreateDBInstance

## Possible solution(s)

1. Update default in `infra/aws/modules/cms/variables.tf` from `16.4` to `16.8` (or omit minor to use RDS default for 16).

## References

- [RDS PostgreSQL versions](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html)
- Error: `modules/cms/main.tf` line 187, `aws_db_instance.cms`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
