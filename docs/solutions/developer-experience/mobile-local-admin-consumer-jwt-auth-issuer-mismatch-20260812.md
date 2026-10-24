---
module: apps/admin
date: "2026-08-12"
problem_type: developer_experience
component: authentication
severity: medium
applies_when:
  - "Testing a signed-in mobile (or any consumer) flow locally against local admin + local auth"
  - "A mobile dev build points at local admin :3003 (feat-339) and signs in via local auth :3004"
  - "Watch progress (or any user-scoped GraphQL op) fails to persist across sign-out/sign-in in local dev"
  - "Seeing 'Not authorized to resolve Query/Mutation.*' from local admin despite a valid local sign-in"
symptoms:
  - "myWatchProgress / upsertMyWatchProgress return 'Not authorized' from local admin :3003"
  - "Progress bars show in-session (local optimistic store) but vanish after sign-out then sign-in"
  - "The mobile app DID mint a JWT (GET localhost:3004/api/auth/token 200) but admin still rejects the op"
  - "A /api/graphql POST carrying a user-scoped op returns an authorization error, not 200"
related_components:
  - authentication
  - development_workflow
tags:
  - admin
  - mobile
  - local-dev
  - auth-issuer
  - jwks
  - consumer-jwt
  - watch-progress
  - feat-339
---

# Local admin can't validate a local-auth consumer JWT — point AUTH_ISSUER_URL at local auth

## Context

A fully-local signed-in mobile flow has THREE pieces that must share one trust domain:

1. **Content + user data** — the mobile dev build points at **local admin** `:3003` (feat-339: a dev bundle defaults to `http://localhost:3003/api/graphql` and refuses prod).
2. **The session** — the mobile app signs in against **local auth** `:3004` (`EXPO_PUBLIC_AUTH_BASE_URL=http://localhost:3004`) and mints a user JWT there.
3. **Authorization** — for user-scoped operations (watch progress: `myWatchProgress` / `upsertMyWatchProgress`), local admin must **validate that JWT** and populate `ctx.user`.

Piece 3 is the trap. `apps/admin` validates a consumer user JWT with `jose` (`createRemoteJWKSet` + `jwtVerify`) against a JWKS fetched from **`AUTH_ISSUER_URL`**. Admin's `.env` default is:

```
AUTH_ISSUER_URL="https://auth.jesusfilm.org/api/auth"
```

i.e. **production** auth. This default is deliberate — per admin's CLAUDE.md, "for local development, admin points at production Auth so engineers do not need to run `apps/auth` locally." But when you DO run local auth for a mobile flow, admin fetches **prod's** JWKS and cannot verify a token signed by **local** auth's keys. So `ctx.user` is `null`, the Pothos scope check (`hasPermission: "read:watch-progress:own"`) fails, and the resolver returns:

```
Not authorized to resolve Query.myWatchProgress
Not authorized to resolve Mutation.upsertMyWatchProgress
```

## Why This Matters

The failure is **silent and misleading**, and it wastes debugging time on the wrong app:

- **The mobile app is correct.** It mints the JWT (`GET localhost:3004/api/auth/token` → 200) and attaches it to exactly the two progress operations (op-scoped, `PROGRESS_OPERATION_NAMES`). Nothing in the mobile PR needs to change.
- **Fail-open hides it.** The progress sync is fail-open by design (a blip must never blank the bars): a rejected write is silently queued, a failed read returns empty. So in-session bars still show — they come from the **local optimistic store**, not the server — and only DISAPPEAR after sign-out (which clears local state) then sign-in (whose server read returns nothing, because the write never persisted). That "watched → saved → logged out → logged back in → gone" symptom looks like a mobile bug but is an admin↔auth wiring gap.
- **Production is unaffected.** In prod, mobile uses prod auth + prod admin — one trust domain — so the JWT validates and progress round-trips. This is a LOCAL-DEV-only mismatch.

## The Fix

Point local admin's user-token validation at local auth. Add to **`apps/admin/.env.local`** (overrides `.env`; gitignored, never committed):

```
AUTH_ISSUER_URL=http://localhost:3004/api/auth
```

Then **restart the admin dev server** on `:3003`. Next.js dev does NOT reliably auto-restart on a `.env.local` change (the `next-server` PID stayed the same in testing), and env is read once at module scope in `src/config/env.ts` — so restart manually (`Ctrl-C` + `pnpm --filter @forge/admin dev`).

Verify the prerequisites and the fix:

```bash
# Local auth exposes a JWKS admin can fetch (an Ed25519 key)
curl -s http://localhost:3004/api/auth/jwks
# Admin graphql healthy
curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3003/api/graphql \
  -H 'content-type: application/json' --data '{"query":"{__typename}"}'
```

After restart, reload the mobile app and watch Metro's log: the `myWatchProgress` read now returns `POST /api/graphql status:200` (was `Not authorized`), and playing a video produces no `Not authorized ... upsertMyWatchProgress` / `writes_not_applied`. Progress then survives re-login.

## The feat-339 documentation gap this closes

`apps/mobile/CLAUDE.md` (feat-339 "Admin endpoint resolution") documents step one — a dev bundle defaults to local admin and refuses prod. It does NOT mention that authenticated flows also need admin's `AUTH_ISSUER_URL` pointed at local auth. "Dev → local admin" is necessary but not sufficient for signed-in operations; this is the missing second wiring step.

## Caveat

`AUTH_ISSUER_URL` governs ALL of admin's user-token validation, so this repoints admin fully at local auth. That is correct for a coherent "everything local" setup, but the **admin dashboard** login locally will then also expect local auth. If you need the dashboard against prod, remove the `.env.local` line and restart admin.

## When to Apply

- You point a mobile (or other consumer) dev build at local admin + local auth and a signed-in feature "doesn't persist."
- You see `Not authorized to resolve Query.myWatchProgress` (or any `*:own` scoped op) from `localhost:3003` while the mobile app clearly signed in.
- You are about to "fix" a consumer feature in mobile code because progress vanishes on re-login — check the admin↔auth trust domain FIRST.

## Related

- [`docs/solutions/developer-experience/local-admin-dev-auth-flow-impractical-20260514.md`](./local-admin-dev-auth-flow-impractical-20260514.md) — Sibling: the admin DASHBOARD UI is impractical locally (proxy loop, credential leak). This doc is its consumer-JWT counterpart — same "admin looks broken when the app is fine" disorientation, different surface and fix.
- `apps/admin/CLAUDE.md` "Jesus Film Auth client mode" — documents the prod-default `AUTH_ISSUER_URL` and why (so engineers need not run apps/auth locally). This doc is the exception that default creates.
- `apps/mobile/CLAUDE.md` "Admin endpoint resolution (feat-339)" — the "dev → local admin" half; this doc adds the authenticated-flow half.
