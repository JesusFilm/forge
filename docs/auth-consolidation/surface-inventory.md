---
date: 2026-05-22
topic: auth-consolidation-surface-inventory
origin: docs/roadmap/platform/feat-133-auth-consolidation-across-apps.md
---

# Auth Surface Inventory

This inventory supports
`docs/plans/2026-05-22-001-feat-auth-consolidation-plan.md` U1. It records
verified authentication and credential surfaces without storing raw secret
values. `apps/cms` / Strapi surfaces are cataloged only so they can be avoided
or retired in the Strapi sunset track; they are not candidates for migration
to Auth OAuth in this work.

## Disposition Key

| Disposition | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| Keep        | Existing surface remains appropriate for this ticket.                   |
| Convert     | Candidate for Auth-issued scoped service credential.                    |
| Replace     | Replace with another app contract before deletion.                      |
| Sunset      | Delete only as part of Strapi retirement or the owning migration track. |
| Verify      | Behavior should be smoke-tested or audited before final disposition.    |

## Human And Browser Session Surfaces

| Surface                                     | Owner          | Credential / Cookie                                                                                                | Receiver / Consumer                                                                      | Principal / Meaning                                   | Current Posture                                                                          | Disposition |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------- |
| Auth service session                        | `apps/auth`    | Better Auth-owned session cookies scoped to Auth origin                                                            | Auth login, consent, dashboard, OAuth provider routes                                    | Canonical Jesus Film identity session                 | Auth-owned; not shared with downstream apps                                              | Keep        |
| Admin OAuth local session                   | `apps/admin`   | `forge_admin_oauth_session` by default, configurable with `AUTH_COOKIE_PREFIX`; signed with `ADMIN_SESSION_SECRET` | Admin pages and GraphQL context via `resolvePrincipalFromRequest`                        | Admin `Principal` with editorial role                 | Host-local app session after Auth OAuth callback                                         | Keep        |
| Admin OAuth state/verifier/return cookies   | `apps/admin`   | `forge_admin_oauth_state`, `forge_admin_oauth_verifier`, `forge_admin_oauth_return_to`                             | Admin OAuth login/callback                                                               | PKCE/state and return target                          | Short-lived host-local OAuth flow cookies                                                | Keep        |
| Admin access-request cookie                 | `apps/admin`   | `forge_admin_oauth_access_request`                                                                                 | Admin access-request route                                                               | Pending Auth identity for request-access UX           | Host-local, signed, one-day max age                                                      | Keep        |
| Manager OAuth local session                 | `apps/manager` | `manager-session`, signed with `MANAGER_SESSION_SECRET`                                                            | Manager middleware, server components, API route helpers                                 | Manager session principal with `ManagerRole.OPERATOR` | Host-local session after Auth OAuth callback and Admin membership validation             | Keep        |
| Manager OAuth state/verifier/return cookies | `apps/manager` | `manager-oauth-state`, `manager-oauth-verifier`, `manager-oauth-return-to`                                         | Manager OAuth login/callback                                                             | PKCE/state and return target                          | Short-lived host-local OAuth flow cookies                                                | Keep        |
| Legacy Manager Strapi cookie                | `apps/manager` | `strapi-jwt`                                                                                                       | Explicitly cleared by Manager OAuth callback/logout; not sufficient for dashboard access | Legacy Strapi panel auth artifact                     | Must not grant Manager dashboard access                                                  | Sunset      |
| Manager mock session                        | `apps/manager` | Mock-mode signed Manager session using `MANAGER_MOCK_SESSION_SECRET`                                               | Manager mock/demo mode only                                                              | Local demo/test operator session                      | Valid only when `MANAGER_DATA_MODE=mock`; production auth env guard applies outside mock | Keep        |
| Web draft-mode preview                      | `apps/web`     | Next.js draft mode cookie gated by `STRAPI_PREVIEW_SECRET`                                                         | `/api/preview`                                                                           | Preview-mode browser state                            | Strapi-era preview entry point retained after web data flip                              | Sunset      |
| Web language preference                     | `apps/web`     | `LANGUAGE_PREFERENCE_COOKIE`                                                                                       | Web proxy and client helpers                                                             | Locale redirect preference, not auth                  | Not an auth credential                                                                   | Keep        |

## Auth-Owned App And Token Surfaces

| Surface                                    | Owner                                     | Credential / Config                                                                                       | Receiver / Consumer                                  | Principal / Meaning                                     | Current Posture                                                                  | Disposition |
| ------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------- |
| Admin OAuth client                         | `apps/auth` + `apps/admin`                | Auth app registration, `AUTH_ISSUER_URL`, `AUTH_ADMIN_CLIENT_ID`, optional `AUTH_ADMIN_CLIENT_SECRET`     | Admin OAuth login/callback                           | Human Admin relying-client access                       | Seeded as first-party app with `admin:access`                                    | Keep        |
| Manager OAuth client                       | `apps/auth` + `apps/manager`              | Auth app registration, `AUTH_ISSUER_URL`, `AUTH_MANAGER_CLIENT_ID`, optional `AUTH_MANAGER_CLIENT_SECRET` | Manager OAuth login/callback                         | Human Manager relying-client access                     | Seeded as first-party app with `manager:access`                                  | Keep        |
| Auth token policy                          | `apps/auth`                               | Token policy service with `user_delegated` and `client_credentials` families                              | Auth OAuth token issuance, introspection, revocation | Scoped, audience-bound, environment-bound token posture | Existing policy checks known scopes, expiry, audience, and family constraints    | Keep        |
| Auth upstream identity provider secrets    | `apps/auth`                               | Google, Facebook, Apple, Okta client secrets                                                              | Auth Better Auth providers                           | Upstream SSO identity                                   | Auth-owned; not consumed by downstream apps                                      | Keep        |
| Firebase lazy migration credentials        | `apps/auth`                               | Firebase web/admin credentials                                                                            | Auth migration fallback                              | Existing user migration path                            | Auth-owned migration bridge; public signup must remain blocked                   | Keep        |
| Future Manager -> Admin service credential | `apps/auth`, `apps/admin`, `apps/manager` | Auth-issued client-credentials token                                                                      | Admin `/api/manager/session`                         | Manager service calling Admin membership validation     | Planned first conversion slice; legacy bearer remains dual-accept during rollout | Convert     |

## Admin Service And Bearer Surfaces

| Surface                                 | Owner                                  | Credential / Config                                                   | Receiver / Consumer                                             | Principal / Meaning                                        | Current Posture                                                                  | Disposition |
| --------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------- |
| Admin GraphQL workflow bearer           | `apps/admin`                           | `WORKFLOW_API_KEYS` env CSV                                           | Admin GraphQL context and selected route handlers               | `WORKFLOW_TRIGGER` principal with narrow allowlist         | Internal bounded caller set; boot-time disjointness checked against sibling CSVs | Keep        |
| Admin workflow route HMAC/bearer family | `apps/admin`                           | `WORKFLOW_API_KEYS`, `WORKFLOW_HMAC_SECRET`                           | `/api/workflows/[...workflow]`                                  | Durable workflow callback / trigger protection             | Internal callback semantics with separate replay concerns                        | Keep        |
| Admin consumer bearer                   | `apps/admin`; caller mostly `apps/web` | `WEB_ADMIN_API_KEYS` env CSV                                          | Admin GraphQL context                                           | `CONSUMER_BEARER` rate-limit bucket, no permissions        | Internal SSR rate-limit identity; disjointness checked                           | Keep        |
| Admin Manager backend bearer            | `apps/admin`; caller `apps/manager`    | Receiver: `MANAGER_ADMIN_API_KEY`; caller: `ADMIN_MANAGER_API_KEY`    | Admin `/api/manager/session` and Manager backend contracts      | `MANAGER_BACKEND` / Manager service membership validation  | Narrow internal service key, but human-adjacent and single receiver              | Convert     |
| Admin backup download bearer            | `apps/admin`                           | `BACKUP_DOWNLOAD_API_KEYS` env CSV                                    | `/api/internal/video-db-backups/presign`                        | Authorizes signed backup download URL issuance             | Narrow internal surface; disjointness checked                                    | Keep        |
| Admin search partner key                | `apps/admin`                           | DB-backed `PartnerApiKey` token shape, hashed at rest                 | Admin `/api/search` and `Query.search` passport composer        | External/partner search caller                             | DB-backed with key id, revocation, and audit metadata                            | Keep        |
| Admin search known-caller passport      | `apps/admin`                           | Composes partner key, consumer bearer, workflow bearer                | `/api/search` and `Query.search`                                | Known-caller read/search access when auth gate is required | Passport only, not permission or budget; excludes backup keys                    | Keep        |
| Admin core sync scheduled secret        | `apps/admin`                           | `CORE_SYNC_CRON_SECRET`                                               | `/api/core-sync/scheduled`                                      | Scheduled Core sync trigger                                | Internal scheduler secret                                                        | Keep        |
| Admin Core API token                    | `apps/admin`                           | `CORE_API_TOKEN`                                                      | Core API client                                                 | Upstream Core API access                                   | Third-party/upstream service credential, not Auth-owned                          | Keep        |
| Admin -> Manager trigger key            | `apps/admin`; receiver `apps/manager`  | Caller: `MANAGER_TRIGGER_API_KEY`; receiver: `ADMIN_TRIGGER_API_KEYS` | Manager `/api/admin-trigger/*`                                  | Admin service asks Manager to produce artifacts            | Internal cross-app trigger; receiver-first deployment documented                 | Keep        |
| Manager -> Admin embed trigger key      | `apps/manager`; receiver `apps/admin`  | Caller: `ADMIN_EMBED_TRIGGER_API_KEY`; receiver: `WORKFLOW_API_KEYS`  | Admin GraphQL embed trigger mutations and video metadata lookup | Manager service trigger via `WORKFLOW_TRIGGER`             | Internal bounded surface                                                         | Keep        |
| Admin -> Web revalidation key           | `apps/admin`; receiver `apps/web`      | Caller: `WEB_REVALIDATE_TOKEN`; receiver: `REVALIDATION_SECRET`       | Web `/api/revalidate`                                           | ISR revalidation webhook                                   | Internal webhook; web also accepts legacy Strapi header                          | Keep        |
| Admin external API provider keys        | `apps/admin`                           | OpenRouter, OpenAI, Algolia, S3 credentials                           | Provider clients                                                | Third-party API access                                     | Not identity/auth consolidation surface                                          | Keep        |

Admin receiver validators verified during inventory:
`isValidWorkflowBearer`, `isValidManagerBearer`, `isValidConsumerBearer`, and
`isAnyKnownBearer`.

## Manager Service And Bearer Surfaces

| Surface                              | Owner                                 | Credential / Config                                      | Receiver / Consumer                               | Principal / Meaning                                             | Current Posture                                                                        | Disposition |
| ------------------------------------ | ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------- |
| Manager interactive auth helper      | `apps/manager`                        | `manager-session` cookie or `MANAGER_API_KEY` bearer     | Manager API route helpers                         | Interactive operator or service actor depending on helper       | Some routes still allow `MANAGER_API_KEY`; human dashboard uses session                | Verify      |
| Manager service-only bearer helper   | `apps/manager`                        | `MANAGER_API_KEY`                                        | Manager service-only routes                       | Service caller                                                  | Shared external/internal API key; used by CMS automations and fallback artifact access | Verify      |
| CMS -> Manager automation bearer     | `apps/cms`; receiver `apps/manager`   | Caller and receiver share `MANAGER_API_KEY`              | Manager automation enqueue / API surfaces         | CMS scheduler dispatch to Manager                               | Strapi-dependent service surface                                                       | Sunset      |
| Manager -> Admin session validation  | `apps/manager`; receiver `apps/admin` | `ADMIN_MANAGER_API_KEY`                                  | Admin `/api/manager/session`                      | Manager service validates Auth subject against Admin membership | First planned Auth-issued service credential conversion                                | Convert     |
| Manager -> Admin GraphQL/backend key | `apps/manager`; receiver `apps/admin` | `ADMIN_MANAGER_API_KEY` with `ADMIN_GRAPHQL_URL`         | Admin Manager read/job contracts                  | Manager backend service                                         | Same key family as session validation in current docs                                  | Convert     |
| Manager -> Admin embed trigger key   | `apps/manager`; receiver `apps/admin` | `ADMIN_EMBED_TRIGGER_API_KEY`                            | Admin GraphQL trigger mutations and lookup routes | Manager service trigger                                         | Internal bounded surface                                                               | Keep        |
| Admin -> Manager trigger keyring     | `apps/manager`; caller `apps/admin`   | `ADMIN_TRIGGER_API_KEYS`                                 | Manager `/api/admin-trigger/*`                    | Admin service trigger accepted by Manager                       | Internal bounded CSV; returns 503 when not configured                                  | Keep        |
| Manager Strapi data tokens           | `apps/manager`; receiver `apps/cms`   | `STRAPI_API_TOKEN`, optional `STRAPI_INTERNAL_API_TOKEN` | Strapi GraphQL / writer paths                     | Manager reads/writes legacy CMS data                            | Strapi dependency, not Auth migration target                                           | Sunset      |
| Manager workflow provider key        | `apps/manager`                        | `WORKFLOW_API_KEY`                                       | useworkflow provider                              | Workflow runtime credential                                     | Third-party/runtime credential, not Auth consolidation target                          | Keep        |
| Manager external API provider keys   | `apps/manager`                        | Mux, OpenRouter, ElevenLabs, S3 credentials              | Provider clients                                  | Third-party API access                                          | Not identity/auth consolidation surface                                                | Keep        |

## Web, Mobile, And TV Consumer Surfaces

| Surface                     | Owner                                       | Credential / Config                                                                       | Receiver / Consumer  | Principal / Meaning                                   | Current Posture                                      | Disposition |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------- | ---------------------------------------------------- | ----------- |
| Web -> Admin GraphQL bearer | `apps/web`; receiver `apps/admin`           | `WEB_ADMIN_API_KEYS` first CSV entry                                                      | Admin GraphQL        | `CONSUMER_BEARER` rate-limit identity, no permissions | Server-only; must never reach client bundle          | Keep        |
| Web revalidation receiver   | `apps/web`; callers Admin and legacy Strapi | `REVALIDATION_SECRET`; accepts `Authorization: Bearer` and legacy `x-revalidation-secret` | `/api/revalidate`    | Web ISR revalidation authorization                    | Dual header shape retained for legacy Strapi emitter | Sunset      |
| Web preview secret          | `apps/web`; caller Strapi preview handler   | `STRAPI_PREVIEW_SECRET`                                                                   | `/api/preview`       | Enables Next draft mode                               | Strapi-era preview surface                           | Sunset      |
| Mobile Strapi bearer        | `apps/mobile`; receiver `apps/cms`          | `EXPO_PUBLIC_STRAPI_TOKEN`                                                                | Strapi GraphQL       | Optional bundled read token                           | Client-visible Strapi dependency                     | Sunset      |
| TV Strapi bearer            | `apps/tv`; receiver `apps/cms`              | `EXPO_PUBLIC_STRAPI_TOKEN`                                                                | Strapi GraphQL       | Optional bundled read token                           | Client-visible Strapi dependency                     | Sunset      |
| Mobile/TV GraphQL URLs      | `apps/mobile`, `apps/tv`                    | `EXPO_PUBLIC_GRAPHQL_URL*`                                                                | Strapi GraphQL today | Content API endpoint, not credential                  | Strapi data dependency                               | Sunset      |

## CMS / Strapi Native Surfaces

| Surface                        | Owner                           | Credential / Config                                                                                     | Receiver / Consumer                          | Principal / Meaning                        | Current Posture                       | Disposition |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------ | ------------------------------------- | ----------- |
| Strapi admin secrets           | `apps/cms`                      | `APP_KEYS`, `ADMIN_JWT_SECRET`, `JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT`, `ENCRYPTION_KEY` | Strapi runtime/admin/API token system        | Native Strapi auth and signing             | Do not migrate to `apps/auth`         | Sunset      |
| Strapi internal API token seed | `apps/cms`                      | `STRAPI_INTERNAL_API_TOKEN`                                                                             | Strapi bootstrap/API token store             | Internal full-access Strapi API token seed | Native Strapi token lifecycle         | Sunset      |
| Strapi API token middleware    | `apps/cms`                      | Bearer validated against Strapi API token store                                                         | Custom CMS routes using `api-token-auth`     | Strapi API token caller                    | Native Strapi auth extension          | Sunset      |
| Strapi admin-auth middleware   | `apps/cms`                      | Bearer validated through Strapi admin internals                                                         | CMS custom routes using `admin-auth`         | Strapi admin-authenticated caller          | Native Strapi admin auth              | Sunset      |
| CMS -> Manager automation key  | `apps/cms`                      | `MANAGER_API_KEY`                                                                                       | Manager automation enqueue                   | CMS scheduler service caller               | Strapi-dependent dispatcher           | Sunset      |
| CMS preview secret             | `apps/cms`; receiver `apps/web` | `PREVIEW_SECRET` / web `STRAPI_PREVIEW_SECRET`                                                          | Web `/api/preview`                           | Editor preview redirect authorization      | Strapi preview integration            | Sunset      |
| CMS revalidation secret        | `apps/cms`; receiver `apps/web` | `REVALIDATION_SECRET`                                                                                   | Web `/api/revalidate` legacy header          | Content-change webhook authorization       | Legacy emitter still supported by web | Sunset      |
| CMS data snapshot secret       | `apps/cms`                      | `DATA_SNAPSHOT_SECRET`, `PROD_DATA_SNAPSHOT_SECRET`                                                     | CMS data snapshot endpoints / import tooling | Snapshot export/import authorization       | Native CMS operational secret         | Sunset      |

## Scripts, CI, And Development Helpers

| Surface                             | Owner                | Credential / Config                         | Receiver / Consumer                   | Principal / Meaning                   | Current Posture                                | Disposition |
| ----------------------------------- | -------------------- | ------------------------------------------- | ------------------------------------- | ------------------------------------- | ---------------------------------------------- | ----------- |
| Admin trigger-enrichment CLI bearer | `apps/admin`         | `WORKFLOW_API_KEY` caller-side value        | Admin GraphQL via `WORKFLOW_API_KEYS` | CLI mints `WORKFLOW_TRIGGER`          | Internal operator CLI                          | Keep        |
| Admin backup download caller key    | `apps/admin` scripts | `BACKUP_DOWNLOAD_API_KEY`                   | Production Admin presign route        | Non-production backup download caller | Single caller-side key matching production CSV | Keep        |
| Test placeholder secrets            | Multiple apps        | Values set in `vitest.setup.ts` / `.env.ci` | Test runtime only                     | Placeholder credentials               | Not deploy credentials                         | Keep        |

## Historical Grep Terms With No Live Surface Found

The roadmap ticket asks implementers to grep legacy Manager Strapi login terms
as a regression check. During this inventory, no active surface row was found
for:

- `/api/auth/local`
- `/api/users/me`

If those terms reappear in `apps/manager`, treat that as a regression against
the Auth OAuth direction unless a later rollback note explicitly reintroduces
them.

## First-Slice Recommendation

Convert **Manager -> Admin session validation** first:

- It has one narrow receiver: `apps/admin/src/app/api/manager/session/route.ts`.
- It is human-adjacent, so Auth-issued audience/scope/expiry/revocation checks
  provide meaningful value.
- It already has a clear legacy fallback: Manager sends `ADMIN_MANAGER_API_KEY`;
  Admin validates `MANAGER_ADMIN_API_KEY`.
- It should run in dual-accept mode until stage/preview smoke proves the
  Auth-issued credential path.

Initial service scope candidate: `admin:manager-session:validate`.

Receiver validation must reject wrong issuer, wrong audience, wrong
environment, missing scope, expired token, and revoked token before legacy
bearer removal.

## Non-Goals For This Ticket

- Do not migrate Strapi admin login, Strapi API tokens, Strapi admin users, or
  Strapi GraphQL auth to `apps/auth`.
- Do not make `apps/cms` an OAuth/OIDC relying client.
- Do not remove Strapi data, schedulers, GraphQL consumers, or Manager job
  state here.
- Do not convert internal env-CSV bearers solely for consistency.
