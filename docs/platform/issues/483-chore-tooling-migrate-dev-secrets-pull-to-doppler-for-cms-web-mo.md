---
artifactType: issue
issueNumber: 483
issueTitle: "chore(tooling): migrate dev secrets pull to Doppler for cms web mobile"
issueUrl: "https://github.com/JesusFilm/forge/issues/483"
state: "CLOSED"
closedAt: "2026-03-16T03:37:14Z"
labels: ["chore", "tooling"]
linkedPrs: []
scope: "platform"
---

# Issue Artifact: #483

## Background

Secret retrieval should move to Doppler so each app pulls its own dev config into a local `.env` file.

## Expected outcome

Developers can run one command per app to sync dev secrets from Doppler into `apps/<app>/.env` for CMS, Web, and Mobile.

## Acceptance criteria

- [ ] `apps/cms` has a script to pull `forge-cms` `dev` config into `.env`
- [ ] `apps/web` has a script to pull `forge-web` `dev` config into `.env`
- [ ] `apps/mobile` has a script to pull `forge-mobile` `dev` config into `.env`
- [ ] Env example/docs mention Doppler pull flow

## Possible solution(s)

1. Add per-app package scripts that call `doppler secrets download` with project/config and redirect to `.env`.
2. Optionally add repo-level convenience wrappers.

## References

- PR #482
- Issue #481

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
