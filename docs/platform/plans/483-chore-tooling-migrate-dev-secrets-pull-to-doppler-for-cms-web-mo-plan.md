---
artifactType: plan
sourceId: 483
sourceTitle: "chore(tooling): migrate dev secrets pull to Doppler for cms web mobile"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "chore(tooling): migrate dev secrets pull to Doppler for cms web mobile"

## Objective

Developers can run one command per app to sync dev secrets from Doppler into `apps/<app>/.env` for CMS, Web, and Mobile.

## Planned approach

1. Add per-app package scripts that call `doppler secrets download` with project/config and redirect to `.env`.
2. Optionally add repo-level convenience wrappers.

## Validation

- [ ] `apps/cms` has a script to pull `forge-cms` `dev` config into `.env`
- [ ] `apps/web` has a script to pull `forge-web` `dev` config into `.env`
- [ ] `apps/mobile` has a script to pull `forge-mobile` `dev` config into `.env`
- [ ] Env example/docs mention Doppler pull flow

## References

- PR #482
- Issue #481

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
