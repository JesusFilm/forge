---
artifactType: plan
sourceIssueNumber: 483
sourceIssueTitle: "chore(tooling): migrate dev secrets pull to Doppler for cms web mobile"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/483"
linkedPrs: []
---

# Plan Artifact: #483

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

## Source links

- Issue: [#483](https://github.com/JesusFilm/forge/issues/483)
- PRs:
- None
