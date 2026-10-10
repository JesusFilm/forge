---
title: "Changelog Forge Auth Registration - Plan"
type: "feat"
date: "2026-08-19"
topic: "changelog-forge-auth"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-brainstorm"
execution: "code"
deepened: "2026-08-20"
---

# Changelog Forge Auth Registration - Plan

## Goal Capsule

- **Objective:** Forge Auth registers and enforces grant-aware Changelog access for local and production without granting Changelog privileges to every Auth account; production activation remains disabled until supported grant provisioning and revocation exist.
- **Means:** Preserve the completed Changelog registry work, depend on feat-401's Better Auth 1.7.1 native-resource upgrade, and enforce grants through provider-owned resource state at authorization, code exchange, and refresh. (KTD1-KTD8)
- **Product authority:** This Product Contract's confirmed Forge scope overrides the broader environment coverage in JesusFilm/jfp-changelog issue #71; Forge Auth remains authoritative for application grants and token scopes, while Changelog remains authoritative for its domain rules.
- **Stop conditions:** Stop if `https://changelog.jesusfilm.org` conflicts with another canonical Forge domain, if feat-401 is not complete on main, if the installed provider cannot prove native authorization-to-token-to-refresh resource binding, or if enforcement changes an existing first-party application's behavior.
- **Execution profile:** One bounded Auth implementation. Do not push, open a PR, deploy, or enable Changelog production use unless separately requested.
- **Tail ownership:** The executor updates feat-399 and repository documentation after focused and full Auth validation. Production activation remains blocked until supported grant provisioning and revocation exist.

---

## Product Contract

### Summary

Forge Auth will register Changelog for local and production OAuth, expose the required identity and Changelog scopes, and issue Changelog scopes only through explicit grants. Preview and Changelog-owned domain authorization remain outside this Forge slice.

**Product Contract changed: R18 and R21 — the provider upgrade is now a separate prerequisite, and independent Codex/Claude dynamic clients are explicit acceptance actors.** Existing scope, grant, activation, and ownership requirements remain unchanged.

### Problem Frame

JesusFilm/jfp-changelog issue #71 makes Jesus Film Auth the sole identity and application-access authority for Changelog's web and MCP surfaces. Forge Auth must represent Changelog as a first-party application and ensure that an Auth account alone does not imply Changelog access.

The original issue includes preview registration, but Changelog has no stable preview deployment or callback domain. Production also cannot be considered ready if grants are enforced but operators have no supported way to provision them.

<!-- ce-section: work-relationships -->

### How This Work Fits Together

- **Depends on:** feat-121's Auth platform and supported application-grant operations, plus feat-401's completed Better Auth 1.7.1 native-resource upgrade.
- **Enables:** The Changelog repository can validate Forge-issued identity, audience, expiry, and scopes for its web and MCP surfaces.
- **Can proceed independently of:** Changelog entry ownership and product authorization can be developed against the confirmed scope contract without moving those rules into Forge Auth.
- **Deferred:** Preview coverage requires a stable Changelog preview deployment and callback domain before either repository can register or consume it.
- **Explicitly separate:** The Better Auth upgrade and protected-resource schema migration land first in feat-401. This plan consumes that native provider contract but never reimplements it. (KTD6-KTD8)

### Key Decisions

- **Local and production only.** (session-settled: user-directed — chosen over satisfying issue #71's preview requirement now because Changelog has no stable preview deployment or callback domain.) Governs R4-R6, R8-R9.
- **Supported grant provisioning is a production prerequisite.** (session-settled: user-approved — chosen over manual database provisioning or expanding this task with a new provisioning workflow.) Governs R12.
- **Auth grants application access; Changelog enforces domain rules.** This preserves the existing platform boundary. Governs R10-R11, R19.
- **Dynamic Codex and Claude clients are required.** (session-settled: user-directed — chosen over seeded-client-only MCP support because engineers must connect their own clients.) Governs R14, R16-R17, R21.
- **Upgrade Better Auth in a separate prerequisite PR.** (session-settled: user-directed — chosen over a combined upgrade or a custom authorization-code rewrite because production Auth risk must remain isolated.) Governs R18.

### Actors

- A1. **Changelog user:** An authenticated Auth account that may hold no Changelog grant or an approved reader, submitter, or administrator grant.
- A2. **Auth operator:** The trusted person or supported operational surface that provisions and revokes Changelog application grants.
- A3. **Changelog relying application:** The local or production web/MCP consumer that requests identity and Changelog scopes from Forge Auth.
- A4. **Forge Auth:** The authority that validates the OAuth client, application environment, grant, requested scopes, and token audience.
- A5. **Engineer MCP client:** A separately registered Codex or Claude client that uses public PKCE, browser sign-in/consent, and the exact Changelog resource without seeded credentials.

### Requirements

**Scope catalogue and application identity**

- R1. Forge Auth recognizes `changelog:read` as **Read Changelog**, described as “View and filter published Changelog entries.”
- R2. Forge Auth recognizes `changelog:submit` as **Submit Changelog entries**, described as “Submit entries and manage entries created by the caller.”
- R3. Forge Auth recognizes `changelog:admin` as **Administer Changelog**, described as “Manage all Changelog entries and products.”
- R4. Changelog is a first-party application owned by Jesus Film Project with exactly `local` and `production` environments in this slice.

**OAuth clients and audiences**

- R5. The local environment uses public PKCE client `jfp_changelog_local`, origin `http://localhost:3000`, callback `http://localhost:3000/api/auth/callback`, and post-logout redirect `http://localhost:3000/api/auth/login`.
- R6. The production environment uses public PKCE client `jfp_changelog_production`, origin `https://changelog.jesusfilm.org`, callback `https://changelog.jesusfilm.org/api/auth/callback`, and post-logout redirect `https://changelog.jesusfilm.org/api/auth/login`.
- R7. Both seeded clients may request `openid`, `profile:read`, `email:read`, `membership:read`, `changelog:read`, `changelog:submit`, and `changelog:admin`. Existing provider behavior governs the identity and membership scopes; only the `changelog:*` namespace is intersected with AppGrant scopes.
- R8. Forge Auth accepts `http://localhost:3000/mcp` and `https://changelog.jesusfilm.org/mcp` as Changelog resource audiences through the repository's canonical audience-configuration mechanism.
- R9. No preview or staging OAuth client, redirect, origin, or MCP audience is registered by this work.

**Grant and authorization policy**

- R10. Human OAuth issuance restricts requested Changelog scopes to the union of scopes on currently approved, non-revoked grants for the authenticated user, Changelog application, and resolved environment. Grants for another user, application, or environment contribute nothing.
- R11. A reader grant permits only `changelog:read`; a submitter grant permits `changelog:read` and `changelog:submit`; an administrator grant permits all three Changelog scopes. Existing identity scopes remain available according to normal client and provider policy.
- R12. Production Changelog scope issuance is disabled by default and cannot be activated until operators have a supported way to provision and revoke Changelog grants; undocumented direct database edits do not satisfy this prerequisite.
- R13. Existing first-party applications retain their current registrations and access behavior; the dormant generic OAuth policy is not enabled globally.
- R14. A dynamically registered MCP client requesting a Changelog scope must supply exactly one byte-for-byte canonical local or production Changelog MCP resource. That resource resolves the target environment; dynamic client metadata alone never selects an AppGrant.
- R15. A seeded Changelog client resolves its environment from the registered client row. If it also supplies a Changelog MCP resource, the client environment and resource environment must match.
- R16. Authorization downscopes Changelog scopes before Better Auth creates a provider-native resource-bound code. Exchange maps the provider-persisted resource to the immutable user/application/environment context and rejects a changed or reduced grant decision before token persistence.
- R17. Refresh uses the provider-persisted original resource and scope ceilings, re-evaluates current grants, rejects resource widening or grant reduction, and never widens from a later grant expansion.
- R18. U2/U3 begin only after feat-401 is complete on main with Better Auth 1.7.1 and its native resource real-database contract green.

**Ownership boundary**

- R19. Forge Auth owns application grants and token scopes, while Changelog owns entry ownership, editing and deletion rules, and product administration rules.
- R20. The Forge change does not add Firebase authentication, a Changelog-local email allowlist, shared cross-application cookies, a confidential client, a grant-management UI, or unrelated Auth dashboard behavior.
- R21. Independent Codex and Claude clients each complete their current standards-based runtime client identity path, human login/consent, PKCE exchange, MCP connection, refresh, and reconnect without sharing a client or token family. Unauthenticated DCR remains supported; Client ID Metadata Documents are enabled if either tested client selects that MCP 2026-07-28 path.
- R22. Consent for a dynamic Changelog client displays the canonical resource/environment and identifies unverified client metadata; consent for one resource or scope set never authorizes another.

### Key Flows

- F1. **Seeded Changelog web authorization**
  - **Trigger:** A1 signs in through the local or production seeded Changelog client.
  - **Steps:** A4 resolves the environment from the registered client, reads matching approved grants, intersects only requested `changelog:*` scopes before code creation, then revalidates that immutable context before the existing provider exchanges the code.
  - **Outcome:** Identity scopes follow existing behavior; no Changelog scope exceeds the environment-specific grant.
  - **Covered by:** R5-R7, R10-R13, R15-R16.
- F2. **Dynamically registered MCP authorization**
  - **Trigger:** An MCP OAuth client requests Changelog scopes and an exact Changelog `/mcp` resource.
  - **Steps:** A4 resolves the environment from the exact authorization resource, evaluates the matching AppGrant, and passes downscoped scopes into Better Auth. The provider persists the resource and rejects exchange or refresh widening before issuing an audience-bound token.
  - **Outcome:** The dynamic client cannot select a grant through untrusted metadata or move a local grant to the production resource.
  - **Covered by:** R8, R10-R11, R14, R16, R21.
- F3. **Grant-aware refresh**
  - **Trigger:** A client refreshes a token carrying Changelog scopes.
  - **Steps:** A4 reads the provider-persisted original resource and scope ceilings, maps the resource to the immutable application/environment tuple, re-aggregates current grants, and rejects stale or widened refresh before issuance.
  - **Outcome:** Revocation or scope reduction takes effect on the next refresh; scope expansion requires reauthorization.
  - **Covered by:** R14-R18.
- F4. **Production readiness**
  - **Trigger:** The production Changelog client is ready to be enabled.
  - **Steps:** A2 confirms registration, audience, enforcement, and a supported grant-provisioning/revocation path are operational, then enables the explicit production activation setting through the normal deployment flow.
  - **Outcome:** Production use begins only when every prerequisite is satisfied; otherwise it remains blocked.
  - **Covered by:** R6, R8, R10, R12.

```mermaid
flowchart TB
  Request[OAuth authorization request] --> Target{Resolve Changelog target}
  Target -->|Seeded client| ClientEnv[Registered AppEnvironment]
  Target -->|Dynamic MCP client| ResourceEnv[Exact MCP resource mapping]
  ClientEnv --> Match[User + app + environment grants]
  ResourceEnv --> Match
  Match --> Intersect[Intersect requested changelog scopes]
  Intersect --> Code[Downscoped authorization code]
  Intersect -->|No Changelog scope| Identity[Identity-only result or OAuth denial]
  Code --> Validate[Exchange revalidates tuple and exact resource]
  Validate --> Provider[Better Auth 1.7.1 native resource issuance]
  Provider --> Refresh[Refresh rechecks tuple, ceiling, and resource]
```

### Acceptance Examples

- AE1. **No Changelog grant:** A signed-in account requesting identity plus Changelog scopes receives no `changelog:*` scope. Otherwise valid identity scopes may remain; Changelog must deny app access without `changelog:read`.
- AE2. **Reader access:** A matching reader grant and a request for all Changelog scopes produces only `changelog:read` from the Changelog namespace.
- AE3. **Submitter access:** A matching submitter grant produces `changelog:read` and `changelog:submit`, but not `changelog:admin`.
- AE4. **Administrator access:** A matching administrator grant produces all three Changelog scopes.
- AE5. **Invalid grant context:** Pending, rejected, revoked, wrong-user, wrong-application, and wrong-environment grants contribute no Changelog scopes.
- AE6. **Registration fidelity:** Repeated seeding leaves exactly the specified local and production Changelog environments and public PKCE clients while preserving all existing registrations.
- AE7. **Production without provisioning:** Completed registration and enforcement leave production Changelog scope issuance disabled; direct database grants cannot bypass the activation setting.
- AE8. **Dynamic MCP client:** A dynamic client receives a Changelog scope only when it requests an exact Changelog MCP resource and the user has a matching grant for that resource's environment.
- AE9. **Conflicting target:** A production seeded client requesting the local MCP resource, or a dynamic client requesting Changelog scopes without a Changelog resource, fails closed.
- AE10. **Grant changes during token lifecycle:** A grant reduced or revoked before code exchange or refresh rejects the stale code or refresh token; a later grant expansion does not enlarge an existing token family.
- AE11. **Provider side-effect safety:** Invalid PKCE, redirect, client, or resource input and grant-policy rejection create no access, refresh, or ID token. Better Auth owns code consumption and all resource persistence; Changelog code never repairs or rewrites provider state.
- AE12. **Independent agent clients:** Codex and Claude each establish a distinct runtime client identity through their actual DCR or CIMD path, complete resource-aware human consent, connect to local Changelog MCP, force and observe refresh, reconnect, and retain only grant-allowed scopes.

### Scope Boundaries

- Preview and staging registration remain deferred until Changelog has a stable preview deployment and callback domain.
- A new Auth grant-provisioning workflow is deferred; this slice may consume a future supported mechanism but must not use direct database edits as the production operating model.
- Better Auth dependency and protected-resource schema changes are owned exclusively by feat-401. This plan adds no custom authorization-code parser, record rewrite, resource CAS channel, or second token issuer.
- Changelog token/session validation, entry ownership, entry editing or deletion, product administration, and MCP tool implementation remain in the Changelog repository.
- Firebase authentication, email allowlists, shared cookies, confidential clients, and unrelated Auth dashboard redesign are excluded.

### Dependencies and Assumptions

- `https://changelog.jesusfilm.org` is the intended canonical production domain; no conflicting Forge definition was found.
- AppGrant and AppGrantScope already model user/application/environment/scope relationships, so no Prisma schema change is required for this slice.
- The first-party seeder is upsert-only and never prunes retired client rows. Removing a seed later is not client retirement.
- Better Auth remains the sole token issuer and the sole owner of authorization-grant resource persistence, PKCE/client validation, code consumption, and refresh resource ceilings.
- Existing access tokens remain valid until their current expiry unless revoked through existing token/session controls; grant changes are guaranteed at code exchange and refresh, not retroactively inside already-issued JWTs.
- Dynamic MCP clients may retain existing non-Changelog scopes such as `offline_access` only when their registration and provider policy already allow them. This plan adds no Changelog-specific refresh entitlement.
- Codex and Claude may use different loopback redirect and metadata shapes. Each must satisfy the provider's native public-client validation without wildcard redirects or client secrets.
- U3 real-client acceptance requires a runnable local Changelog MCP server from `JesusFilm/jfp-changelog` issue #71 at a recorded revision, with one permitted read tool and the exact local resource. If unavailable, feat-399 remains `in-progress` and U3 cannot complete.

### Outstanding Questions

**Deferred and non-blocking**

- Which supported operator surface will provision and revoke Changelog grants before production activation? This remains owned by feat-121/follow-up work.

### Sources and Research

- [JesusFilm/jfp-changelog issue #71](https://github.com/JesusFilm/jfp-changelog/issues/71) — upstream identity and access outcome; the Forge scope intentionally defers preview.
- `docs/roadmap/platform/feat-121-jesus-film-auth-platform.md` — Auth ownership of identity, app registrations, scopes, grants, tokens, and revocation.
- `docs/roadmap/platform/feat-399-changelog-first-party-auth.md` — Forge roadmap ticket for this bounded registration and enforcement slice.
- `apps/auth/AGENTS.md` and `apps/auth/CLAUDE.md` — Auth product boundaries, seed lifecycle, security posture, and validation commands.
- `docs/solutions/auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md` — relying applications keep local sessions and domain authorization.
- `docs/solutions/auth/auth-owned-agent-login-handles-for-local-preview-oauth-20260611.md` — current AppGrant creation and real-provider test precedent.
- `docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md` — first-party public-client and upsert-only seed lifecycle.
- `docs/solutions/architecture-patterns/oauth-grant-via-authorization-code-delivery-not-token-translation.md` — keep Better Auth as the only issuer and pin internal compatibility seams with real exchange tests.
- `docs/solutions/architecture-patterns/oauth-protected-mcp-tool-parity-pattern-20260721.md` — exact MCP audience and scope validation boundary.
- [Better Auth OAuth Provider documentation](https://better-auth.com/docs/plugins/oauth-provider) and 1.7.1 source — native resources, code/refresh persistence, and token behavior.
- `docs/plans/2026-08-20-1524-chore-better-auth-resource-upgrade-plan.md` — feat-401 prerequisite, selected version, migration, and native-resource proof.
- [Better Auth 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) and [GHSA-p2fr-6hmx-4528](https://github.com/better-auth/better-auth/security/advisories/GHSA-p2fr-6hmx-4528) — native resource model and security floor.
- [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html) — resource indicators and grant-bound resource expectations.
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) and [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html) — agent-client and protected-resource discovery contract.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Extend the closed registries; do not add a second registration path.** Add Changelog to the existing scope and first-party app catalogues so the generic upsert-only seeder continues to own Scope, RegisteredApp, AppEnvironment, and OauthClient rows. No Prisma migration is needed. Governs U1.
- KTD2. **Gate only the Changelog namespace.** Existing identity/membership scope behavior and every non-Changelog application remain unchanged. The new policy extracts requested `changelog:*` scopes, resolves the Changelog target, and intersects them with matching AppGrantScope rows. Governs U2.
- KTD3. **Use one trusted target resolver.** Seeded Changelog clients resolve through `AppEnvironment.clientId`; dynamic MCP clients resolve through an exact audience-to-environment map. When both signals exist, they must agree. Client-supplied metadata is never authoritative. Governs U1-U2.
- KTD4. **Downscope before native code creation and revalidate current grants at issuance.** Better Auth owns resource persistence, PKCE/client validation, code consumption, resource narrowing, and refresh ceilings. Changelog policy maps the provider-owned resource to one environment and never parses or mutates authorization-code JSON. Governs U2-U3.
- KTD5. **Treat native resources as admission, not authorization.** The exact local/production resource map admits a target; only the matching user/application/environment AppGrant union authorizes `changelog:*` scopes. Governs U1-U3.
- KTD6. **Consume feat-401 instead of upgrading here.** (session-settled: user-directed — chosen over a combined PR: the provider migration must be isolated from Changelog grant behavior.) U2/U3 start only from 1.7.1 on main with its native resource proof green. Governs U2-U3.
- KTD7. **Provisioning is an enforced launch gate.** Production activation defaults off until supported grant provisioning/revocation exists; registration, consent, dynamic-client metadata, and direct database edits cannot bypass it. Governs U1-U3.
- KTD8. **Require independent real agent clients.** (session-settled: user-directed — chosen over seeded-only MCP verification: engineers must connect their own Codex and Claude clients.) Each client receives a distinct registration and token family; browser authentication and consent remain human-only. Governs U3.
- KTD9. **Use `customAccessTokenClaims` as the Changelog-only pre-persistence grant gate.** Better Auth 1.7.1 resolves resource-scoped JWT claims before creating access or refresh rows. The callback uses the authenticated user, effective scopes, and provider-owned resources to invoke U2; dynamic client metadata remains non-authoritative. Focused source and real-database tests must prove this ordering for authorization-code and refresh grants. Governs U2-U3.
- KTD10. **Link dynamic clients to both admitted Changelog resources at registration.** Set the local and production identifiers as `clientRegistrationDefaultResources` because Codex/Claude may omit Better Auth's DCR `resources` extension. These links grant admission only; the exact authorization resource, AppGrant, consent, and production gate still authorize issuance. Governs U3.

### High-Level Design

```mermaid
sequenceDiagram
  participant Client as Web or MCP OAuth client
  participant Route as Auth catch-all route
  participant Policy as Changelog grant service
  participant DB as Auth database
  participant Provider as Better Auth provider

  Client->>Route: authorization request
  Route->>Policy: resolve target and effective changelog:* scopes
  Policy->>DB: load client, environment, and current grants
  Policy-->>Route: downscoped authorization request
  Route->>Provider: create native resource-bound authorization code
  Client->>Route: authorization_code or refresh_token request
  Provider->>Policy: expose provider-owned resource, user, scopes, and client context
  Policy->>DB: load current exact-tuple grants and activation gate
  alt target invalid, decision stale, or policy lookup fails
    Policy-->>Route: OAuth-compliant rejection
  else unchanged valid decision
    Policy-->>Provider: allow issuance within native resource/scope ceilings
    Provider-->>Client: provider-issued resource-bound tokens
  end
```

### Implementation Constraints

- Do not import from another app context or add Changelog domain rules to Auth.
- Do not alter the feat-401 provider schema or add Changelog-specific persistence unless implementation proves AppGrant fields are insufficient; if that occurs, stop and re-plan.
- Do not change any existing first-party seed values, grant behavior, dynamic Admin MCP scopes, or device-grant behavior.
- Changelog-aware issuance must use a provider callback or extension point proven to run before access and refresh token persistence; a post-issuance claim callback alone is insufficient.
- Do not mint, translate, or sign tokens outside Better Auth.
- Do not union grants across users, applications, or environments. Within the exact Changelog user/app/environment tuple, approved non-revoked grants are additive because the schema permits multiple rows.
- Reject policy database failures and malformed provider records before delegation. Errors must use OAuth-compatible envelopes/redirect behavior and must not expose user, grant, or scope inventory details.
- Preserve request `state`, PKCE, redirect URI, client authentication, consent, and resource fields while delegating protocol validation and persistence to Better Auth.
- Do not parse authorization codes, refresh tokens, provider hashes, or persisted provider JSON in Changelog policy code.
- Require exactly one canonical Changelog resource. Reject missing, unknown, duplicated, multiple, normalized, query/fragment, trailing-slash, or cross-environment variants.

### System-Wide Impact and Risks

- **Agent interoperability:** Codex and Claude can differ in loopback redirects and registration metadata. U3 proves each independently instead of treating a generic DCR test as product evidence.
- **Consent trust:** Dynamic metadata is attacker-controlled and may impersonate a familiar client. Human consent remains required, and prior consent for another resource or scope set cannot authorize Changelog.
- **Registration residue:** Abandoned dynamic clients may remain stored. Registration confers no grant, environment, consent, or production access; cleanup/rate limiting is follow-up unless provider controls regress.
- **Resource substitution:** Local-to-production or authorization-to-refresh substitution is a privilege-escalation path. Native provider widening rejection and the exact resource map are both load-bearing.
- **Grant lifecycle:** Revocation or reduction takes effect at exchange and refresh, while existing access tokens live until expiry unless separately revoked. Documentation must state this boundary.
- **Production activation:** The default-off flag prevents production `changelog:*` issuance at authorization, exchange, and refresh even when registration, consent, and AppGrant rows exist. Seeded clients may retain otherwise valid identity scopes; dynamic MCP authorization without `changelog:read` is denied.

### Sequencing

1. U1 remains the registration baseline and production gate.
2. Feat-401 completes on main and proves Better Auth 1.7.1 native resource binding.
3. U2 implements grant aggregation and provider-context decisions without provider-record parsing.
4. U3 wires those decisions into native authorization, exchange, and refresh, then proves Codex and Claude independently.

### Planning Confidence

- **High:** Registry, seeding, audience configuration, AppGrant persistence shape, absence of a supported production grant writer, and existing test conventions were verified directly in the repository.
- **High:** Better Auth 1.7.1 source and upstream tests prove authorization-code and refresh resource narrowing; feat-401 independently reproduces that contract in Forge before this plan resumes.
- **Medium:** Actual Codex and Claude callback/metadata shapes remain runtime interoperability evidence and are therefore explicit U3 smoke gates.

---

## Implementation Units

### U1. Register Changelog scopes, clients, and MCP audiences

- **Goal:** Preserve the completed deterministic Changelog registration with exactly the confirmed local and production environments.
- **Requirements:** R1-R9, R12-R13.
- **Dependencies:** None.
- **Modify:**
  - `apps/auth/src/domain/scopes.ts`
  - `apps/auth/src/domain/scopes.test.ts`
  - `apps/auth/src/domain/apps.ts`
  - `apps/auth/src/domain/apps.test.ts`
  - `apps/auth/src/scripts/seed-first-party-apps.test.ts`
  - `apps/auth/src/config/env.ts`
  - `apps/auth/src/config/env.test.ts`
- **Approach:** Preserve the three exact scopes, `CHANGELOG_APP_SEED`, local/production public clients, two exact MCP URLs, generic seeder inclusion, and strict default-off activation setting already implemented. Feat-401 owns their mechanical migration into native resources.
- **Execution note:** Verify this existing baseline idempotently. Do not reimplement or broaden it while starting U2.
- **Test Scenarios:**
  - All three scope keys are known and render the exact labels/descriptions.
  - Changelog has exactly `[local, production]`; no preview/staging entry exists.
  - Both clients have exact URLs and exact default scopes.
  - Both clients remain public, PKCE-required, secretless authorization-code clients after seeding.
  - Repeated seeding updates the same rows; expected totals become 9 apps, 31 environments, 35 OAuth clients, and 24 scopes.
  - Existing seeded client IDs remain globally unique and existing app fixtures are unchanged.
  - The existing U1 regression suite keeps each Changelog MCP URL exactly once; feat-401 separately proves their native resource rows before U2 starts.
  - Production activation defaults to disabled, accepts only the repository's supported boolean forms, and does not affect local or non-Changelog behavior.
- **Verification:** Focused domain, seeder, registry-policy, and environment tests pass before U2 begins.
- **Done When:** AE6 is proven without a schema migration or an existing-app diff.

### U2. Resolve Changelog grant context and effective scopes

- **Goal:** Produce one fail-closed Changelog grant decision from provider-owned resource, user, client, scope, and lifecycle context without issuing tokens or parsing provider records.
- **Requirements:** R10-R18, R21.
- **Dependencies:** U1 and completed feat-401 on main.
- **Modify:** `apps/auth/src/services/oauth-policy.service.ts` and its test.
- **Create:** `apps/auth/src/services/changelog-oauth-grant.service.ts` and its test.
- **Reference:** Better Auth 1.7.1 resource callbacks/extensions from feat-401, `apps/auth/src/services/token-policy.service.ts`, and `apps/auth/prisma/schema.prisma`.
- **Approach:**
  - Separate baseline scopes from `changelog:*` and aggregate allowed Changelog scopes across approved, non-revoked grants for one exact user/application/environment tuple.
  - Resolve seeded targets through persisted Changelog clients and dynamic targets through exactly one provider-validated local/production resource.
  - Treat dynamic registration metadata as display/bootstrap data only; it never selects application, environment, grant, consent posture, or production activation.
  - Return authorization-time downscoped scopes and issuance-time allow/deny decisions from native provider context. Never hash, decode, inspect, or mutate codes or refresh tokens.
  - Deny a dynamic MCP request when no `changelog:read` remains. Seeded web authorization may retain otherwise valid identity scopes.
- **Execution note:** Build the pure grant/resource decision table test-first before wiring any provider callback.
- **Test Scenarios:**
  - Covers AE1-AE4. No grant, reader, submitter, and administrator produce the exact Changelog bundles.
  - Pending, rejected, revoked, wrong-user, wrong-app, and wrong-environment grants contribute nothing.
  - Multiple matching approved grants are additive; unrelated grants are never unioned.
  - Static local/production targets succeed and conflicting seeded-client/resource environments fail.
  - Missing, unknown, duplicated, multiple, query/fragment, trailing-slash, normalized, and cross-environment resource variants fail closed.
  - Spoofed dynamic client name, URI, software metadata, and requested scopes never select a grant or bypass consent.
  - Authorization output preserves baseline-scope order, deduplicates Changelog scopes, and never widens the request.
  - Grant revocation/reduction rejects exchange or refresh; later expansion does not widen the original token family.
  - Production decisions fail while activation is disabled even with matching grants.
  - Missing users, malformed provider context, and database failures fail closed without secrets or grant inventory in errors/logs.
- **Verification:** Focused policy/service tests prove AE1-AE5 and AE8-AE10 across authorization, exchange, and refresh decision contexts.
- **Done When:** The service decides every Changelog-aware lifecycle boundary using only native provider context and AppGrant data.

### U3. Enforce policy at the provider boundary and prove the real exchange

- **Goal:** Make the Changelog policy load-bearing before Better Auth token side effects, then document the operational launch boundary.
- **Requirements:** R10-R22.
- **Dependencies:** U1-U2 and completed feat-401 on main.
- **Modify:**
  - `apps/auth/src/app/api/auth/[...all]/route.ts`
  - `apps/auth/src/app/api/auth/[...all]/route.test.ts`
  - `apps/auth/src/auth/config.ts`
  - `apps/auth/src/auth/config.test.ts`
  - `apps/auth/src/app/oauth/consent/page.tsx`
  - `apps/auth/src/app/oauth/consent/consent-page-client.tsx`
  - `apps/auth/src/app/oauth/consent/consent-page-client.test.tsx`
  - `apps/auth/docs/railway-deployment.md`
  - `apps/auth/.env.example`
  - `docs/roadmap/platform/feat-399-changelog-first-party-auth.md`
- **Create:**
  - `apps/auth/src/services/changelog-oauth-grant.integration.test.ts`
- **Approach:**
  - Intercept Changelog-aware authorization requests early enough to pass downscoped scopes and the exact native resource to Better Auth before code creation, including login and consent continuation.
  - Use Better Auth 1.7.1 `customAccessTokenClaims` as the Changelog-resource pre-persistence gate for authorization-code and refresh issuance. Prove its context, error mapping, and ordering before relying on it.
  - Link newly registered dynamic clients to both Changelog resources by default while requiring exactly one resource at authorization. Enable CIMD only if the tested Codex or Claude version selects it.
  - Render the canonical resource/environment and an unverified-dynamic-client label on consent. Require new consent when resource or Changelog scopes change.
  - Return policy denials in the provider's OAuth error shape and preserve no-store token-response headers.
  - Build a scratch-database integration test that uses native provider authorization, consent, code exchange, resource persistence, audience issuance, refresh, and token side-effect ordering.
  - Run independent local Codex and Claude connections with distinct dynamic client/token families through discovery, browser consent, MCP initialize/list/read, refresh, and reconnect.
  - Document native resources, the default-off production gate, lack of supported production grant mutations, preview deferral, and feat-401 dependency.
  - After every validation gate passes, mark feat-399 complete as an implementation ticket while leaving production activation visibly blocked by R12. Regenerate `docs/roadmap/README.md` under the repository's documented UTC convention.
- **Test Scenarios:**
  - Route policy is invoked only for Changelog-aware authorization/code/refresh requests; existing OAuth and device routes remain behaviorally unchanged.
  - Seeded S256 PKCE exchange succeeds without a client secret and returns only grant-allowed Changelog scopes.
  - Dynamic MCP exchange returns the exact authorization-bound resource audience; local-to-production substitution fails.
  - Wrong/missing/changed/multiple resource, environment conflict, missing/revoked grant, invalid provider inputs, and DB failure produce no new access, refresh, or ID token row.
  - While activation is disabled, production `changelog:*` scopes are removed or rejected at authorization, exchange, and refresh. Seeded identity scopes remain valid; dynamic MCP requests without `changelog:read` are denied.
  - Refresh preserves the original Changelog ceiling and fails after revocation.
  - Human consent denial and expired callback recover by restarting authorization; no provider record repair occurs.
  - Consent for local does not authorize production, and spoofed client display metadata remains visibly unverified.
  - DCR without a `resources` extension creates both admission links, but registration alone grants no Changelog scope or production access.
  - `customAccessTokenClaims` receives authenticated user, effective scopes, and provider-owned resources before token writes for code and refresh; its policy denial returns an OAuth error with zero new token rows.
  - Covers AE12. Codex and Claude each register, connect, call a permitted read, refresh/reconnect, and remain denied for an ungranted scope/tool.
  - Abandoned or repeated dynamic registrations confer no grant, consent, environment, or production access.
  - Existing Admin, Manager, Mastra Studio, Admin MCP, Web, Mobile, Chat, and TV regression tests remain green.
- **Verification:** Run the focused route/provider tests, the opt-in real-database integration test, then the full Auth test/typecheck/lint suite.
- **Done When:** AE7-AE12 are proven, both real clients connect independently, documentation names the production blocker, and all Auth validation passes.

---

## Verification Contract

### Focused Automated Checks

- Scope and registration catalogue:
  - `pnpm --filter @forge/auth test -- src/domain/scopes.test.ts src/domain/apps.test.ts src/scripts/seed-first-party-apps.test.ts src/config/env.test.ts`
- Grant policy and route boundary:
  - `pnpm --filter @forge/auth test -- src/services/oauth-policy.service.test.ts src/services/changelog-oauth-grant.service.test.ts 'src/app/api/auth/[...all]/route.test.ts'`
- Existing high-risk OAuth/device regressions:
  - `pnpm --filter @forge/auth test -- src/services/oauth-authorization-code.service.test.ts src/auth/device-grant-plugin.test.ts src/services/device-grant.service.test.ts`

### Real-Database Provider Proof

Using a scratch database with Auth migrations applied:

```bash
AUTH_TEST_DATABASE_URL=postgresql://forge:forge@localhost:5432/auth_it \
  pnpm --filter @forge/auth test -- changelog-oauth-grant.integration
```

The integration proof must cover a real provider-issued resource-bound token, authorization-time scope downscoping, provider-owned resource persistence, matching/omitted exchange, widening rejection, refresh re-evaluation, default-off production activation, and absence of token rows after policy rejection. Stop if the installed 1.7.1 extension surface cannot run grant revalidation before token persistence; do not add a record rewrite or second issuer.

### Real Agent Client Proof

- Record the tested Codex and Claude versions and whether each selects DCR or CIMD; do not assume both use the same MCP client identity protocol.
- Start from clean OAuth profiles and connect each client independently to the recorded local Changelog MCP revision.
- For each client, complete discovery/client identity, browser login/consent, S256 exchange, MCP initialize/list/read, forced access-token expiry through a test-only short local TTL, observed refresh rotation, and reconnect.
- Capture redacted evidence for distinct client ids, consent records, authorization resources, granted scopes, and token-family ids. Prove an ungranted scope/tool remains denied and a changed resource requires new authorization.

### Full Auth Gates

```bash
pnpm --filter @forge/auth test
pnpm --filter @forge/auth typecheck
pnpm --filter @forge/auth lint
```

### Documentation and Diff Gates

- Format every changed plan, roadmap, and Auth documentation file with the repository formatter.
- Regenerate `docs/roadmap/README.md` from raw ticket files with `TZ=UTC`; do not hand-edit generated status rows.
- Run `git diff --check`.
- Confirm no generated GraphQL artifacts, unrelated app files, Better Auth dependency versions, or lockfile entries changed in the Changelog PR.
- Review the final diff specifically for accidental changes to existing first-party seed literals and OAuth behavior.

### Security Review Gates

- Every Changelog grant query is bound to user, registered Changelog app, and resolved environment.
- Dynamic MCP environment selection comes only from an exact resource map.
- Authorization downscoping happens before code creation; exchange and refresh grant denial happen before new token persistence through the native provider extension surface.
- Refresh never widens original scopes and cannot switch environments/resources.
- Raw codes, refresh tokens, bearer tokens, grant details, and unnecessary PII never enter logs or OAuth error descriptions.
- Better Auth owns the exact resource from authorization through code, exchange, refresh, audience issuance, and introspection; Changelog policy code does not parse or mutate provider records.
- Dynamic client metadata, consent state for another resource, and registration residue never select a grant or production environment.

---

## Definition of Done

- U1 is complete: the three scope definitions, two exact first-party clients, and two exact MCP audiences are seeded and tested with no preview/staging registration.
- U2 is complete: direct and dynamic targets resolve through trusted signals, Changelog scopes are downscoped by exact AppGrant context, and refresh re-evaluates current grant state.
- U3 is complete: the policy is load-bearing before provider token side effects, the real 1.7.1 native-resource exchange passes, and all existing applications retain their behavior.
- Every requirement R1-R22 is covered by an automated assertion, documented rollout condition, or explicit Changelog-repository boundary.
- Acceptance examples AE1-AE12 pass at the appropriate unit, route, real-database, or real-client layer.
- Feat-401 is complete on main before U2/U3 implementation begins.
- Codex and Claude connect independently without seeded credentials, show fresh resource-aware consent, and retain exact-resource and grant ceilings through an observed refresh/reconnect.
- Full Auth test, typecheck, and lint gates pass; documentation is formatted; the diff is clean and scoped.
- Production Changelog scope issuance stays disabled by default until supported grant provisioning and revocation exist; no manual database procedure is presented as the solution.
- The roadmap ticket and generated index are updated only after implementation validation succeeds.
- No custom code-record rewrite, resource CAS channel, duplicate provider validation, parallel issuer, abandoned experiment, debug logging, or unrelated generated change remains in the diff.
