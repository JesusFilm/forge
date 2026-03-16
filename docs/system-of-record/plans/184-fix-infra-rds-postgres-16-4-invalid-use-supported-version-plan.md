---
artifactType: plan
sourceIssueNumber: 184
sourceIssueTitle: "fix(infra): RDS postgres 16.4 invalid — use supported version"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/184"
linkedPrs: []
---

# Plan Artifact: #184

## Objective

RDS CMS DB creates successfully with a supported PostgreSQL engine version.

## Planned approach

1. Update default in `infra/aws/modules/cms/variables.tf` from `16.4` to `16.8` (or omit minor to use RDS default for 16).

## Validation

- [x] `db_engine_version` default is an RDS-supported PostgreSQL 16 minor (e.g. 16.8)
- [ ] `terraform plan` / `apply` for platform prod no longer errors on CreateDBInstance

## Source links

- Issue: [#184](https://github.com/JesusFilm/forge/issues/184)
- PRs:
- None
