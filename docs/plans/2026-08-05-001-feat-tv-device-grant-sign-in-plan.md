---
title: "feat: TV device-grant sign-in (auth server + TV client)"
type: feat
status: active
date: 2026-08-05
origin: docs/brainstorms/2026-07-29-tv-auth-releasable-requirements.md
---

# feat: TV device-grant sign-in (auth server + TV client)

## Overview

`apps/tv` ships a complete on-TV sign-in surface — QR, user code, profile screen — behind
`EXPO_PUBLIC_TV_PROFILE_ENABLED`, with the grant stubbed. Scanning the QR today lands on a 404:
`auth.jesusfilm.org` has no device-authorization endpoint. This plan builds the server half, wires
the TV client to it, and adds the two screens the app stores require.

| Surface      | Owns                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `apps/auth`  | device-code issuance + redemption, the `/device` approval page, the `tv` OAuth client, account deletion |
| `apps/tv`    | polling, secure token storage, refresh, sign-out, profile + delete affordance                           |
| `apps/admin` | nothing new — it must accept the TV token through **existing** introspection, unchanged                 |

**The decision this plan deliberately does not make:** how the grant mints tokens (§ Key Technical
Decisions D1). Both branches are specified and costed; every other unit is identical either way and
can start immediately.

## Problem Frame

Carried from the origin document (`docs/brainstorms/2026-07-29-tv-auth-releasable-requirements.md`):
PR #1785 shipped the scaffolding dark; viewers cannot actually sign in. R1–R8 and the success
criteria below are the origin's, verbatim in intent.

### Requirements trace

| Req | Requirement (origin)                                                                            | Units            |
| --- | ----------------------------------------------------------------------------------------------- | ---------------- |
| R1  | Sign in by scanning the on-screen QR / typing the short code. No credentials on the TV.         | U1.3, U2.1, U4.2 |
| R2  | Phone page is the existing Jesus Film sign-in, code pre-filled, new accounts in the same visit. | U2.2, U2.3       |
| R3  | TV lands on signed-in Profile within one polling interval, untouched.                           | U4.2, U4.7       |
| R4  | Session survives relaunch and reboot; living-room lifetimes (weeks).                            | U4.1, U4.3       |
| R5  | Sign out takes effect immediately on that device.                                               | U4.4             |
| R6  | Demo stub removed in the same change; expired codes surface a real state.                       | U4.5, U4.2       |
| R7  | Staged release: dark → TestFlight/internal → production.                                        | PR6              |
| R8  | No PII in telemetry after accounts exist.                                                       | U1.6, U4.8       |

### Success criteria (origin)

- An uncoached tester completes scan → approve → signed-in on real Apple TV **and** Android TV hardware.
- Session survives force-quit, relaunch, TV reboot.
- **Admin's introspection accepts the TV token, verified in logs with the TV client id** — the token is a
  first-class platform citizen, not a special case. _(This criterion is the strongest argument in the
  whole document for how D1 resolves — see D1.)_
- Datadog shows no PII in any RUM action name or log for the new surface.

## Scope Boundaries

Carried from the origin, **with one amendment**:

- No playlists, saved videos, notifications, parental controls, profile editing.
- No typed email/password on the TV.
- No end-user read path in admin GraphQL; profile data comes from the IdP userinfo endpoint.
- ~~No resume / continue-watching on TV in this slice.~~ **Amended 2026-08-05:** Continue Watching
  shipped anonymously in this branch (commits `cb7c6b6a` → `b3273558`). It is not new scope here, but
  it creates one obligation this plan must carry: the anonymous→signed-in merge (U4.6).
- **Added scope, not in the origin:** in-app account deletion (U3). It is a hard store requirement,
  not a nice-to-have — see D3.

## Context & Research

### Relevant code

**`apps/auth`** (all line numbers verified 2026-08-05):

- `src/auth/config.ts:113-181` — plugin array. `jwt()`, `agentLoginPlugin()`, `oauthProvider({…})`,
  `nextCookies()`. **No `deviceAuthorization()`.**
- `src/auth/config.ts:116-178` — full `oauthProvider` options: `accessTokenExpiresIn: 3600`,
  `codeExpiresIn: 600`, prefixes `jfp_at_`/`jfp_rt_`, `customAccessTokenClaims` binding audience +
  environment + app. `refreshTokenExpiresIn` **unset** → library default 30d. `rateLimit` **unset**.
- `src/domain/apps.ts:9-15, 432-439` — the six first-party app keys and `FIRST_PARTY_APP_SEEDS`.
- `src/scripts/seed-first-party-apps.ts:131-284` — upsert into `registeredApp` / `appEnvironment` /
  `oauthClient`; every first-party client is `public: true, requirePKCE: true,
grantTypes: ["authorization_code","refresh_token"]` (`:196`, `:217`).
- `src/services/app-registry.service.ts:31-51` — `validateAppEnvironmentPolicy` **throws on empty
  `redirectUris`/`allowedOrigins`**, exempting only `ADMIN_MCP_CODEX_CLIENT_ID`.
- `src/app/oauth/consent/consent-page-client.tsx:28-55` — the approve/deny analogue: no `<form>`, a
  `fetch("/api/auth/oauth2/consent")` + `resolveRedirectUrl`.
- `src/auth/web-callback.ts:8-20` — **filters the auth origin out of allowed callback origins**, so a
  `/device` continuation cannot ride `callbackURL`.
- `src/auth/rate-limit.ts` — Redis Lua `INCR`+`PEXPIRE` with in-process fallback; applied at exactly
  three intercepted paths in `src/app/api/auth/[...all]/route.ts`.
- `src/config/env.ts:11-66` — every var `.optional()`; production requirements enforced at runtime by
  `assertProductionAuthSecrets()` (`:133-144`).
- `prisma/schema.prisma` — `OauthClient:170`, `OauthRefreshToken:212`, `OauthAccessToken:236`,
  `TokenRecord:374` (note `tokenHash`). **No `deviceCode` model.** Migrations dir already has two
  `0002_` prefixes → this one is **`0003_`**.

**`apps/tv`** (already built, dark):

- `src/lib/auth/deviceAuthFlow.ts` — pure session/code model; both RFC 8628 code formats
  (`USER_CODE_SPECS`), `createPendingSession`, `isSessionExpired`.
- `src/lib/auth/userCodeFormatPreference.ts` — **pre-ship evaluation switch** (scaffolding, U4.5).
- `src/lib/auth/profileFlag.ts` + `profileFlagState.ts` — release gate. **KEEP.**
- `src/components/profile/ProfileScreen.tsx` — phases signedOut/pending/signedIn; `DEMO_PROFILE`
  stub + "Approve on this device (demo)" row (**scaffolding**, U4.5).
- `src/components/profile/SignInQr.tsx` — `qrcode-generator` + `<View>` grid (no `react-native-svg`).
- `src/lib/authHeaders.ts` — per-operation bearer allowlisting (U4.9 must extend, not widen).
- `src/lib/watchEvents/continueWatching.ts`, `watchEvents.ts` — the anonymous state U4.6 merges.

**`apps/admin`**: `src/auth/web-user-token.ts:18-70` — `resolveWebUserPrincipalFromToken` checks
`active`, `iss`, `client_id ∈ AUTH_WEB_USER_CLIENT_IDS` (`config/env.ts:198`), environment claim, and
requires scope `web:watch-events:write`. **The TV client id must be added to that CSV** (U1.2).

### Institutional learnings that bind this work

Each is load-bearing; the unit that must honour it is named.

| Learning                                                                                                                                   | Law                                                                                                                                                                                                                     | Binds                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-patterns/async-single-flight-slot-release-hazards.md`                                                                              | A shared in-flight promise releases from the **caller** side, identity-checked, on **both** settlement paths (`void flight.then(r, r)` — never `.finally`), with a joiner-side catch. Nothing before the guarded `try`. | **U4.3** — the refresh slot is exactly Shape B. A body-internal `finally` wedges the slot and signs the TV out until relaunch.                                                                                                                                                          |
| `database-issues/db-lock-must-be-atomic-update-not-select-for-update.md`                                                                   | Check-and-claim must be a single atomic `UPDATE`, never split read+write.                                                                                                                                               | **U1.4** — better-auth's own redemption is `findOne` → branch → `delete` (a TOCTOU; two polls can both mint).                                                                                                                                                                           |
| `architecture-patterns/fail-closed-enforcement-point-follows-rollback-capability.md`                                                       | The enforcement point follows **rollback capability**, not severity. Add the capability, observe it, _then_ move the point.                                                                                             | **U1.6, D5** — a boot throw over an optional new grant would 500 login for all six existing clients. Report-only at boot; enforce in the request path.                                                                                                                                  |
| `best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`                                                                      | Every typed-discriminator branch needs a test where **only** that branch matches; one fixture must use the real wire shape.                                                                                             | **U4.2** — `authorization_pending` / `slow_down` / `expired_token` / `access_denied` / `invalid_grant`. A "keep polling on unknown" fallback makes the `slow_down` branch deletable with no test going red.                                                                             |
| `workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`                                                           | Write the removal ticket in the same PR, with a binding KEEP-list, drift-resistant greps, a precondition-first step 0, and an operator-teardown category.                                                               | **U4.5** — two scaffolds (demo stub, code-format switch).                                                                                                                                                                                                                               |
| `runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`                                                         | Opt-in scaffolding env vars must be `.optional()`; move the precondition into the schema.                                                                                                                               | **U1.1, U4.1**                                                                                                                                                                                                                                                                          |
| `platform/admin-manager-enrichment-trigger-endpoint-20260506.md`                                                                           | Receiver deploys first; reverse order gives a dead window of 401s.                                                                                                                                                      | **PR6** — and worse than a dead minute: TV binaries ship via EAS/App Store and cannot roll back for weeks.                                                                                                                                                                              |
| `workflow-issues/deferred-verification-belongs-in-consuming-ticket-entry-conditions.md`                                                    | A deferred check is real only as an entry precondition on the **consuming** ticket.                                                                                                                                     | **PR1 DoD** must not claim hardware verification.                                                                                                                                                                                                                                       |
| `runtime-errors/tv-rctfatal-network-request-failed-admin-down-20260626.md`                                                                 | In dev, **any** unhandled rejection escalates to an all-native `RCTFatal` with no JS message.                                                                                                                           | **U4.2** — a poll every N seconds against a host that will be down in dev; every tick inside try/catch.                                                                                                                                                                                 |
| `ui-bugs/tvos-appstate-inactive-vs-background-video-teardown.md`                                                                           | Branch on `state === "background"`, never `!== "active"` — `"inactive"` is a foreground blip (Siri).                                                                                                                    | **U4.2** — a `!== "active"` test kills the poll on every Siri invocation and the code expires while the user watches the QR.                                                                                                                                                            |
| `logic-errors/liveness-watchdog-armed-on-success-and-unpaired-latch-heartbeat.md`                                                          | Extracting a pure module **relocates** risk to the untested arming seam. Full coverage on a pure module whose caller has none is a signal, not a reassurance.                                                           | **U4.2** — and `apps/tv` has **no renderer at all** (99 test files, all against React-free modules), so the StrictMode detector prescribed by the remount law _does not exist here_. Compensate with a pure state machine + an adversarial re-read of the wiring + real-hardware smoke. |
| `logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md`                                                                       | Setup must restore every ref cleanup mutates; async callbacks discard on their own `signal.aborted`.                                                                                                                    | **U4.2**                                                                                                                                                                                                                                                                                |
| `architecture-patterns/post-sign-out-force-login-marker-oidc-relying-apps.md`                                                              | Sign-out clears only the app-local session; pair with a force-login marker.                                                                                                                                             | **U2.4, U4.4** — two bites: TV sign-out must **revoke**, not just wipe; and the phone rides a rolling 7d SSO session, so a shared family phone silently approves as the previous user.                                                                                                  |
| `best-practices/watch-progress-history-user-isolation-pattern-20260702.md`                                                                 | Promotion of anonymous local state into a profile is an account-isolation boundary: current-local-user marker, never enumerate all buckets, server ignores mismatched user ids.                                         | **U4.6** — governs the Continue Watching / viewer-id merge.                                                                                                                                                                                                                             |
| `architecture-patterns/fleet-client-bearer-must-be-operation-scoped-not-global.md`                                                         | A baked-in fleet credential attaches only to gated operations — never globally on the HttpLink.                                                                                                                         | **U4.9** — the user token is a _different credential_ from `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`. Never merge.                                                                                                                                                                              |
| `security-issues/pre-verification-log-field-namespace-pollution-20260518.md`                                                               | Canonical log names (`userId=`) only **after** verification; pre-verification uses `attemptedX=`.                                                                                                                       | **U1.6**                                                                                                                                                                                                                                                                                |
| `runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`                                                                 | `JSON.stringify` payloads from App Router handlers are silently dropped; use `[label] event=… key=value`.                                                                                                               | **U1.6** — otherwise post-deploy validation looks like the endpoints were never hit.                                                                                                                                                                                                    |
| `runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md`                                                                    | `EXPO_PUBLIC_*` inlines reliably only at module scope — three edits in `apps/tv/src/env.ts`.                                                                                                                            | **U4.1** — omitting the `_inlined` line white-screens **only in EAS builds**.                                                                                                                                                                                                           |
| `architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md`                                                                | Store user-facing credentials as `sha256(raw)`, never plaintext at rest.                                                                                                                                                | **U1.4** — conflicts with better-auth's plaintext `deviceCode`/`userCode` schema; decide explicitly.                                                                                                                                                                                    |
| `tooling-decisions/codeql-insufficient-password-hash-false-positive-nonsecret-identifier.md`                                               | sha256 of a high-entropy token used as a deterministic lookup id is a **false positive**; dismiss via `gh api`, never "fix" with a KDF.                                                                                 | **U1.4** — predicts a CI failure; budget the dismissal or someone will break the lookup with bcrypt.                                                                                                                                                                                    |
| `auth/auth-owned-agent-login-handles-for-local-preview-oauth-20260611.md`                                                                  | Auth owns minting + redemption; short-lived single-use credentials claimed atomically, redeemed through a plugin using `internalAdapter`.                                                                               | **U1.3** — `src/auth/agent-login-plugin.ts` is the literal structural template, and it already solved the atomic claim better-auth gets wrong.                                                                                                                                          |
| `architecture-patterns/hardened-oidc-id-token-verify-jose-jwks-20260702.md`                                                                | Verify the id_token only; derive `algorithms` from the published JWKS; never hardcode.                                                                                                                                  | **U4.7** — a hardcoded alg pin silently breaks every TV after key rotation, with no console on a TV to diagnose it.                                                                                                                                                                     |
| `best-practices/react-native-tvos-porting-pitfalls-20260414.md`, `ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md` | `react-native-svg` banned in `apps/tv`; all dp through `scale()`.                                                                                                                                                       | **U5** — an unscaled QR renders half-size and unscannable from a couch on Android TV.                                                                                                                                                                                                   |
| `workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`                                                                  | Tier-2 review mandatory for auth, migrations, secrets; P2+ at confidence ≥75 defaults to Apply.                                                                                                                         | **All PRs** — this feature fires three triggers at once.                                                                                                                                                                                                                                |

### External research

`research/2026-08-05-tv-sign-in-ux-research.md` (26 agents, every load-bearing claim independently
fact-checked). Conclusions carried into this plan:

- The QR + user-code shape is correct and industry-standard; **the code display is a spec MUST**
  (RFC 8628 §3.3.1), an anti-phishing control, and must not be "simplified" to QR-only.
- Apple guideline 5.1.1(v) fires on _supports_ account creation → in-app deletion required (D3).
- Guideline 4.8 does **not** require Sign in with Apple (own account system carve-out) — but attaches
  indirectly if the phone approval page renders a Google/Facebook button.
- Route C is dead, **for a corrected reason**: `ASWebAuthenticationSession` carries a real
  `tvos(16.0)` annotation but is empirically inert (`canStart`/`start` return false on tvOS 26.5;
  identical iOS code works). The ticket's current "no WebKit" phrasing is challengeable.
- Expiry 15 min **with in-place auto-refresh** (a dead code on screen is the #1 activation failure,
  and auto-refresh is what resolves the WCAG 2.2 timing conflict).
- Register a short vanity URL; every major service is 12–22 chars.
- Two widely-cited statistics ("Roku 2025" 47s/23%, "Conviva 2025" 38s) are **fabricated** — do not
  cite them. Use CTAM/Hub April 2026 (n=3,000).

## Key Technical Decisions

### D1 — How the grant mints tokens: **decision deferred, both branches specified**

**Status:** BLOCKING for U1.3 only. Every other unit proceeds.
**Owner:** tataihono (feat-121), per the origin document's _Resolve Before Planning_ gate.

The origin proposed Route A. Today's UX/security research recommended Route B. **Both were reasoning
without a fact discovered 2026-08-05:**

| `@better-auth/oauth-provider` | device grant                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `1.6.2` (installed)           | ✗ `GrantType = "authorization_code" \| "client_credentials" \| "refresh_token"` |
| `1.6.26` (latest stable)      | ✗ identical union                                                               |
| `1.7.0-rc.4`                  | ✓ exports `deviceCodeGrant()`                                                   |

`1.7.0-rc.4` registers `urn:ietf:params:oauth:grant-type:device_code` on `/oauth2/token`, ends in the
**shared** `provider.issueTokens(...)` path (real `OauthAccessToken` + `OauthRefreshToken`,
`customAccessTokenClaims`, audience binding, introspectable), and advertises
`device_authorization_endpoint` in discovery. So the fork is no longer "custom endpoint vs wait":

**Route A — one contained endpoint on stable 1.6.2**
Enable `deviceAuthorization()` (present in the installed dist) and add a token-translation exchange.

- The plugin's approved branch returns `access_token: session.token` — a **better-auth Session row**:
  no `id_token`, no `aud`/`azp`, none of the `https://jesusfilm.org/claims/*`, no `jfp_at_` prefix,
  **no refresh token at all**. So R4 (weeks-long rotating session) cannot come from the plugin; the
  translation exchange is load-bearing, not cosmetic.
- It also calls `setNewSession()` — every headless TV poll tries to set a browser cookie
  (`nextCookies()` is in the plugin array).
- No scope enforcement: `scope` is echoed from the device-code row, never checked against the
  client's registered scopes.
- The translation step is a **second** place `client_id`/scope can drift from what was bound at
  issuance — the exact drift behind a real Google IdP account-takeover bug (fixed 2026-03-28).
  Mitigation is mandatory: re-validate `client_id` **and** `scope` against the persisted row, as a
  named test.
- `grantTypes` is a closed union in 1.6.2 → the seeder needs a cast to record a device grant type.

**Route B — configuration, on a release candidate**

- Requires `better-auth` + `@better-auth/oauth-provider` + `@better-auth/prisma-adapter` to move to
  `1.7.0-rc.x` **in lockstep** (the handler calls `adapter.consumeOne`, absent from `1.6.2`).
- All 17 currently-used `oauthProvider` options survive; both metadata exports survive.
- 1.7.0 is a substantial surface rewrite (extensions API, `OAuthProviderExtension`, resources) — on
  the production identity provider for six existing relying clients.
- Satisfies the origin's own success criterion (_"first-class citizen, not a special case"_) by
  construction, since tokens come from the shared issuance path.

**Recommendation:** Route A on stable, **with the re-validation mitigation as a named test**, unless
the auth-platform owner is willing to carry an RC of the whole stack. The origin's success criterion
argues for B; the blast radius of an RC on six live clients argues for A. Either way, the atomic
claim (U1.4) and rate limiting (U1.5) are **ours to build** — the plugin does not provide them.

### D2 — User code format: letters vs numbers

Both are implemented behind a UI switch (`userCodeFormatPreference.ts`, commit `4e3a35c1`) precisely
so this is decided from real screens. `letters` = 8 consonants (`BXKD-QWNM`); `numbers` = **10**
digits (`019-450-7302`) — ten, not nine, because 10⁹ against a 5-attempt cap misses RFC 8628's 2⁻³²
bar. Numbers favour a majority-non-Latin-script audience (number pad, no input-mode switch; Netflix's
choice). **The format must be identical on every platform forever** — Paramount+ varies it per
platform and produced users holding a code that won't fit the web field. Decide before PR4; the
switch is removed with the losing format (U4.5).

### D3 — In-app account deletion is in scope

Not in the origin document, and the single most likely store rejection. App Store 5.1.1(v) triggers on
_supports_ account creation, and Apple's FAQ explicitly closes both escape hatches (linking out to a
website; auto-created accounts). Google Play matches and additionally wants a web-accessible deletion
URL. Cheapest compliant shape: **TV flow is sign-in-only** (sign-up happens on the phone page) and
`jesusfilm.org` exposes the web deletion URL, with the TV offering an in-app initiation path (U3, U5).

### D4 — One account per TV (v1)

Simplest, matches feat-229's web precedent. **Write it down** — it determines the `expo-secure-store`
layout and is expensive to retrofit. tvOS multi-user is real (`TVUserManager`,
`kSecUseUserIndependentKeychain`); verify whether `expo-secure-store` exposes that flag before
assuming a future profiles migration is free.

### D5 — Boot posture: report-only, enforce in the request path

Counterintuitive but decisive. `apps/auth` serves six clients; a throwing boot guard over an
**optional new** grant would 500 every route including login for all of them. And the rollback
asymmetry is worse than chat's precedent: TV binaries cannot be rolled back for weeks. So:
misconfiguration logs at boot and returns `503 config_missing` from the device endpoints.
**Precondition:** verify `apps/auth`'s Railway Config-as-code Path actually points at
`apps/auth/railway.toml` (it declares `healthcheckPath = "/api/health"`) before writing any guard —
a dashboard override silently shadowing the file has bitten this repo before.

## Open Questions

### Resolved by research since the origin was written

- _"Does a newer `@better-auth/oauth-provider` compose the device grant with introspectable tokens?"_
  → **Yes, in `1.7.0-rc.4` only.** Reframes D1 (see above).
- _"Token/refresh TTLs for a living-room device."_ → access 1h (existing default); refresh extend from
  the library's 30d to **90–180d sliding with an absolute cap**. No DPoP in this stack, so rotation is
  the only RFC 9700-compliant option.

### Still open

- **D1 route sign-off** (tataihono) — blocks U1.3 only.
- **D2 code format** — blocks U4.5 only; decide from the built screens.
- Vanity URL registration (`jesusfilm.org/tv`) — infrastructure lead time, needed before PR6.
- Android TV internal-testing cadence vs TestFlight (origin, deferred) — affects PR6 sequencing only.
- **New:** does `expo-secure-store` compile on tvOS without a patch? If not, the Datadog tvOS patch
  playbook applies (version-pinned `pnpm patch` → `pod install` **must** re-run → DerivedData clear).

## High-Level Technical Design

```mermaid
sequenceDiagram
    participant TV as apps/tv
    participant Auth as apps/auth
    participant Phone as Phone browser
    participant Admin as apps/admin

    TV->>Auth: POST /device_authorization (client_id=jfp_tv_*, scope)
    Auth-->>TV: device_code (hashed at rest), user_code, verification_uri_complete, interval, expires_in
    Note over TV: shows QR + code; polls every `interval`
    Phone->>Auth: GET /device?user_code=…
    alt signed out
        Auth->>Phone: redirect /login (prompt=login), continuation carries user_code
    end
    Phone->>Auth: POST approve (session cookie + CSRF, code re-shown for human match)
    loop until approved / denied / expired
        TV->>Auth: POST token (device_code)
        Auth-->>TV: authorization_pending | slow_down | access_denied | expired_token
    end
    Auth-->>TV: access_token (jfp_at_) + refresh_token (jfp_rt_) + id_token
    Note over TV: tokens → expo-secure-store; single-flight refresh, write-before-discard
    TV->>Admin: GraphQL with user bearer (per-operation allowlist only)
    Admin->>Auth: introspect → client_id ∈ AUTH_WEB_USER_CLIENT_IDS
```

_Directional guidance — the implementer owns final shapes within the constraints named per unit._

## Implementation Units

### PR1 — `apps/auth`: device grant foundation

#### U1.1 — `deviceCode` model + migration

**Goal:** persist device codes. **Requires:** none. **Blocks:** U1.3, U1.4.
**Files:** Modify `apps/auth/prisma/schema.prisma`. Create
`apps/auth/prisma/migrations/0003_device_code/migration.sql` (**0003** — two `0002_` prefixes already
exist).
**Approach:** fields per the plugin schema (`deviceCode`, `userCode`, `userId?`, `expiresAt`,
`status`, `lastPolledAt?`, `pollingInterval?`, `clientId?`, `scope?`) **plus** `consumedAt?` for the
atomic claim (U1.4) and hashed-at-rest columns (D-decision in U1.4). Route B adds `resource?` and
indexes. No `CREATE INDEX CONCURRENTLY` — `migrate deploy` runs in a transaction. `IF EXISTS` on any
drop (Railway retries 3×).
**Tests:** migration applies clean on a scratch DB; `prisma migrate status` clean post-merge (make it
a required check — a dashboard override once silently skipped five migrations for a week).

#### U1.2 — `tv` OAuth client + admin allowlist

**Goal:** a first-party `jfp_tv_*` client that may use the device grant and nothing else.
**Files:** Modify `apps/auth/src/domain/apps.ts` (key near `:9-15`, scopes near `:40-97`, seed after
`CHAT_APP_SEED` ~`:362`, append to `FIRST_PARTY_APP_SEEDS` `:432-439`);
`apps/auth/src/scripts/seed-first-party-apps.ts:196,217` (grant types);
`apps/auth/src/services/app-registry.service.ts:31-51` (**second exemption** — a device-only client has
no redirect URI and currently trips the throw); `apps/admin/src/config/env.ts:198` consumer CSV.
**Constraints:** scopes exactly `openid profile:read email:read offline_access` — the STOP rule from
`public-repo-oauth-seed-railway-domain-exposure-calculus.md` binds the list to identity-only. The seeder
is **upsert-only and never prunes**: a `clientId` can never be renamed or dropped. Restrict the device
grant to seeded clients declaring it in `OauthClient.grantTypes` — `allowDynamicClientRegistration` and
`allowUnauthenticatedClientRegistration` are both **on**, and the device grant skips redirect-URI
binding entirely.
**Tests:** global `clientId` uniqueness (`src/domain/apps.test.ts`); a **negative** test pinning
`jfp_tv_*` out of `DYNAMIC_PREVIEW_CLIENT_IDS`; policy-exemption test.

#### U1.3 — Device endpoints ⚠️ **forked on D1**

**Goal:** issue and redeem device codes, minting tokens admin's introspection accepts.
**Blocked by:** D1 sign-off.
**Route A files:** Modify `apps/auth/src/auth/config.ts:113-181` (add `deviceAuthorization({…})` with
`expiresIn: "15m"`, `interval: "5s"`, `validateClient`, custom `generateUserCode` per D2,
`verificationUri`); create the translation endpoint modeled on
`apps/auth/src/auth/agent-login-plugin.ts` + `src/services/agent-login.service.ts`.
**Route A mandatory mitigations:** re-validate `client_id` **and** `scope` against the persisted row at
translation (named test — this is the Google-CVE shape); suppress the plugin's `setNewSession()` so a
headless poll never sets a cookie; enforce scope against the client's registered scopes (the plugin
does not).
**Route B files:** bump the three packages in lockstep; add `deviceCodeGrant()`; widen `grantTypes`.
**Tests:** each RFC error code with a fixture where **only** that branch matches; at least one fixture
in better-auth's real wire shape (`APIError` → `{error, error_description}`, HTTP 400).

#### U1.4 — Atomic claim + hashing at rest

**Goal:** one device code redeems exactly once, and codes are not plaintext in the DB.
**Approach:** replace `findOne` → branch → `delete` with a single
`updateMany({ where: { deviceCodeHash, status: "approved", consumedAt: null, expiresAt: { gt: now } },
data: { consumedAt: now } })`; `count` is the claim token; `count === 0` → one disambiguating
`findUnique` to separate not-found from already-consumed. Store `sha256(code)` following
`TokenRecord.tokenHash @unique`; the hash must stay **deterministic** (it is a lookup key).
**Expect a CodeQL failure:** `js/insufficient-password-hash` on this sha256 is a documented false
positive — dismiss via `gh api` (280-char limit). Do **not** "fix" it with bcrypt; that breaks lookup.
**Tests:** lost-race test (two concurrent redemptions → exactly one success); expired and denied paths.

#### U1.5 — Rate limiting

**Goal:** the endpoints do not ship unthrottled. RFC 8628 §5.2 names the brute-force surface, and a
`GET /device?user_code=` status oracle over a short code is exactly it.
**Approach:** `rateLimitAuthRoute(...)` as the **first statement** of `/device_authorization`, the
device branch of token, and the `/device` submit — matching the existing three intercepted paths in
`src/app/api/auth/[...all]/route.ts`. Add a **per-user-code attempt cap (~5)** that kills the code —
distinct from per-IP throttling. Bucket keys: `device_code` is attacker-mintable, so it spreads
availability but is not the abuse ceiling; the real bound is per-IP/per-client issuance.
**Tests:** N wrong codes locks the **code**, not just the IP.

#### U1.6 — Observability + boot posture

**Approach:** plain-string `[device] event=… key=value` logs — `JSON.stringify` payloads from App
Router handlers are silently dropped by Railway logsV2. Pre-verification values use `attemptedClientId=`
/ `claimedUserId=`; canonical names only after verification. Sanitize before interpolation
(`replace(/[\r\n\t]/g," ").slice(0,64)`); never log a raw device or user code (the agent-login
precedent redacts). Boot guard **report-only** per D5; request path returns `503 config_missing`.

### PR2 — `apps/auth`: the `/device` approval page

#### U2.1 — Code entry

Accept lowercase, strip dashes/spaces/punctuation, strip out-of-charset characters, support paste
(RFC 8628 §6.1 — the server "should strip dashes… input should be uppercased before comparison").
**Force-dynamic** the route, or a Railway kill-switch flip does nothing until a rebuild.

#### U2.2 — Signed-out continuation

**Constraint:** `web-callback.ts:8-14` filters the auth origin out of allowed callback origins, so
`callbackURL=https://auth.jesusfilm.org/device?...` is **rejected**. Thread `user_code` through the
existing `oauth_query` pattern in `[...all]/route.ts` instead. Do **not** build a second login
surface — reuse `/login` (which is email-first and already has duplicate-account protection).

#### U2.3 — Approval screen

The security control, not a formality: re-show the code for the human to compare, name the app and
device, make **Deny at least as prominent as Approve**. Session cookie + CSRF — `Origin` is a soft
gate, never a boundary, and this POST grants tokens. Modeled on `consent-page-client.tsx:28-55`.
**Constraint (guideline 4.8):** if this page ever renders a Google/Facebook button, 4.8 attaches to the
tvOS build. Audit before submission.

#### U2.4 — Shared-phone hazard

The phone rides `apps/auth`'s rolling 7d/1d SSO session, so a family phone silently approves as
whoever signed in last. Send `prompt=login` on the `/device` → `/login` hop, **or at minimum** render
the approving account's email on the approval screen.

### PR3 — `apps/auth`: account deletion (D3)

Endpoint + confirmation flow. Constraints from the research: no phone-call/email-only path; available
regardless of the user's location; manual/delayed deletion acceptable only with a stated timeline and
a confirmation. Must also revoke all refresh tokens for the user.

### PR4 — `apps/tv`: real grant

#### U4.1 — Secure storage + env

`expo-secure-store` is a **new native module** → `EXPO_TV=1 npx expo prebuild --clean` + fresh
dev-client build; if it fails on tvOS, apply the version-pinned `pnpm patch` playbook (then
`pod install` **must** re-run — the virtual-store path gains `patch_hash=` — plus a DerivedData clear).
New TV env var in **three** places in `apps/tv/src/env.ts` (module-scope `_inlined`, `client`,
`runtimeEnvStrict`); omitting `_inlined` white-screens **only in EAS builds**. Keep
`skipValidation: !!CI && !process.env.EAS_BUILD` intact.

#### U4.2 — Polling

Pure state machine (injected clock) + thin wiring, per the relocated-risk law — and note `apps/tv` has
**no renderer**, so the StrictMode detector does not exist here; compensate with an adversarial re-read
of the arming seam and a hardware smoke. Every tick inside try/catch (an unhandled rejection is an
all-native `RCTFatal` in dev). Bound each request below the poll interval. `slow_down` is
**cumulative** (+5s per occurrence). Any unrecognized error code **stops** polling. AppState branch on
`=== "background"`, never `!== "active"`. Auto-refresh the code in place with a countdown when it
expires (R6).

#### U4.3 — Token refresh

Single-flight, **caller-side release**, identity-checked, registered on both settlement paths
(`void flight.then(release, release)` — `.finally` re-throws into an unhandled rejection), with a
joiner-side catch. **Write the new token before discarding the old.** Rotation + crash otherwise
leaves a dead token; and reuse detection does `deleteMany` on `(clientId, userId)` — under one shared
TV client id, one TV replaying a stale token signs out **every** TV on the account. Decide explicitly:
accept the blast radius, or per-device client ids.

#### U4.4 — Sign out

Revoke at `/api/oauth/revoke` **and** wipe secure storage. Clearing local storage alone leaves a live
rotating family server-side.

#### U4.5 — Remove both scaffolds + write the removal ticket

Demo stub (`DEMO_PROFILE`, "Approve on this device (demo)") and the code-format switch. **KEEP-list:**
`deviceAuthFlow.ts`'s pure state machine and RFC field names, `profileFlag.ts` (the release gate
stays), `SignInQr.tsx`, `EXPO_PUBLIC_TV_PROFILE_ENABLED`. **Greps:**
`DEMO_PROFILE|createPendingSession|userCodeFormatPreference|USER_CODE_FORMATS|forge.tv.user_code_format`.
**Step 0:** format decided (D2) / real grant live. **Operator category no PR can claim:** the
AsyncStorage key `forge.tv.user_code_format` persists on installed devices after the code is gone.

#### U4.6 — Anonymous → signed-in merge

Promote `viewer-id`, Continue Watching, and the watch-event queue once, idempotently, max-progress
wins. Account-isolation boundary: keep a current-local-user marker, never enumerate all user-scoped
buckets, and the server ignores entries whose claimed user id ≠ the authenticated session. The next
family member must not inherit buckets.

#### U4.7 — Profile data

Prefer the userinfo endpoint. If the id_token is decoded: verify **only** the id_token, build JWKS as
`new URL("/api/auth/jwks", issuer)`, derive `algorithms` from the published JWKS — a hardcoded pin
silently breaks every TV after key rotation, with no console to diagnose it.
`apps/chat/src/auth/oauth-client.ts` is the hardened template. Persist the display **name** separately
(regular storage, display-only) so a cold launch doesn't show a placeholder for 1–2s.

#### U4.8 — Telemetry (R8)

No `setUser`, no PII. A `/token` error string can embed `verification_uri_complete` **including the
user code** — sanitize (strip newlines, strip query strings, cap length). `docs/observability/datadog.md`
asserts TV zero-PII; that assertion must be revisited in this PR.

#### U4.9 — Bearer wiring

Extend `apps/tv/src/lib/authHeaders.ts` per-operation allowlisting. Do **not** widen `HttpLink.headers`.
The user token and the baked-in fleet token are different credentials — never merge or substitute, and
do not attach the user token to `WatchSearch` (it would change the rate-limit bucket identity).

### PR5 — `apps/tv`: profile + deletion affordance

Sign out / sign out everywhere / delete account. `useFocusVisual(role)` only; all dp through `scale()`;
`Math.round()` scaled fonts on Android; no `position:"absolute"` on focusables; `createFocusMemory()` +
`requestTVFocus()` for this multi-focusable screen. The white focus ring **vanishes on the white QR
tile** — the documented light-surface exception.

### PR6 — Rollout

Receiver-first, and the window is weeks not minutes because TV binaries cannot roll back.

1. Verify `apps/auth` Railway Config-as-code Path (D5 precondition).
2. Deploy `apps/auth`: migration → seed → endpoints, **every environment**.
3. Verify `/device_authorization` and the token device branch specifically — a 200 healthcheck means
   the server booted, not that routes work.
4. Add `jfp_tv_*` to admin's `AUTH_WEB_USER_CLIENT_IDS`; confirm introspection accepts a TV token
   **with the TV client id visible in logs** (origin success criterion).
5. Only then ship a TV build with the flag on → TestFlight / internal preview → hardware test on both
   platforms → production build.

## System-Wide Impact

**Interaction graph.** TV poll → `/token` → (Route A) plugin redemption → translation → `issueTokens`
→ `OauthAccessToken` + `OauthRefreshToken` rows → admin introspection on every subsequent GraphQL
call. A `setNewSession()` left unsuppressed also touches `nextCookies()` on every poll.

**Error propagation.** RFC 8628's five codes are the contract in both directions; the literals are the
single source of truth and must not be renamed through layers. Never surface a Zod message (it would
echo the submitted code to an unauthenticated poller) — return exactly the RFC codes.

**State lifecycle risks.** Partial failure between "server rotated the refresh token" and "TV persisted
it" is the primary orphan; `deleteMany` on `(clientId, userId)` turns it into a household-wide
sign-out. Device-code rows need expiry cleanup.

**API surface parity.** `apps/admin` introspection is the only other consumer and must remain
**unchanged** — that is the test of whether the token is first-class.

**Integration scenarios mocks won't catch.** (1) Two concurrent polls with the same device code.
(2) App killed mid-refresh, relaunched. (3) Approval on a phone already signed in as a _different_
family member. (4) Code expiring while the QR is on screen. (5) Android TV D-pad sweep — a different
focus engine from tvOS.

## Risks & Dependencies

| Risk                                                                    | Mitigation                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Route B takes the production IdP to a release candidate for six clients | D1 recommends A on stable; if B, stage in preview first and pin exact versions in lockstep                            |
| Route A's translation drifts `client_id`/scope (real Google CVE shape)  | Mandatory re-validation against the persisted row, as a named test                                                    |
| One TV signs out the whole household                                    | Write-before-discard + single-flight; explicit decision on per-device client ids                                      |
| Store rejection for missing account deletion                            | PR3 + PR5 in scope (D3)                                                                                               |
| TV binaries cannot roll back                                            | Receiver-first rollout; auth code revert decoupled from the DB timeline (query `_prisma_migrations` before reverting) |
| Device endpoints brute-forced                                           | U1.5: per-IP throttle **and** per-code attempt cap                                                                    |
| `expo-secure-store` fails on tvOS                                       | Datadog tvOS patch playbook                                                                                           |
| CodeQL blocks on the sha256 lookup                                      | Documented false positive; dismiss, don't "fix"                                                                       |
| Green CI on an unmergeable PR                                           | Gate on `gh pr view --json mergeable,mergeStateStatus` before trusting `--watch`                                      |

## Definition of Done

**PR1–PR3 (auth) may NOT claim:** real-hardware redemption, poll behaviour at fleet scale, or "`tv` row
seeded in every environment". Those are **entry preconditions on PR4/PR6**, with a named owner.

- [ ] D1 signed off; the chosen route's mitigations implemented as named tests
- [ ] D2 decided; losing format and both scaffolds removed; removal ticket filed
- [ ] Atomic claim proven by a lost-race test
- [ ] Each RFC error code has a test where only that branch matches; one real-wire-shape fixture
- [ ] Rate limit + per-code attempt cap proven
- [ ] Refresh: single-flight, caller-side release, write-before-discard, all three hazard tests
- [ ] Admin introspection accepts a TV token, TV client id visible in logs
- [ ] Uncoached tester completes the flow on real Apple TV **and** Android TV
- [ ] Session survives force-quit, relaunch, reboot
- [ ] Datadog shows no PII for the new surface
- [ ] Tier-2 `/ce-code-review` run before push on every PR (auth + migration + secrets)

## Sources & References

### Origin

`docs/brainstorms/2026-07-29-tv-auth-releasable-requirements.md` — R1–R8, success criteria, scope
boundaries, and the staged-rollout decision are carried forward verbatim in intent. Its _Resolve
Before Planning_ gate (Route A/B) is honoured: U1.3 is the only unit blocked by it. Two of its
_Deferred to Planning_ questions are now answered (D1's version table; TTLs in Open Questions). Its
"no resume on TV" boundary is amended, with reason.

### Internal

- Ticket: `docs/roadmap/platform/feat-322-tv-auth-sign-in-profile.md` (**note:** `feat-322` is a
  colliding id — four other tickets share it; always reference by path)
- Research: `research/2026-08-05-tv-sign-in-ux-research.md`
- House-style exemplars: `docs/plans/2026-07-02-001-feat-web-auth-watch-history-plan.md`,
  `docs/plans/2026-05-18-001-feat-partner-api-key-store-plan.md`,
  `docs/plans/2026-05-11-001-jesus-film-auth-platform-plan.md` (feat-121, this plan's dependency)
- Learnings: the table in _Context & Research_ names each with its binding unit

### External

- RFC 8628 §3.3.1 (code display MUST), §3.5 (polling), §5.2 (brute force), §6.1 (charset, normalization)
- App Store Review Guidelines 5.1.1(v), 4.8 · Apple account-deletion implementation FAQ
- Google Play account-deletion policy
