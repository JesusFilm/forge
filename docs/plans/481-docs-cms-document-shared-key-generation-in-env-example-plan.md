---
artifactType: plan
sourceIssueNumber: 481
sourceIssueTitle: "docs(cms): document shared key generation in env example"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/481"
linkedPrs: []
---

# Plan Artifact: #481

## Objective

`apps/cms/.env.example` includes clear inline guidance for generating each shared key.

## Planned approach

1. Add per-variable comments with `openssl rand` commands for secrets and salts.
2. Add a short note for keys sourced externally (e.g. internal API token).

## Validation

- [ ] Each shared key in `apps/cms/.env.example` has a generation command or source note.
- [ ] Notes are concise and safe for local/dev setup.

## Source links

- Issue: [#481](https://github.com/JesusFilm/forge/issues/481)
- PRs:
- None
