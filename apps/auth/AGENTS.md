# apps/auth Agent Guide

Full context lives in `apps/auth/CLAUDE.md`. Keep both files aligned.

## Core model

- Standalone Jesus Film Auth authority.
- Owns identity, global membership, app registrations, app-level scopes/grants,
  OAuth/OIDC provider behavior, tokens, audit, and revocation.
- `apps/admin` is the first relying client and must not depend on shared
  `.jesusfilm.org` cookies.
- Deployed as its own Railway service at `auth.jesusfilm.org`.

## Boundaries

- Do not import from `apps/admin`, `apps/web`, `apps/manager`, or other app
  contexts.
- Do not log raw passwords, bearer tokens, refresh tokens, client secrets, or
  unnecessary PII.
- Public signup is allowed for new viewer accounts, but do not let existing
  Auth or legacy Firebase emails create duplicate password accounts.
- Do not make Auth own app-specific domain authorization; apps keep ABAC and
  local permission rules.

## Validation

- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`

## Agent Login

- Agent handles are Auth-owned, short-lived bearer credentials shaped like
  email addresses for local/preview browser testing.
- Do not add app-local auth bypasses in relying apps when this flow applies.
- The mint helper prints the generated handle once for immediate browser use;
  never commit it, pipe it into durable logs, or paste it into issue/PR text.
- Never log raw `AGENT_LOGIN_MINTING_KEY` values.
