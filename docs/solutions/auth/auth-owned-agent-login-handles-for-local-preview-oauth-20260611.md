---
title: "Agent login handles should be Auth-owned and OAuth-native"
date: 2026-06-11
category: auth
module: apps/auth
problem_type: developer_experience
component: authentication
severity: medium
applies_when:
  - "AI agents need browser-based validation against local or preview Forge apps"
  - "A relying app is tempted to add an app-local auth bypass for development"
  - "Testing must exercise the real Auth browser and OAuth continuation flow"
  - "Static shared passwords or inbox-backed test accounts create friction"
related_components:
  - development_workflow
  - tooling
tags:
  - auth
  - oauth
  - agent-login
  - local-dev
  - preview
  - bearer-credentials
  - ai-agents
---

# Agent login handles should be Auth-owned and OAuth-native

## Context

Browser-driving agents need to validate local and preview apps that depend on
Production Auth. The tempting shortcut is to add an app-local bypass, a static
test password, a spoofable role header, or a service bearer that the browser can
inject. Each shortcut skips the exact path most likely to break in real use:
Auth login, OAuth authorization, callback handling, grants, scopes, cookies, and
the relying app's own session creation.

The implemented pattern keeps Auth as the owner of identity, login, OAuth
continuation, grants, audit, and browser session cookies. A trusted developer
environment mints a short-lived email-like agent login handle, the agent pastes
that handle into the ordinary Auth email field, and Auth redeems it into the
normal browser/OAuth path for an approved local or preview client.

Session history reinforced the same boundary from earlier Auth work: Auth owns
identity and OAuth, while relying apps own their local sessions and app-specific
authorization. Local conveniences should not weaken that boundary or recreate
the coupling the Auth extraction removed. (session history)

## Guidance

Implement agent browser login as an Auth-owned flow, not as per-app test
authentication. Relying apps should keep redirecting to Auth and receiving the
normal OAuth callback/session result. Do not add app-local auth bypasses to
Admin, Manager, Mastra Gateway, Web, or future relying apps when this pattern
applies.

Use an environment-provided minting key to protect the API, then create an
expiring `AGENT` user as the login handle. Store the generated email-like handle
as the user's email, set the user's generic `expiresAt`, and create the app
grant/scopes during minting. Redemption atomically moves `expiresAt` to the
current time so the same handle cannot be used again.

Constrain minting and redemption to the intended OAuth context:

- Allow only `LOCAL` and `PREVIEW` app environments in the first slice.
- Require exact redirect URI matches from the app registry.
- Resolve scopes from requested scopes or environment defaults, then ensure
  every scope is known and inside the app environment defaults.
- Make handles short-lived and single-use with an atomic `User.expiresAt`
  transition to the redemption time.

Redeem through Better Auth rather than parallel cookie code. A custom Better
Auth plugin endpoint can validate the handle, consume the `AGENT` user's
expiry, create the Better Auth session through the internal adapter, and set the
normal Better Auth session cookie.

Preserve the existing email-first UI. The login-method endpoint can recognize
the reserved handle domain and check redeemability without consuming the handle.
The login page can then post to `/api/auth/agent-login/redeem` and follow the
returned OAuth continuation URL. Invalid or non-redeemable handles should fail
closed without exposing whether a handle exists.

Keep audit data useful but redacted. Emit mint/redeem success and rejection
events, but never log raw handles or raw minting keys. Invalid attempts should
avoid canonical verified actor fields until the user is known.

## Why This Matters

This pattern lets agents test the real login, OAuth authorize, callback, grant,
scope, and relying-app session behavior. An app-local bypass would only prove
that the bypass works.

The expiring-user model keeps the schema small while preserving the important
behavior: a generated browser-native credential, normal Auth session creation,
app grants/scopes, and single-use redemption. The minting key can be rotated
through environment configuration.

The local/preview boundary prevents agent handles from becoming a broad
production login bypass. Exact redirect and scope checks keep a minted handle
tied to one intended OAuth context rather than turning it into a general bearer
identity.

Using Better Auth's plugin/session path keeps cookie semantics, session storage,
and future Better Auth behavior centralized. That avoids subtle drift where
custom auth code appears to work locally but does not behave like real Auth
sessions.

## When to Apply

- Automation needs to enter a human-oriented OAuth/browser login flow.
- Local or preview browser validation must exercise real callback behavior.
- Credentials need environment-key protection, expiry, auditability, app
  environment restrictions, and single-use semantics.
- An app team is considering a local auth bypass, role header, static shared
  password, inbox-backed test account, or browser-exposed service bearer.

Do not use this for production end-user impersonation, app-specific
authorization bypasses, service-to-service auth, public signup, or broad access
tokens. Apps should still enforce their own authorization using Auth-issued
identity, claims, grants, and scopes.

## Examples

Minting starts from the app-environment policy after the route has verified the
environment-provided minting key:

```ts
const environment = await prisma.appEnvironment.findUnique({
  where: { clientId: input.clientId },
  include: { app: true },
})

assertMintingPolicy({
  redirectUri: input.redirectUri,
  requestedScopes: input.requestedScopes,
  defaultScopes: environment.defaultScopes,
  environmentKind: environment.kind,
  redirectUris: environment.redirectUris,
})
```

Create an expiring agent user and grant:

```ts
await prisma.user.create({
  data: {
    email: handle,
    actorType: "AGENT",
    emailVerified: true,
    membershipStatus: "ACTIVE",
    expiresAt,
  },
})
```

Redeem with an atomic single-use claim:

```ts
const claimed = await prisma.user.updateMany({
  where: {
    email: normalizedHandle,
    actorType: "AGENT",
    expiresAt: { gt: now },
  },
  data: { expiresAt: now },
})

if (claimed.count !== 1) {
  throw new AgentLoginError("Invalid agent login handle.", "invalid_handle")
}
```

Create the browser session through Better Auth:

```ts
const session = await ctx.context.internalAdapter.createSession(redeemed.userId)
await setSessionCookie(ctx, { session, user })
```

Keep audit payloads redacted:

```ts
await auditAgentLoginEvent(prisma, {
  eventType: "agent_login.minted",
  subject: clientId,
  metadata: {
    clientId,
    handle: "[redacted]",
    scopes,
  },
})
```

## Related

- `docs/plans/2026-06-11-001-feat-agent-login-handles-plan.md`
- `docs/roadmap/platform/feat-177-agent-login-handles.md`
- `docs/solutions/auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md`
- `docs/solutions/developer-experience/local-admin-dev-auth-flow-impractical-20260514.md`
- `docs/solutions/architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md`
- `docs/solutions/security-issues/pre-verification-log-field-namespace-pollution-20260518.md`
- `docs/solutions/auth/spike-auth-header-must-be-env-gated.md`
- `docs/solutions/auth/email-first-provider-routing-before-password-20260526.md`
