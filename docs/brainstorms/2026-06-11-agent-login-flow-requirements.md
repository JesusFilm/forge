---
date: 2026-06-11
topic: agent-login-flow
---

# Agent Login Flow

## Problem Frame

AI agents are increasingly expected to perform browser-based validation against
local Forge apps. Those apps use `apps/auth` as the real identity authority and
rely on OAuth callbacks into app-local sessions, so an app-local bypass would
either skip the real auth journey or fail to represent production behavior.
Agents need a way to authenticate through the real Auth browser login page as
approved non-human agent identities, then return to localhost apps through the
normal OAuth/session flow.

The preferred shape is a generated, email-like agent login handle. A trusted
developer environment calls Auth with an environment-provided minting key,
requests the scopes/app access needed for browser testing, receives a long-form
email-like value, and the agent pastes that value into the existing Auth email
box.
Clicking Continue redeems the handle and logs the agent in without a password
or email validation step.

This should make local browser validation faster without weakening normal
production human authentication.

## Requirements

**Agent Identity**

- R1. Auth supports explicitly designated agent users that are distinct from
  human staff users in operator views, audit logs, and issued session/token
  metadata.
- R2. Agent users authenticate through the real Auth browser login page, not
  through app-local bypass endpoints or direct bearer-token injection.
- R3. agent users are scoped to approved first-party app environments and
  cannot acquire arbitrary app access by virtue of being agent accounts.

**Agent Login Handle Minting**

- R4. Auth exposes a protected API for trusted developer environments to mint
  short-lived email-like agent login handles for requested app access and
  scopes.
- R5. The minting API requires a key available to approved developer
  environments, and the requested scopes are capped by the target app
  environment defaults.
- R6. A minted handle is shaped like an email address so it can be entered into
  the existing Auth email field, but it is not an inbox-backed email account.
- R7. Minted handles are sensitive bearer login credentials and should be
  short-lived, preferably single-use, and safe from raw-value logging after
  creation.

**Browser Login Flow**

- R8. An agent can open a local relying app, follow the normal sign-in
  redirect to Auth, submit agent credentials in the browser, and return to the
  local app callback with a normal app-local session.
- R9. The current Auth login layout remains visually ordinary: an email field
  with a Continue button. Entering a normal email continues to the normal user
  flow; entering a valid minted agent handle redeems the handle and signs in the
  Agent without routing to password entry.
- R10. Minted agent handles do not require email verification, magic-link inbox
  access, password entry, passkeys, CAPTCHA, or manual MFA during redemption.
- R11. The Auth login UI should not expose a public self-service path to create
  agent users or mint agent login handles.

**Environment and Callback Policy**

- R12. Agent login is allowed only for approved local or preview
  first-party OAuth clients and exact-match redirect URLs.
- R13. Production relying-client callbacks are excluded from agent login
  login policy unless a later security review explicitly allows a narrower
  production QA mode.
- R14. Existing localhost clients such as Admin, Manager, and Mastra Studio
  continue to use their normal OAuth callback flow; Agent login should extend
  that flow rather than introduce a second session model.

**Security and Operations**

- R15. Agent login sessions are short-lived and auditable, with logs identifying
  the actor as an agent and preserving the target app/client/environment.
- R16. Developer-environment minting keys can be rotated independently of
  human credentials and first-party app client secrets.
- R17. Auth does not log raw minted handles, passwords, bearer tokens, refresh
  tokens, client secrets, or unnecessary PII during Agent minting or login.
- R18. Apps remain responsible for app-specific authorization after Auth proves
  the Agent identity and grants.

## Success Criteria

- A browser-driving agent can authenticate into a local first-party app through
  the real Auth login page without human intervention.
- The local app receives the same kind of authenticated app-local session it
  receives after a normal human OAuth login.
- A trusted developer environment can mint a scoped email-like handle that logs
  in through the existing email field and Continue button.
- Operators can distinguish Agent activity from human user activity in Auth
  and app-side audit trails.
- Agent login cannot be used as an open production auth bypass.

## Scope Boundaries

- Do not add app-local auth bypasses to Admin, Manager, Mastra Gateway, or Web
  as the primary solution.
- Do not create public signup for Agent accounts.
- Do not require agents to manage static shared passwords or inbox-backed email
  accounts for QA login.
- Do not make Auth own app-specific ABAC or domain permissions; relying apps
  keep those decisions.
- Do not solve fully unattended production data mutation QA in this first
  slice. The first goal is local and preview browser validation.
- Do not replace the existing OAuth/OIDC relying-client model.

## Key Decisions

- **Use real Auth UI over app-local bypass:** Browser QA needs to exercise the
  same redirect, login, callback, and app-local session path that humans use.
- **Use agent users over service credentials:** Service credentials are not
  browser-native and should not create human-like app sessions.
- **Use generated email-like handles over static passwords:** A minting API lets
  approved developer environments request the access needed for a QA session
  without distributing a pool of shared passwords or requiring inbox access.
- **Keep the login UI ordinary:** The existing email field and Continue button
  are enough. Valid minted handles redeem directly; normal emails continue
  through the normal user flow.
- **Restrict relaxed controls by handle, identity, and callback context:**
  CAPTCHA, passkeys, password entry, and manual MFA may remain normal for humans
  while minted QA handles get an automation-safe path only for approved
  local/preview contexts.

## Existing Context

- `apps/auth/CLAUDE.md` states that Auth owns identity, app registrations,
  app-level scopes/grants, OAuth/OIDC provider behavior, tokens, audit, and
  revocation.
- `apps/auth/CLAUDE.md` also states that environment-specific app registrations
  are first-class and that OAuth redirect URLs must be exact-match per app
  environment.
- `apps/auth/src/domain/apps.ts` already seeds local OAuth clients and localhost
  callback URLs for Admin, Manager, and Mastra Studio.
- `docs/brainstorms/2026-05-22-auth-consolidation-requirements.md` establishes
  the pattern that first-party staff apps use Auth as the OAuth/OIDC authority
  and establish app-local sessions after callback.

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1, R15][Technical] Determine the lightest schema or metadata change
  needed to represent agent users distinctly from human users.
- [Affects R3, R12, R13][Technical] Define the exact policy check that combines
  user type, OAuth client, app environment, and redirect URL.
- [Affects R4, R5, R7, R16][Technical] Decide how developer-environment minting
  keys are provisioned, rotated, and audited.
- [Affects R6, R7, R9][Technical] Define the handle format, user expiry field,
  and single-use redemption behavior.
- [Affects R9, R10][Needs research] Verify how the current login page branches
  after email submission and where agent handle detection should occur without
  disrupting normal email/password or Firebase fallback flows.
- [Affects R15][Technical] Decide which audit event names and app-side claims
  should identify Agent login sessions.

## Next Steps

-> `/ce:plan docs/brainstorms/2026-06-11-agent-login-flow-requirements.md`
for structured implementation planning.
