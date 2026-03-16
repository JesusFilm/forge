---
artifactType: plan
sourceIssueNumber: 447
sourceIssueTitle: "fix(cms): SES email provider export incompatible with Strapi require()"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/447"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: #447

## Objective

CMS starts successfully with the SES email provider loaded.

## Planned approach

1. Change `export default { init }` to named export pattern so CJS `require()` sees `exports.init`

## Validation

- [ ] Provider exports `init` as a named export so `require()` returns `{ init }`
- [ ] CMS deploy succeeds

## Source links

- Issue: [#447](https://github.com/JesusFilm/forge/issues/447)
- PRs:
- None
