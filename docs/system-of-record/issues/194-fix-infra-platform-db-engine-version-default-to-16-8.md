---
artifactType: issue
issueNumber: 194
issueTitle: "fix(infra): platform db_engine_version default to 16.8"
issueUrl: "https://github.com/JesusFilm/forge/issues/194"
state: "CLOSED"
closedAt: "2026-03-04T09:27:19Z"
labels: ["fix", "infra"]
linkedPrs: []
---

# Issue Artifact: #194

## Background

Platform module still had `db_engine_version` default `"16.4"`; RDS does not support 16.4. Should be 16.8.

## Expected outcome

`infra/aws/modules/platform/variables.tf` default for `db_engine_version` is `"16.8"`.

## Acceptance criteria

- [ ] Default is 16.8; terraform apply succeeds for prod CMS DB.

## Possible solution(s)

Not provided in source issue.

## References

Not provided in source issue.

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
