---
artifactType: issue
issueNumber: 481
issueTitle: "docs(cms): document shared key generation in env example"
issueUrl: "https://github.com/JesusFilm/forge/issues/481"
state: "CLOSED"
closedAt: "2026-03-16T03:28:17Z"
labels: ["cms", "docs"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #481

## Background

The CMS env example lists shared secrets but does not explain how to generate each value.

## Expected outcome

`apps/cms/.env.example` includes clear inline guidance for generating each shared key.

## Acceptance criteria

- [ ] Each shared key in `apps/cms/.env.example` has a generation command or source note.
- [ ] Notes are concise and safe for local/dev setup.

## Possible solution(s)

1. Add per-variable comments with `openssl rand` commands for secrets and salts.
2. Add a short note for keys sourced externally (e.g. internal API token).

## References

- Existing `apps/cms/.env.example`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
