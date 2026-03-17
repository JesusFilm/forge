---
artifactType: plan
sourceId: 447
sourceTitle: "fix(cms): SES email provider export incompatible with Strapi require()"
linkedPrs: []
scope: "cms"
---

# Plan Artifact: "fix(cms): SES email provider export incompatible with Strapi require()"

## Objective

CMS starts successfully with the SES email provider loaded.

## Planned approach

1. Change `export default { init }` to named export pattern so CJS `require()` sees `exports.init`

## Validation

- [ ] Provider exports `init` as a named export so `require()` returns `{ init }`
- [ ] CMS deploy succeeds

## References

- Failed action: https://github.com/JesusFilm/forge/actions/runs/22985058899/job/66733559575
- Strapi bootstrap source: `@strapi/email/dist/server/bootstrap.js` line 25

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
