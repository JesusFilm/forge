---
title: "Better Auth Native Resource Upgrade - Plan"
type: "chore"
date: "2026-08-20"
topic: "better-auth-native-resource-upgrade"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
deepened: "2026-08-20"
---

# Better Auth Native Resource Upgrade - Plan

## Goal Capsule

- **Objective:** Forge Auth runs on a supported Better Auth release that natively binds OAuth resources from authorization through code exchange and refresh while preserving every existing Auth client and token flow.
- **Means:** Upgrade the coordinated Auth packages to 1.7.1, migrate provider persistence with rollback-compatible expansion, and replay a baseline-versus-target real-database contract matrix. (KTD1-KTD6)
- **Product authority:** This prerequisite protects existing production Auth behavior first. It enables, but does not implement, Changelog grant enforcement or production activation.
- **Stop conditions:** Stop if the target cannot preserve an existing client flow, if a production account issuer cannot be derived from trusted configuration, if native resource binding fails, or if rollback requires deleting production data.
- **Execution profile:** One isolated prerequisite PR for feat-401. Do not include Changelog U2/U3, new grant behavior, or direct Railway deployment.
- **Tail ownership:** The PR lands through the normal PR-to-main path. Production validation follows the existing Auth deployment path and an approved maintenance window.

---

## Product Contract

### Summary

Upgrade Forge Auth from Better Auth 1.6.2 to the coordinated 1.7.1 release. Preserve existing relying-client behavior and the custom device-grant bridge while adopting the provider's native protected-resource model. Prove the native resource contract before Changelog work resumes.

### Problem Frame

Better Auth 1.6.2 strips the RFC 8707 `resource` parameter from authorization requests. A token request can therefore add a resource that was never bound to the authorization grant. Better Auth 1.7.0 is the first stable release that fixes this chain; 1.7.1 adds immediate migration-safety and MCP error-response fixes.

The upgrade crosses identity persistence, OAuth provider persistence, client registration, token claims, introspection, route handling, and the custom TV device grant. A dependency-only change would risk silent production regressions.

<!-- ce-section: work-relationships -->

### How This Work Fits Together

- **Depends on:** feat-121's standalone Auth platform and current production behavior.
- **Blocks:** feat-399 Changelog grant enforcement and dynamic MCP activation.
- **Enables:** Forge can use provider-owned resource state instead of parsing or rewriting authorization-code records.
- **Separate work:** Changelog grant evaluation, Codex/Claude Changelog connectivity, supported grant operations, and production activation remain outside feat-401.

### Key Decisions

- **Upgrade in a separate prerequisite PR.** (session-settled: user-directed — chosen over a combined Changelog and framework change: production Auth risk must remain isolated.) Governs R1-R4, R20.
- **Use the provider's native resource model.** (session-settled: user-directed — chosen over a custom authorization-code rewrite or compare-and-set channel: exact grant binding must remain provider-owned.) Governs R5-R8, R21.
- **Preserve every existing client flow.** The upgrade may adapt schema and configuration but introduces no intentional relying-client behavior change. Governs R9-R19.

### Actors

- A1. **Existing Forge user:** Signs in through Admin, Manager, Mastra Studio, Web, Mobile, Chat, TV, or another seeded client.
- A2. **Existing service client:** Uses Manager client credentials or another current machine-token flow.
- A3. **Dynamic MCP client:** Registers as an untrusted public PKCE client and exercises the provider's native resource contract in compatibility tests.
- A4. **Auth operator:** Reviews migrations, schedules the production maintenance window, and validates the normal main-branch rollout.
- A5. **Forge Auth:** Preserves identity, session, token, claims, registration, introspection, revocation, and device-grant contracts.

### Requirements

**Version and scope**

- R1. Upgrade `better-auth`, `@better-auth/oauth-provider`, `@better-auth/prisma-adapter`, and `@better-auth/expo` in `apps/auth` together from 1.6.2 to exactly 1.7.1.
- R2. Treat 1.7.0 as the minimum feature floor and recheck official releases, deprecations, and relevant security advisories before installing 1.7.1.
- R3. Keep `apps/mobile` Better Auth packages at 1.6.2 unless peer resolution or a failing wire-compatibility test proves a coordinated mobile bump is required.
- R4. The PR contains no Changelog grant policy, activation, operator grant workflow, or custom token-issuance behavior.

**Native resource contract**

- R5. The provider accepts one exact RFC 8707 resource during authorization and persists it as provider-owned authorization-grant state.
- R6. Code exchange inherits the authorized resource when omitted and rejects any resource outside the authorized set with `invalid_target` before token persistence.
- R7. Refresh preserves the original resource ceiling, permits only the provider-defined same-resource or subset behavior, and rejects widening with `invalid_target`.
- R8. A real PostgreSQL test proves authorization, code persistence, exchange, access-token audience, refresh persistence, refresh replay, and introspection without custom record mutation.

**Existing Auth behavior**

- R9. Admin, Manager, Mastra Studio, Admin MCP, Web, Mobile, Chat, TV, Apple/social login, and the custom device grant retain their existing user-visible behavior.
- R10. Existing OAuth authorization-code hashing, JSON compatibility, PKCE S256 validation, redirect binding, code consumption, and millisecond `authTime` remain accepted.
- R11. Existing `jfp_at_`, `jfp_rt_`, and `jfp_cs_` prefix and hashing contracts remain valid for old and newly issued credentials.
- R12. Existing `referenceId`, custom claims, issuer, subject, audience, scope, `azp`, session, JWKS, UserInfo, introspection, revocation, and sign-out behavior remain covered by explicit assertions.
- R13. Existing dynamic registration remains available for unauthenticated public PKCE clients, with explicit token-auth method, application type, reciprocal grant/response types, exact redirect validation, and no secret.
- R14. Existing OAuth errors, HTTP status codes, redirect state/issuer parameters, cache headers, discovery documents, route aliases, and rate limits remain compatible unless the 1.7 standard envelope is required for security.
- R15. The custom TV device grant continues to deliver a provider-compatible authorization code and delegates token issuance to Better Auth.

**Persistence and delivery**

- R16. Add the 1.7 OAuth resource, client-resource, token-resource, consent-resource, client-classification, refresh-replay, requested-claims, and account-issuer schema required by the selected packages.
- R17. Backfill `Account.issuer` only from an explicit trusted provider mapping after collision checks; never derive it from request metadata, email, or user input.
- R18. Rehearse migration against both a fresh database and a production-shaped 1.6.2 database containing live-compatible clients, accounts, codes, tokens, consents, and device records.
- R19. Preserve rollback by using additive schema changes, retaining legacy OAuth-client fields and callback compatibility through the soak window, and leaving migrated schema in place during application rollback.
- R20. Production rollout occurs only through the normal PR-to-main deployment path with an approved Auth-write maintenance window, migration verification, health checks, and relying-client smoke tests.
- R21. Feat-399 U2/U3 remain blocked until feat-401 is complete on main and the native resource real-database gate passes.

### Key Flows

- F1. **Baseline capture and replay**
  - **Trigger:** The upgrade branch starts from 1.6.2.
  - **Steps:** Produce checked-in contract expectations and 1.6.2 database fixtures; migrate; replay the same flows on 1.7.1.
  - **Outcome:** Compatibility is measured against observed provider behavior rather than mocks.
  - **Covered by:** R9-R15, R18.
- F2. **Native resource proof**
  - **Trigger:** A dynamic public PKCE client requests resource A.
  - **Steps:** Authorize A; inspect provider-owned state; exchange with A or omit it; attempt B and A+B; refresh with A and B.
  - **Outcome:** Only the original grant or an allowed subset can issue tokens, and rejected paths create no token rows.
  - **Covered by:** R5-R8, R13.
- F3. **Production migration and rollback**
  - **Trigger:** The approved PR merges to main.
  - **Steps:** Enter the maintenance window; run the additive migration and backfills; start 1.7.1; verify; revert the application while retaining schema if rollback is required.
  - **Outcome:** Auth returns to a known-compatible runtime without destructive database rollback.
  - **Covered by:** R16-R20.

### Acceptance Examples

- AE1. A 1.6.2-shaped authorization code exchanges once on 1.7.1; a replay fails.
- AE2. Wrong PKCE, redirect, or client binding creates no access, refresh, or ID token.
- AE3. Authorization for resource A issues an A-bound token; exchange or refresh with B fails `invalid_target`.
- AE4. An existing no-resource client retains its current opaque-token and claim behavior.
- AE5. Manager's service audience moves to native resource configuration while its issued audience and client-credentials behavior remain unchanged.
- AE6. TV approval still creates one provider-compatible code, exchanges, refreshes, introspects, and preserves prefixes.
- AE7. A native public client with `token_endpoint_auth_method=none` and S256 PKCE registers with no secret; an omitted auth method does not silently become public.
- AE8. Trusted issuer backfill produces no `(issuer, accountId)` collisions and preserves every provider association.
- AE9. The 1.6.2 runtime starts against the expanded schema; resource-bound 1.7 refresh families are disabled or revoked before rollback.
- AE10. Changelog registration and resource rows may remain present from U1, but production scope issuance stays disabled and no grant behavior changes.

### Scope Boundaries

#### Included

- Coordinated `apps/auth` package upgrade, provider schema/backfills, required configuration/callback adaptations, existing-client compatibility, native-resource proof, and deployment/rollback documentation.

#### Deferred to Follow-Up Work

- Changelog grant enforcement and real Codex/Claude Changelog connections remain in feat-399.
- Destructive removal of legacy OAuth-client fields and old callback compatibility occurs only after a successful soak and a separate ticket.
- Supported Changelog grant provisioning and revocation remain owned by feat-121 or follow-up work.

#### Outside This Work

- Direct Railway deploys, adoption of Better Auth's new device plugin, new Changelog grants or activation, and unrelated Auth refactors.

### Sources and Research

- [Better Auth 1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide).
- [Better Auth 1.7.0 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.0) and [1.7.1 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.1).
- [GHSA-p2fr-6hmx-4528](https://github.com/better-auth/better-auth/security/advisories/GHSA-p2fr-6hmx-4528).
- [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html).
- `docs/solutions/architecture-patterns/oauth-grant-via-authorization-code-delivery-not-token-translation.md`.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Pin the Auth service to 1.7.1.** Version 1.7.0 is the feature floor; 1.7.1 is the first production target with immediate MCP and migration fixes. Upgrade all four `apps/auth` packages together. (Governs R1-R3.)
- KTD2. **Capture a 1.6.2 baseline before changing dependencies.** Replay the same assertions and production-shaped records after migration. (Governs R8-R15, R18.)
- KTD3. **Use native resources as the only audience authority.** Replace `validAudiences` and custom `aud` authorship while preserving each current audience. Do not disable per-client resource enforcement. (session-settled: user-directed — chosen over a compatibility rewrite or weakened resource gate: the provider must own exact resource binding.) (Governs R5-R8, R12-R13.)
- KTD4. **Use an expand-and-contract migration.** Add and backfill the 1.7 schema now; keep legacy OAuth-client columns and callback URIs through rollback. (Governs R16-R20.)
- KTD5. **Keep the custom device grant.** Adapt only its contained provider-compatibility seam and continue delegating issuance to Better Auth. (Governs R10-R12, R15.)
- KTD6. **Keep Changelog behavior dormant.** Migrate U1 audiences to native resource rows only as compatibility data and retain `AUTH_CHANGELOG_PRODUCTION_ENABLED=false`. (session-settled: user-directed — chosen over a combined upgrade and Changelog PR: Auth framework risk must land independently.) (Governs R4, R21.)

### High-Level Technical Design

```mermaid
flowchart TB
  Baseline[1.6.2 contract fixtures] --> Expand[Additive schema and trusted backfills]
  Expand --> Upgrade[Aligned Auth packages at 1.7.1]
  Upgrade --> Replay[Replay existing-client matrix]
  Upgrade --> Resource[Native resource-binding matrix]
  Replay --> Gate{All contracts pass?}
  Resource --> Gate
  Gate -->|yes| Merge[Normal PR to main]
  Gate -->|no| Stop[Stop before merge]
  Merge --> Verify[Migration, health, and client smoke]
  Verify -->|rollback| OldRuntime[1.6.2 runtime on expanded schema]
```

```mermaid
sequenceDiagram
  participant Client as Dynamic public PKCE client
  participant Auth as Better Auth 1.7.1
  participant DB as PostgreSQL
  Client->>Auth: authorize resource A
  Auth->>DB: store provider-owned code context with A
  Client->>Auth: exchange with A or omitted resource
  Auth->>DB: persist A-bound token family
  Client->>Auth: exchange or refresh with resource B
  Auth-->>Client: invalid_target; no new token rows
```

### Provider-Compatibility Inventory

- **Package/config:** `apps/auth/package.json`, `pnpm-lock.yaml`, `apps/auth/src/auth/config.ts` and its tests.
- **Persistence:** `apps/auth/prisma/schema.prisma`, migrations, and `apps/auth/src/scripts/seed-first-party-apps.ts`.
- **Code/device internals:** authorization-code service, device-grant plugin/service/client, and real-database device tests.
- **Registration/routes:** dynamic redirect service, consent, catch-all route, introspection/revocation aliases, and both discovery endpoints.
- **Claims/clients:** provider claims, JWKS, UserInfo, every seeded client, Manager service tokens, and relying-app OAuth/session parsers.
- **Identity providers:** credential, Google, Facebook, Apple, Okta, and JFP mobile self-provider account/callback paths.

### System-Wide Impact and Risks

- **Account identity:** `Account.issuer` backfill affects every password and social identity. Mitigate with a trusted provider map, collision preflight, write maintenance window, and migrated-database login tests.
- **OAuth persistence:** 1.7 adds resource and replay state to live code/token families. Mitigate with old-record fixtures, additive fields, and explicit old-runtime/new-runtime rehearsal.
- **Audience ownership:** Reserved `aud` moves from Forge custom claims to provider resources. Mitigate by inventorying every current audience and proving Manager service and MCP token audiences directly.
- **Client classification:** DCR defaults, application type, public posture, grant/response types, and client authentication become stricter. Mitigate with exact seeded and dynamic client metadata assertions.
- **Relying clients:** Generic OAuth callbacks, ID-token claims, UserInfo, session liveness, introspection, and revocation semantics change. Mitigate with one focused wire-contract suite per client class plus the real provider matrix.
- **Rollback:** 1.6.2 cannot enforce resource state carried by 1.7 refresh tokens. Mitigate by retaining schema/legacy fields and revoking or disabling resource-bound families before application rollback.
- **Operations:** Production stage configuration differs from the dashboard-owned production start command. Mitigate by documenting the existing authority and using only the normal PR-to-main deployment.

### Implementation Constraints

- Upgrade the Auth package family together; do not change scopes, approval, TTLs, grants, or relying-app policy.
- Do not use custom token issuance, authorization-code rewriting, weaker PKCE, wildcard redirects, or relaxed issuer validation.
- Add a reviewed forward migration; do not edit the initial migration or derive issuer from untrusted data.
- Retain legacy OAuth-client columns and the old JFP callback during the first production soak.
- Revoke or disable resource-bound 1.7 refresh families before a 1.6.2 rollback.
- Do not directly deploy or migrate production from a local checkout.

### Sequencing

1. U1 records the 1.6.2 baseline.
2. U2 expands and backfills persistence.
3. U3 upgrades packages and public configuration.
4. U4 adapts contained internal seams.
5. U5 proves native resources and replays provider behavior.
6. U6 verifies consumers and documents rollout.

---

## Implementation Units

### U1. Capture the 1.6.2 provider baseline

- **Goal:** Turn every current provider dependency into an executable compatibility contract.
- **Requirements:** R8-R15, R18.
- **Dependencies:** None.
- **Files:** `apps/auth/src/services/better-auth-upgrade.integration.test.ts` (create), authorization-code and device integration tests, Auth config tests, and catch-all route tests.
- **Approach:** Add checked-in expectations and fixture builders for current code, token, client, claim, route, and introspection behavior without storing raw credentials or production data.
- **Execution note:** Establish the passing 1.6.2 PostgreSQL baseline before changing the manifest or schema.
- **Test scenarios:** Valid and invalid code exchange; PKCE/redirect/client binding; prefixes and hashing; `referenceId`; `authTime`; Manager client credentials; DCR posture; claims; introspection/revocation; custom device exchange and refresh.
- **Verification:** The reusable baseline suite passes on 1.6.2 against scratch PostgreSQL.

### U2. Expand and backfill provider persistence

- **Goal:** Make production-shaped 1.6.2 data valid for 1.7.1 without destroying rollback compatibility.
- **Requirements:** R16-R20.
- **Dependencies:** U1.
- **Files:** `apps/auth/prisma/schema.prisma`, a new Better Auth 1.7 migration, first-party seeder/tests, and Auth deployment documentation.
- **Approach:** Diff the 1.7.1 generated Prisma schema, add required tables/columns, and backfill trusted issuers, application types, token-auth posture, client-credential scopes, and resource links. Keep legacy columns and callback data.
- **Execution note:** Rehearse fresh and production-shaped migrations before dependency installation proceeds.
- **Test scenarios:** Fresh and upgrade migration; idempotent seed; issuer coverage/collisions; legacy record readability; device-code and client-resource deduplication; 1.6.2 runtime on expanded schema.
- **Verification:** Both database shapes migrate cleanly and application rollback needs no down-migration.

### U3. Upgrade packages and public provider configuration

- **Goal:** Run Auth on aligned 1.7.1 packages with native resources and no intentional client behavior change.
- **Requirements:** R1-R4, R9, R12-R14, R16.
- **Dependencies:** U2.
- **Files:** `apps/auth/package.json`, `pnpm-lock.yaml`, Auth config/env/app registries and their tests.
- **Approach:** Align packages; replace `validAudiences` with native resources; move reserved `aud` behavior into resource policy; adapt DCR, generic OAuth/self-provider callbacks, account identity, claims callbacks, and removed options.
- **Test scenarios:** Exact current resource identifiers; unchanged legacy no-resource clients; unchanged Manager audience; explicit public DCR posture; S256/redirect validation; old/new JFP callback compatibility; default-off Changelog gate.
- **Verification:** Schema generation, seeding, typecheck, and focused provider configuration tests pass on 1.7.1.

### U4. Preserve provider-internal compatibility seams

- **Goal:** Keep the custom device grant and contained internal contracts compatible with the new provider.
- **Requirements:** R10-R12, R15, R19.
- **Dependencies:** U3.
- **Files:** Authorization-code service/test, device-grant plugin/test, device service/test, and device-client service/test.
- **Approach:** Compare 1.7.1 producer/consumer source with Forge's contained code builder. Add only compatible fields required for custom device codes. Keep provider issuance and TV policy unchanged.
- **Execution note:** Strengthen provider-shaped fixtures before making the smallest contained adaptation.
- **Test scenarios:** Hash vectors; JSON units/fields; invalid provider bindings with no token rows; device resource/grant denial; complete TV lifecycle.
- **Verification:** Focused device tests and the real provider device exchange pass on 1.7.1.

### U5. Prove native resources and provider compatibility

- **Goal:** Establish the merge gate with real PostgreSQL behavior across native resources and every Auth token path.
- **Requirements:** R5-R15, R18-R19.
- **Dependencies:** U4.
- **Files:** Better Auth upgrade integration test, device integration test, catch-all route test, and dynamic redirect test.
- **Approach:** Replay the 1.6.2 matrix on migrated data. Use a scratch native public client/resource to assert provider-owned persistence and side effects.
- **Execution note:** Treat the real-database resource test as a stop gate.
- **Test scenarios:** A persistence and matching/omitted exchange; B and A+B rejection; refresh ceiling/replay; legacy no-resource behavior; resource through login/consent continuation; discovery/DCR/token/introspection/revocation/UserInfo/error/cache contracts.
- **Verification:** The complete matrix passes on fresh and migrated databases with no custom resource persistence.

### U6. Verify consumers and document rollout

- **Goal:** Prove the provider upgrade is transparent to Forge clients and ready for the normal production rollout.
- **Requirements:** R9, R12-R15, R18-R21.
- **Dependencies:** U5.
- **Files:** Focused OAuth/session/token tests in Admin, Manager, Web, Chat, TV, and Mobile; Auth deployment docs; feat-401 and generated roadmap index.
- **Approach:** Run client wire-contract tests, full Auth gates, migration rehearsals, and the deployment checklist. Keep Mobile package pins unchanged unless R3's stop condition fires.
- **Test scenarios:** Each client parser/session flow; Mastra Studio/Admin MCP registrations; all identity provider account/callback paths; migration preflight; runtime rollback on expanded schema.
- **Verification:** Consumer checks, full Auth test/typecheck/lint/build, migration rehearsals, and PR-focused checks pass before merge.

---

## Verification Contract

### Version, schema, and real-database gates

```bash
pnpm --filter @forge/auth exec prisma validate
pnpm --filter @forge/auth exec prisma generate
pnpm --filter @forge/auth exec prisma migrate deploy
pnpm --filter @forge/auth seed:first-party-apps
AUTH_TEST_DATABASE_URL=postgresql://forge:forge@localhost:5432/auth_it \
  pnpm --filter @forge/auth test -- better-auth-upgrade.integration device-grant.integration
```

Run migration and seed gates against fresh and production-shaped scratch databases. Review the target package's generated schema before accepting the migration.

### Focused and full gates

```bash
pnpm --filter @forge/auth test -- src/auth/config.test.ts src/services/oauth-authorization-code.service.test.ts src/auth/device-grant-plugin.test.ts src/services/device-grant.service.test.ts src/services/device-client.service.test.ts src/services/dynamic-preview-redirect.service.test.ts src/scripts/seed-first-party-apps.test.ts 'src/app/api/auth/[...all]/route.test.ts'
pnpm --filter @forge/auth test
pnpm --filter @forge/auth typecheck
pnpm --filter @forge/auth lint
pnpm --filter @forge/auth build
```

Run the U6 consumer tests and typechecks for any touched consumer package. Require Tier-2 security, correctness, reliability, and data-migration review before push.

### Documentation, rollout, and rollback gates

- Regenerate `docs/roadmap/README.md` under `TZ=UTC`, format changed docs/code, and run `git diff --check`.
- Confirm dependency changes are limited to the aligned Auth package family and necessary transitive lockfile changes.
- Confirm no Changelog grant, activation, or U2/U3 code entered the diff.
- The PR-to-main deployment owns migration and seeding; do not run `railway up` or a manual redeploy.
- Schedule the account-issuer maintenance window and record redacted preflight results.
- Verify Auth health, discovery, representative login, token, refresh, introspection, Manager service token, and TV device flow after normal deployment.
- Roll back the runtime only, retain expanded schema, and revoke or disable resource-bound 1.7 token families before 1.6.2 resumes.

---

## Definition of Done

- U1-U6 are complete with observed verification evidence.
- Better Auth 1.7.1 is installed as an aligned `apps/auth` package set; `apps/mobile` remains independently pinned unless an approved expansion was required.
- Fresh and production-shaped databases migrate without loss, account issuers are trusted and collision-free, and old/new runtime compatibility is proven.
- The provider proves resource A persistence, matching/omitted exchange success, widening rejection, audience issuance, refresh preservation, and no rejected-path token side effects.
- Every existing Forge relying client and the custom device grant retain their approved behavior.
- Changelog production activation remains false and no Changelog grant behavior is introduced.
- Rollout and rollback use the normal PR-to-main path and documented maintenance procedure.
- Feat-401 is complete on main before feat-399 U2/U3 begins.
- No abandoned compatibility shim, custom resource persistence, raw credential fixture, destructive rollback, or unrelated dependency change remains.
