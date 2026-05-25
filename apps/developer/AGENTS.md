# apps/developer Agent Guide

Full context lives in `apps/developer/CLAUDE.md`. Keep both files aligned.

## Core model

- Standalone developer portal intended for `developer.jesusfilm.org`.
- Operational UI for Auth-owned app registrations, OAuth clients,
  environments, redirect URIs, scopes, and approval posture.
- Auth remains the identity/OAuth authority and owns credential issuance,
  revocation, token policy, grants, and audit events.

## Boundaries

- Do not import runtime code from `apps/auth`.
- Do not duplicate Auth OAuth provider behavior in this app.
- Do not expose raw client secrets, bearer tokens, refresh tokens, or database
  URLs.
- Do not touch `apps/cms` or Strapi authentication from this app.
- Keep direct Auth database access read-only until an Auth-owned management API
  or shared registry package exists.

## Validation

- `pnpm --filter @forge/developer test`
- `pnpm --filter @forge/developer typecheck`
- `pnpm --filter @forge/developer lint`
