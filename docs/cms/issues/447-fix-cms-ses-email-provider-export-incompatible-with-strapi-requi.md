---
artifactType: issue
issueNumber: 447
issueTitle: "fix(cms): SES email provider export incompatible with Strapi require()"
issueUrl: "https://github.com/JesusFilm/forge/issues/447"
state: "CLOSED"
closedAt: "2026-03-13T01:32:43Z"
labels: ["fix", "cms"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #447

## Background

The CMS deploy is failing on main with `provider.init is not a function` during Strapi bootstrap. The SES email provider uses `export default { init }` which compiles to CJS `exports.default = { init }`. Strapi's email plugin does `require(path)` and calls `.init()` directly on the module, expecting a top-level `init` export.

## Expected outcome

CMS starts successfully with the SES email provider loaded.

## Acceptance criteria

- [ ] Provider exports `init` as a named export so `require()` returns `{ init }`
- [ ] CMS deploy succeeds

## Possible solution(s)

1. Change `export default { init }` to named export pattern so CJS `require()` sees `exports.init`

## References

- Failed action: https://github.com/JesusFilm/forge/actions/runs/22985058899/job/66733559575
- Strapi bootstrap source: `@strapi/email/dist/server/bootstrap.js` line 25

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
