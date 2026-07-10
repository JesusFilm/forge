---
title: "TV/mobile clients consume only public admin GraphQL queries (never editor-gated experiences)"
date: "2026-06-08"
last_updated: "2026-06-12"
category: "conventions"
module: "apps/tv consumer client + admin GraphQL auth boundary"
problem_type: "convention"
component: "authentication"
severity: "high"
applies_when:
  - "Wiring an admin GraphQL field into a TV/mobile/web client that ships with no end-user admin token"
  - "A client home or landing screen needs curated experience content"
  - "Adding a query to a client bundle where credentials would ship in the binary (EXPO_PUBLIC_* / NEXT_PUBLIC_*)"
  - 'Seeing "Not authorized to resolve Query.experiences" (or any editor-gated field) at client launch'
symptoms:
  - '"Not authorized to resolve Query.experiences" full-screen error at the TV home on launch'
  - 'A gated "Popular experiences" rail silently renders empty for the unauthenticated client'
root_cause: "missing_permission"
resolution_type: "code_fix"
tags:
  [
    tv,
    mobile,
    admin-graphql,
    authorization,
    auth-scopes,
    public-query,
    homepage-experience,
  ]
related_components: [apps/mobile, apps/web, packages/admin-graphql, apps/admin]
---

# TV/mobile clients consume only public admin GraphQL queries (never editor-gated experiences)

## Context

`apps/tv` (and `apps/mobile`, `apps/web`) reads from admin via `@forge/admin-graphql`. These consumer apps run **unauthenticated** — they ship with no end-user admin bearer token. (One narrow carve-out exists since 2026-06-12: a zero-permission consumer bearer scoped to the `Search` operation only — see the Related entry on fleet-client bearers.) Admin's GraphQL surface is split by Pothos `authScopes`:

- **Public** (`authScopes: { public: true }`): `experienceBySlug`, `watchSetting`, `videoBySlug`, and the other consumer-facing reads — anonymous callers see published content only. `search` is public-shaped but **policy-gated**: once admin's `SEARCH_AUTH_REQUIRED` is active it rejects anonymous callers, so clients present the operation-scoped consumer bearer for it.
- **Editor-gated** (`authScopes: { hasPermission: "read:experiences" }`, which resolves to the `VIEWER` tier and up): the list/by-id fields `Query.experiences` and `Query.experience(id:)`. These can surface unpublished/draft content, so they are intentionally not public.

The TV home had diverged from the mobile/web pattern: instead of rendering a single curated homepage Experience, it listed _every_ Experience as a launcher grid via `LIST_EXPERIENCES` (`Query.experiences`), and `SearchBrowse` showed a "Popular experiences" rail backed by the same gated field. **There is no public list-all-experiences query by design.**

## Guidance

**A consumer client (TV/mobile/web) must call only public admin queries.** Never wire an editor-gated field (`experiences`, `experience(id:)`) into a client bundle. When a screen needs curated experience content, resolve it through the public homepage-experience path that mobile/web already use:

1. Resolve the homepage Experience's slug from the public `watchSetting` query:

   ```ts
   // apps/tv/src/lib/queries.ts — mirrors apps/mobile
   export const GET_WATCH_SETTING = graphql(`
     query GetWatchSetting($locale: String!) {
       watchSetting(locale: $locale) {
         homepageExperience {
           slug
         }
       }
     }
   `)
   ```

2. Render that slug through the public `experienceBySlug` query (here via a shared `ExperienceRenderer` extracted from the detail screen, so the home and detail screens render an Experience identically and can't drift apart again):

   ```ts
   // apps/tv/app/index.tsx
   const { data } = useQuery(GET_WATCH_SETTING, { variables: { locale: "en" } })
   const homepageSlug = data?.watchSetting?.homepageExperience?.slug ?? null
   return <ExperienceRenderer slug={homepageSlug} header={homeHeader} />
   ```

`SearchBrowse`'s gated "Popular experiences" rail was removed; its Recent (local history) and Browse-topics (static list) rails need no query and work unauthenticated.

## Why This Matters

- **Admin's gate is deliberate, not a bug.** `experiences`/`experience(id:)` can return draft/unpublished content, so they require `VIEWER`+. `experienceBySlug` and `watchSetting` are `public: true` and only return published rows to anonymous callers — exactly what a consumer client should see. Calling the gated field from a public client is a correctly-rejected request, surfaced as `Not authorized to resolve Query.experiences`.
- **A client binary cannot hold a secret.** `EXPO_PUBLIC_*` (and `NEXT_PUBLIC_*`) vars are baked into the shipped bundle; "just add a token" trades a correctness bug for an extractable-credential security hole. The qualification (2026-06-12): a **zero-permission passport** (the `CONSUMER_BEARER` class) may ship in the binary because extraction yields rate-limit budget abuse, not data access — and even then only operation-scoped to the policy-gated `Search`, never globally (global attachment pools the whole fleet into one `consumer:<key>` rate-limit bucket), with production provisioning embargoed until admin lands fleet-aware bucketing. A _permission-bearing_ token in a client bundle remains categorically wrong.
- **Parity is structural.** Mobile and web already do home = `watchSetting` → `experienceBySlug`. Converging TV onto the same path gives one cross-platform mental model, and the shared `ExperienceRenderer` enforces it so home and detail can't diverge again.

## When to Apply

- Before wiring any admin field into a TV/mobile/web client, **check its `authScopes` in `apps/admin/src/graphql/types/*.ts`**. Use it only if `{ public: true }`. If it's `{ hasPermission: "..." }`, resolve the permission in `apps/admin/src/auth/permissions.ts`; anything above `PUBLIC` is off-limits to a consumer client.
- When a client screen seems to need a gated list, the fix is a data-model change (a curated single Experience, a slug-based fetch, a public setting), **not** an auth workaround — do not embed a token, and do not ask admin to de-gate an editor field.

## Examples

What didn't work, and why each was rejected:

| Rejected approach                                                                    | Why                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embed `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` in the client _to reach gated editor fields_ | `EXPO_PUBLIC_*` ships in the binary — an extractable admin credential. Security hole. (Distinct from the 2026-06-12 Search carve-out: that token is a zero-permission passport scoped to one policy-gated operation, not a permission workaround.) |
| Ask admin to expose a public list-all-experiences query                              | Undoes an intentional editor gate (drafts/unpublished) and blocks on another owner. The gate is correct; the client was wrong to call it.                                                                                                          |
| Keep the "list every experience" launcher UX                                         | The launcher _inherently_ requires the gated query. The home should be a curated single Experience, like mobile/web.                                                                                                                               |

**Regression guard** (`apps/tv/src/lib/queries.test.ts`) — serializes the home documents with graphql's `print` and asserts they use `watchSetting`/`experienceBySlug` and never reference the gated field:

```ts
it("does NOT touch the editor-gated Query.experiences", () => {
  expect(settingSdl).not.toMatch(/\bexperiences\b/)
})
```

## Related

- [Fleet-client bearer must be operation-scoped, never global](../architecture-patterns/fleet-client-bearer-must-be-operation-scoped-not-global.md) — the 2026-06-12 carve-out this convention now references: how mobile presents a zero-permission consumer bearer for the policy-gated `Search` operation without breaking the no-client-secret posture (and why `apps/tv` must adopt the same scoping before any token is provisioned for it).
- [Pothos public-widening: multi-layer coordination](../graphql/pothos-public-widening-multi-layer-coordination-20260511.md) — the **server-side** source of truth for which admin resolvers are public (`INTENDED_PUBLIC_RESOLVERS` + its server-side regression test). This convention is the **client-side corollary**: server widens a field to public; clients must consume only those.
- [Pothos relation ABAC filter required for nested types](../graphql/pothos-relation-abac-filter-required-for-nested-types.md) — why `experiences`/nested relations are ABAC/editor-gated (the gate this convention respects).
- [Mobile admin data-layer cutover pattern](../architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md) — the mobile peer of the same tokenless admin-graphql client posture; this convention covers TV + mobile.
- [Public watch URL two-segment contract](./public-watch-url-two-segment-contract-20260608.md) — sibling cross-app consumer contract in this category.
- [Expo TV platform setup + SDUI monorepo](../best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md) — the TV app's SDUI/dispatcher foundation that `ExperienceRenderer` plugs into.
- Fix commit: `205113c6` (branch `feat/tv-video-details-page`). Earlier sibling cause on the same screen: an `Experience.locales(locale:)` codegen drift (commit `acbfbc89`) — distinct from this auth gate.
