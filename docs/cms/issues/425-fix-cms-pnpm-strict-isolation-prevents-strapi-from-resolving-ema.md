---
artifactType: issue
issueNumber: 425
issueTitle: "fix(cms): pnpm strict isolation prevents Strapi from resolving email provider"
issueUrl: "https://github.com/JesusFilm/forge/issues/425"
state: "CLOSED"
closedAt: "2026-03-12T03:12:45Z"
labels: ["fix", "cms"]
linkedPrs: []
scope: "cms"
---

# Issue Artifact: #425

## Background

Follow-up from #411 and #415. The Dockerfile now copies the provider `package.json` before install (#411) and uses `link:` instead of `file:` (#415). However, Strapi's `@strapi/email` plugin dynamically `require()`s the configured provider name from its own package context deep inside `.pnpm/`. In pnpm's strict `node_modules` layout, the resolution walks up from:

```
/workspace/node_modules/.pnpm/@strapi+email@5.36.0_.../node_modules/@strapi/email/dist/server/bootstrap.js
```

…and never reaches a `node_modules/` directory that contains `strapi-provider-email-ses`. The `link:` symlink is only visible to the CMS workspace package, not to `@strapi/email`.

**Runtime error:**

```
Error: Cannot find module 'strapi-provider-email-ses'
```

## Expected outcome

Strapi resolves `strapi-provider-email-ses` at runtime in the Docker container.

## Acceptance criteria

- [ ] Create `.npmrc` with `public-hoist-pattern` that hoists Strapi provider to root `node_modules/`
- [ ] Regenerate `pnpm-lock.yaml`
- [ ] Provider resolves at runtime from `@strapi/email`'s context

## Possible solution(s)

1. Add `.npmrc` with `public-hoist-pattern[]=strapi-provider-*` — hoists the provider to `/workspace/node_modules/` which is in the Node resolution path from any nested `.pnpm/` package.

## References

- #411, #415 — prior fixes
- `apps/cms/config/plugins.ts` line 67 — provider config
- `apps/cms/Dockerfile`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
