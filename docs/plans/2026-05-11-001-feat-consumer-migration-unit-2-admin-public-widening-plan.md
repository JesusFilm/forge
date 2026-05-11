---
title: "feat: consumer migration Unit 2 — admin PUBLIC widenings"
type: feat
status: completed
date: 2026-05-11
origin: docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md
---

# feat: consumer migration Unit 2 — admin PUBLIC widenings

## Summary

Widen four admin GraphQL surfaces to PUBLIC and add one new resolver so apps/web, apps/mobile, and apps/tv can read content anonymously from admin. Implementation lands as a single PR with four ordered commits — U1 (video reads + `Video.locales` publish filter), U2 (field-level field strip on `Experience`), U3 (reference data widening), U4 (new `watchSetting` resolver). Throughout the plan, the shorthand "U1/U2/U3/U4" refers to these four implementation units. The widening is coordinated at three layers per query (Pothos `authScopes`, service-layer `hasPermission` guard, permission matrix) so PUBLIC reads actually reach Prisma instead of 403-ing at the service guard. The Experience field strip uses field-level `authScopes` on the existing `Experience` type (Option A) plus a one-time nullability flip on the three non-nullable strip candidates so Pothos scope-auth can return `null` for anonymous callers without surfacing a GraphQL error — U2 therefore produces a small additive SDL diff (regen alongside U4's). The admin editor experience builder is unaffected (it reads Prisma directly); the admin dashboard's videos page goes through `services.video.list` but is already gated by its own SSR `requireSession()` check that survives the service-layer guard drop.

---

## Problem Frame

Admin's data plane has fully landed (R1-R5 of Nisal's playbook) but consumer apps still read from Strapi because the queries they need are not yet PUBLIC on admin. Unit 5's web canary (PR #915) proved the dual-read parity pipeline against `experienceBySlug` (admin's one already-PUBLIC query) and now sits in review. Every additional consumer route the migration reaches — homepage, watch-video, watch-video-by-slug — needs admin schema surfaces that are still gated at `VIEWER` tier or higher. Without those widenings sequenced, the migration cannot progress past the canary and Strapi keeps accreting feature work in `apps/web` that will need to be migrated later. (See origin: `docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md`.)

---

## Requirements

- R1. Anonymous (PUBLIC-tier) callers can read `videoBySlug(slug)`, `video(id)`, and `videos(limit, offset)` from admin's GraphQL endpoint. _(Origin Status section — enumerated admin-side prerequisites at brief lines 212-214; sequencing gate R10.)_
- R2. `Video.locales` returns only PUBLISHED rows for PUBLIC/VIEWER callers and all rows for EDITOR/ADMIN, mirroring the existing `Experience.locales` principal-aware filter. _(Security correctness — surfaced by drift research; not in origin.)_
- R3. Anonymous callers reading `Experience` do not see `ownerId`, `isTemplate`, `archivedAt`, `createdAt`, or `updatedAt`; they do see `id` and `locales`. EDITOR/ADMIN callers see all fields unchanged. _(Origin Status section — "explicit PUBLIC projection that strips internal fields (`ownerId`, `isTemplate`, internal timestamps)")_
- R4. Anonymous callers reading `ExperienceLocale` do not see `createdAt`, `updatedAt`, or `isHomepage`. _(Extends Origin's Experience strip set — `createdAt`/`updatedAt` surfaced by drift research; `isHomepage` added by Round 2 review as an editorial-state flag analogous to `Experience.isTemplate`.)_
- R5. Anonymous callers can read reference data — `languages`, `countries`, `keywords` — required by consumer homepage language pickers and search filters. _(Origin Status section "reference data" gap; the hidden 5th prereq surfaced by drift research.)_
- R6. A new `watchSetting` resolver returns the same shape apps/web consumes today from Strapi: `{ documentId, homepageExperience: ExperienceLocale, defaultTemplateExperience: ExperienceLocale }`. Confirmed against `apps/web/src/lib/content.ts:48-63`. _(Origin Status section — "homepage's `watchSetting` equivalent")_
- R7. The committed `apps/admin/schema.graphql` and `packages/graphql/src/admin-graphql-env.d.ts` are regenerated and committed alongside **each** SDL-affecting change: U2 (nullability flip on stripped fields) and U4 (new `WatchSetting` type + `watchSetting` query). `admin-schema-drift` CI passes for both. _(Origin R2a)_
- R8. The admin editor experience builder, dashboard, media library, revision history, and ops surfaces are not regressed by any of the widenings. Tests for editor flows continue to pass. The experience builder reads via Prisma directly; the dashboard's videos page reaches `services.video.list` through SSR (verified at `apps/admin/src/app/dashboard/live-data.ts:494`) but is already gated by `requireSession()` at the route layer, so dropping the service-method `hasPermission` guard does not weaken its overall auth posture. _(Operational invariant — verified by 4 prior research agents, drift confirmation, and the doc-review pass on this plan.)_
- R9. Service-layer `hasPermission` guards in `apps/admin/src/services/video.service.ts` are kept consistent with the Pothos resolver layer so widening one side is not silently a no-op blocked by the other. _(Defense-in-depth correctness; methodology precedent: `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`.)_
- R10. The plan does NOT change how anonymous IP rate-limit buckets are keyed. Bucket-key identity for consumer SSR traffic is deferred to U5b alongside admin-mode rendering — Unit 2 only opens the auth surface. _(Origin Outstanding Questions on rate-limit identity; explicit deferral.)_

**Origin actors:** A1 (Urim — sole owner of consumer + admin sides), A2 (web/mobile/TV end users), A3 (automated parity comparator from Unit 4).

**Origin flows:** F1 (per-route dual-read), F2 (per-route migration progression), F3 (rollback during canary or ramp).

**Origin acceptance examples:** AE4 (covers R10 — homepage stays in `strapi` mode until widenings exist; Unit 2 provides those widenings).

---

## Scope Boundaries

- Admin-mode rendering on the web canary route (U5b). Unit 2 only opens the PUBLIC surface; flipping the route to render from admin is U5b.
- Rate-limit identity decision for consumer SSR (per-app service bearer vs Redis prefix vs accepting the shared anonymous bucket). U5b.
- R18a numeric thresholds for parity-clean and fallback-removal windows. Defined by U7 runbook work.
- Admin editor UX changes. Editor reads via Prisma SSR; auth-scope changes do not affect it.
- Strapi decommission, `feat-022` kill switch, or apps/cms deletion. Downstream of full consumer cutover.
- New admin features unrelated to consumer migration.
- Rewriting `Video.locales` to use `Experience.locales`-style helper extraction. The inline `query` filter is a one-liner; deferring to a shared helper is premature until 3+ types need it.

### Deferred to Follow-Up Work

- **Runbook page for "admin PUBLIC widening" pattern** (`docs/solutions/graphql/admin-public-widening-pattern-NNNNNNNN.md`) — capture after implementation via `/ce-compound`. Covers the three-layer coordination, the SDL-drift blindness to `authScopes` (per `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md`), and the per-resolver-test discipline that takes the place of drift CI.
- **Per-app consumer identity for rate-limit bucket keys** — U5b. Documented gap surfaced by `docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md`.
- **PUBLIC widening for additional admin queries discovered by canary** — Origin Outstanding Questions notes the canary may reveal additional gaps (locale-fallback semantics, embedded-image URL handling, sensitive fields in block payloads). Add as new units to a future Unit 2b if the canary surfaces them.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/graphql/types/experience.ts:92-99` — **the canonical principal-aware relation filter pattern.** `Experience.locales` uses an inline `query` callback that returns `{ where: { status: "PUBLISHED" } }` for non-privileged callers and `{}` for EDITOR/ADMIN. Unit 2 mirrors this pattern on `Video.locales`. Single source of truth — do not introduce a parallel helper.
- `apps/admin/src/graphql/types/experience.ts:149` — `experienceBySlug` is already `authScopes: { public: true }`. The PUBLIC field-strip (U2) sits on the _type_, not on this query — the query itself needs no change.
- `apps/admin/src/services/experience.service.ts:71` — `isPrivileged(user)` helper. Reuse for any service-side branching that depends on "is this caller EDITOR or above?" Do not invent a new role switch.
- `apps/admin/src/services/experience.service.ts:195-216` — `getBySlug` already does correct PUBLIC filtering (`status = PUBLISHED + archivedAt = null` for anonymous; everything for EDITOR/ADMIN). No service-layer change needed for `experienceBySlug`.
- `apps/admin/src/auth/permissions.ts:75-113` — permission matrix. `EDITORIAL_LADDER = ["PUBLIC", "VIEWER", "EDITOR", "ADMIN"]`. `read:reference` is already `"PUBLIC"` in the matrix even though the reference resolvers haven't consumed that key.
- `apps/admin/src/scripts/print-schema.ts:79-113` — `stripPothosDirectives` walker. Strips every `@authScopes` directive from the committed SDL via AST round-trip. **This is why field-level `authScopes` changes produce zero SDL diff.** Drift CI will not catch a misfired auth gate; per-resolver tests must.
- `apps/admin/src/graphql/plugins/rate-limit.ts:29-33` — anonymous bucket key is `public:${cf-connecting-ip}`. Unit 2 does not change this; flagging the consumer-SSR starvation risk for U5b.
- `apps/admin/src/app/api/graphql/route.ts:28-45` — Yoga CORS with fail-closed `corsOrigins.length > 0 ? {...} : false`. The Railway env var update (operational, not code) must preserve this fail-closed posture.

### Institutional Learnings

- `docs/solutions/graphql/pothos-relation-abac-filter-required-for-nested-types.md` — canonical precedent for U1's `Video.locales` filter. The Pothos Prisma plugin's `t.relation` does NOT consult scope-auth or service-layer ABAC; only an inline `query` callback gates relation rows.
- `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md` — explains why `authScopes`-only changes are invisible to `admin-schema-drift` CI (directives are stripped before commit). Per-principal resolver tests substitute for drift detection on auth widenings.
- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` — methodology precedent for U1's three-layer coordination (resolver + service guard + matrix). Unit tests at each layer pass independently while the seam between them is broken; integration tests on the route boundary catch the seam break.
- `docs/solutions/security-issues/yoga-cors-origin-undefined-allows-all-origins.md` — fail-closed CORS posture. Applies to the Railway env-var update (operational step).
- `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md` — reminder that `Origin` is a soft feature gate, not auth. The field-strip is gated on `authScopes` (resolver-side, principal-based), not on `Origin`.
- `docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md` — anonymous-IP rate-limit bucket starvation risk for consumer SSR. Out of scope for U2 (origin defers to U5b); flagged in Risks.

### External References

- None required. Pothos scope-auth, Pothos Prisma plugin, and Better Auth patterns are well-established in admin's existing code and `apps/admin/CLAUDE.md`. The widening uses the same shapes already shipped for `experienceBySlug` and the existing principal-aware `Experience.locales` filter.

---

## Key Technical Decisions

- **Resolver-level widening, not matrix flip.** Change `authScopes` on the three video root resolvers individually from `hasPermission: "read:videos"` to `public: true`. Do NOT change the matrix entry `read:videos: "VIEWER"` to `"PUBLIC"`. Rationale: the matrix entry is also consulted by `getByCoreId` in `video.service.ts:74-91`, which is called by Core sync internals via service-to-service paths. Widening the matrix would silently widen that path too. Resolver-level widening is narrower and explicit.

- **Service-layer guard removal at the video root paths.** `video.service.ts:23, 45, 64` currently call `hasPermission(user, "read:videos")` defense-in-depth. Drop those three guard lines — leave `getByCoreId:83` intact (Core sync internal, not exposed via GraphQL). Rationale: the resolver's `authScopes: { public: true }` is now the single auth contract; keeping a `VIEWER`-gated service guard would 403 anonymous callers after the resolver lets them through, making the widening a hidden no-op. Document this divergence in a code comment so future maintainers understand the two-layer story.

- **Field-level `authScopes` for Experience field strip (Option A) — with a coordinated nullability flip.** Add `authScopes: { hasPermission: "read:experiences" }` to `Experience.{isTemplate, ownerId, archivedAt, createdAt, updatedAt}` and `ExperienceLocale.{createdAt, updatedAt}`. **Plus flip the three currently-non-nullable fields to nullable in their Pothos type definitions: `Experience.isTemplate`, `Experience.createdAt`, `Experience.updatedAt`, `ExperienceLocale.createdAt`, `ExperienceLocale.updatedAt`.** Rationale: Pothos scope-auth's default behavior on a failed field-level scope is to throw `GraphQLError("Not authorized to resolve …")`. On a non-nullable field that error nulls the parent per the GraphQL spec — exactly the failure mode the U5 parity comparator would treat as an admin error rather than a stripped field. The builder at `apps/admin/src/graphql/builder.ts:82-101` does not install a custom `unauthorizedError` handler, so default behavior applies. Flipping the five fields to nullable is the minimum-change fix: anonymous callers get `null` silently, EDITOR/ADMIN get the value, no error surfaces. The SDL change is small and additive (a non-nullable field becoming nullable is forward-compatible for any consumer that already handled it as non-null). U2 therefore DOES produce an SDL diff (must regen `apps/admin/schema.graphql` + `packages/graphql/src/admin-graphql-env.d.ts`); plan-level "byte-identical SDL" claim updates accordingly. `schema.test.ts:207` (`arrayContaining`) stays green — fields are not removed, only marked nullable.

- **`Video.locales` filter mirrors `Experience.locales`.** Add an inline `query` callback to `Video.locales` matching the principal-aware shape at `experience.ts:92-99`. Anonymous and VIEWER callers see only `status: PUBLISHED`; EDITOR/ADMIN see all. Rationale: the relation has no filter today, which is harmless while gated at VIEWER but leaks DRAFT/ARCHIVED locale titles+descriptions once the root resolver opens to PUBLIC. The canonical fix per `docs/solutions/graphql/pothos-relation-abac-filter-required-for-nested-types.md`.

- **Reference data widening: resolver-level only.** Change `languages`, `countries`, `keywords` from `authScopes: { loggedIn: true }` to `authScopes: { public: true }`. The matrix already declares `read:reference: "PUBLIC"` but no resolver consumes that key today. Resolver-level widening brings the actual auth posture into agreement with the documented matrix intent — no matrix change needed.

- **`watchSetting` resolver: consumer-shape parity, read-only, public.** Define `Query.watchSetting(locale: String!): WatchSetting` returning `{ documentId: ID!, homepageExperience: ExperienceLocale, defaultTemplateExperience: ExperienceLocale }`. This exactly matches the shape apps/web consumes from Strapi today (`apps/web/src/lib/content.ts:48-63`), so the homepage migration can swap the data source with no consumer-side shape adaptation. Resolver reads from existing admin tables: `homepageExperience` is the `Experience` row whose locale matches `$locale` with `ExperienceLocale.isHomepage = true`; `defaultTemplateExperience` is the `Experience` row with `isTemplate = true` and an `ExperienceLocale` for `$locale`. No schema migration required — both `isHomepage` and `isTemplate` columns already exist on the data model. Rationale: shipping a v1 shape that doesn't match the consumer creates a placeholder under the same name and forces a second additive widening before the homepage can actually migrate; shape parity with the existing Strapi consumer is the only design that makes U4 a real prerequisite-unblocker.

- **No introspection on PUBLIC.** Admin's `@envelop/disable-introspection` posture stays. Anonymous callers cannot enumerate the schema; they must already know the query name (which they do — apps/web codegen has the SDL via dual-client).

- **U2 ships as a single PR with four ordered commits, not one mega-commit.** Each unit lands as one focused commit (`feat(admin): u2.1 video reads → public + Video.locales filter`, `u2.2 Experience field strip`, etc.). Rationale: single PR for review coherence and atomic merge; per-commit boundary preserves bisect-ability and gives `git revert <sha>` for surgical rollback of any single unit if production telemetry surfaces a regression.

- **Tests carry per-principal happy-path coverage.** Each widened query/relation gets at least: one PUBLIC test asserting the resolved shape (and that stripped fields are null/absent), one EDITOR test asserting full visibility, one DRAFT-data fixture test for `Video.locales` confirming anonymous doesn't see it. The four prior research agents confirmed no per-query auth tests exist today — this is the substitute for SDL-drift CI's blindness to `authScopes` widenings.

---

## Open Questions

### Resolved During Planning

- **Q: Single PR or staged across multiple PRs?** A: Single PR with four ordered commits (user decision).
- **Q: Option A field-level `authScopes` or Option B separate `PublicExperience` type for the field strip?** A: Option A (user decision).
- **Q: Should the matrix entry `read:videos: "VIEWER"` flip to `"PUBLIC"`?** A: No. Resolver-level widening only — see Key Technical Decisions for rationale.
- **Q: Should `Video.locales` filter ship in the same change?** A: Yes. The filter is correctness-critical the moment the root resolver opens to PUBLIC; deferring it would create a draft-leak hole for the duration between U1 ship and a follow-up.
- **Q: Should reference data widening be in U2 or deferred?** A: In U2 (U3 implementation unit). The brief lists it as required for consumer migration; drift research confirmed the resolver-vs-matrix inconsistency; widening is mechanically trivial.

### Deferred to Implementation

- **Locale-resolution semantics on `watchSetting`.** When no `ExperienceLocale` exists for the requested `$locale` on the homepage Experience, does the resolver return `null` (strict), fall back to a default locale (e.g., `en`), or fall back to the first available locale? Match what Strapi does today by inspecting `apps/cms`'s `watchSetting` resolver behavior during implementation. If Strapi has no clear fallback, default to strict (return `null`).
- **Multi-row homepage tiebreak.** If more than one Experience has `isHomepage = true` for the same locale (data anomaly), pick by `updatedAt DESC` and log a warning. Document the assumption in the service.
- **Whether to wire `WatchSetting` into the admin editor UI.** v1 ships read-only; the editor surface for managing the homepage/template flags is out of scope. Existing editor UI for managing `isTemplate` and `isHomepage` already exists (verified via earlier research) — no new editor work needed.

---

## Implementation Units

### U1. Widen video reads to PUBLIC + add `Video.locales` publish filter

**Goal:** Anonymous callers can resolve `video(id)`, `videoBySlug(slug)`, and `videos(limit, offset)` and receive only PUBLISHED VideoLocale rows through `Video.locales`.

**Requirements:** R1, R2, R9.

**Dependencies:** None.

**Files:**

- Modify: `apps/admin/src/graphql/types/video.ts` (3 root resolvers + `Video.locales` relation)
- Modify: `apps/admin/src/services/video.service.ts` (drop `hasPermission` guards in `list`, `getById`, `getBySlug`; keep `getByCoreId` intact)
- Test (new): `apps/admin/src/graphql/types/video.test.ts`
- Test (modify): `apps/admin/src/services/video.service.test.ts` (flip the two PUBLIC-throws-Forbidden assertions to expect resolution)

**Approach:**

- Change `authScopes: { hasPermission: "read:videos" }` to `authScopes: { public: true }` on the three root resolvers at `video.ts:309-352`.
- Add inline `query` callback to `Video.locales` (`video.ts:284-286`) mirroring `Experience.locales`' shape (`experience.ts:92-99`): for EDITOR/ADMIN return `{}`; for everyone else return `{ where: { status: "PUBLISHED" } }`. Reuse `isPrivileged()` if exported from the auth module; otherwise inline the `user?.role` check matching the existing pattern.
- Drop the `hasPermission(user, "read:videos")` defense-in-depth guards in `video.service.ts:23, 45, 64`. Leave the per-method TSDoc comment explaining that the resolver `authScopes` is now the single auth contract for these three methods. Keep `getByCoreId:83`'s guard intact (Core sync internal).
- Permission matrix at `apps/admin/src/auth/permissions.ts:80` is **not** changed.

**Patterns to follow:**

- `apps/admin/src/graphql/types/experience.ts:92-99` (principal-aware relation filter)
- `apps/admin/src/services/experience.service.ts:71` (`isPrivileged` helper)

**Test scenarios:**

- Happy path: PUBLIC (null user) calls `videoBySlug(slug: "jesus")` → resolves to a Video row whose locales contain only PUBLISHED rows; anonymous-readable fields (id, coreId, slug, label) populated.
- Happy path: PUBLIC calls `video(id: "<cuid>")` → resolves to the row; locales filter applied.
- Happy path: PUBLIC calls `videos(limit: 10, offset: 0)` → returns up to 10 rows with locale filtering.
- Edge case: PUBLIC requests `videos(limit: 0)` → empty array (existing Prisma behavior).
- Edge case: PUBLIC requests `videoBySlug(slug: "does-not-exist")` → null (existing Prisma behavior; resolver is `nullable: true`).
- Edge case: PUBLIC requests a video whose all locales are DRAFT → `Video.locales` resolves to `[]` (no leak).
- Privilege gate: EDITOR fixture calls `videoBySlug` → resolves with full locales including DRAFT/ARCHIVED.
- Privilege gate: ADMIN fixture calls `videos` → same.
- Integration: a PUBLIC call through the route handler at `/api/graphql` (POST with no Authorization header) returns 200 with non-null data and no `Forbidden` error in the response.
- Service test flip: `video.service.test.ts:38-42` and `:75-79` flip from "expects Forbidden" to "expects resolution returns rows".
- Regression: existing VIEWER/EDITOR/ADMIN happy-path tests in `video.service.test.ts` continue to pass.

**Verification:**

- `pnpm --filter @forge/admin test` passes including new test cases.
- `pnpm --filter @forge/admin typecheck` clean.
- Manually issuing `curl -X POST http://localhost:3003/api/graphql -d '{"query": "{videoBySlug(slug: \"jesus\") { id slug }}"}' -H "Content-Type: application/json"` against a seeded local DB returns 200 with data.
- `Video.locales` returns only PUBLISHED rows for an anonymous query against a fixture with mixed-status locales.

---

### U2. Field-level PUBLIC strip on `Experience` and `ExperienceLocale`

**Goal:** Anonymous callers see `null` for `ownerId`, `isTemplate`, `archivedAt`, `createdAt`, `updatedAt` on `Experience` and for `createdAt`, `updatedAt` on `ExperienceLocale`. EDITOR/ADMIN callers see full values unchanged.

**Requirements:** R3, R4, R7, R8.

**Dependencies:** None on U1 in terms of code execution order; can be reordered if reviewer prefers field-strip before video widening. **The nullability flip + `unauthorizedResolver` are not safely separable into a different PR from the `authScopes` addition** — the intermediate state where `authScopes` gates a non-nullable field with the default `unauthorizedResolver` produces a `GraphQLError` that nulls the parent object for anonymous callers, breaking `experienceBySlug` for the canary. All three changes (authScopes, nullability flip, unauthorizedResolver) ship in the same commit.

**Files:**

- Modify: `apps/admin/src/graphql/types/experience.ts` (add `authScopes` + `unauthorizedResolver` to 5 fields on `Experience`, 3 fields on `ExperienceLocale` including `isHomepage`; flip nullability on 6 non-nullable strip candidates)
- Modify: `apps/admin/schema.graphql` (regenerated — additive nullability diff on the 6 affected fields)
- Modify: `packages/graphql/src/admin-graphql-env.d.ts` (regenerated)
- Test (new or extend): `apps/admin/src/graphql/types/experience.test.ts`
- Test (no change expected): `apps/admin/src/graphql/schema.test.ts:207` (the `arrayContaining` assertion stays green because fields are not removed from the SDL, only field-level-gated and nullability-flipped)

**Approach:**

- Add `authScopes: { hasPermission: "read:experiences" }` + `unauthorizedResolver: () => null` to each of `Experience.isTemplate` (`experience.ts:84`), `Experience.ownerId` (`:85`), `Experience.archivedAt` (`:86-89`), `Experience.createdAt` (`:90`), `Experience.updatedAt` (`:91`).
- Add the same `authScopes` + `unauthorizedResolver: () => null` to `ExperienceLocale.createdAt` (`:64`), `ExperienceLocale.updatedAt` (`:65`), and **`ExperienceLocale.isHomepage` (`:41`)** — surfaced by Round 2 review as an editorial-state flag analogous to `Experience.isTemplate`; anonymous callers shouldn't be able to enumerate which experiences are homepage-flagged.
- **Flip nullability** on the currently-non-nullable strip candidates so the SDL signature permits the null return: `Experience.isTemplate`, `Experience.createdAt`, `Experience.updatedAt`, `ExperienceLocale.isHomepage`, `ExperienceLocale.createdAt`, `ExperienceLocale.updatedAt` all become nullable. The nullable fields `Experience.ownerId` and `Experience.archivedAt` already permit null — no signature change needed for them.
- **Why both `unauthorizedResolver` AND nullability flip:** Pothos scope-auth's default `unauthorizedResolver` is `(_root, _args, _context, _info, error) => { throw error; }` (verified in `node_modules/.pnpm/@pothos+plugin-scope-auth@4.1.6/.../resolve-helper.js:5-7`). The thrown `ForbiddenError` populates `response.errors[]` even on a nullable field — nullability alone only stops the error from cascading to null out the parent object; it does NOT silence the error in `errors[]`. The U5 parity comparator inspects both `data` AND `errors[]` per call, so a populated `errors[]` would contaminate the parity-clean signal. The per-field `unauthorizedResolver: () => null` overrides the throw, so anonymous callers get clean nulls and no entries in `errors[]`. The nullability flip is required because non-nullable fields cannot resolve to null in the GraphQL spec — both changes together produce the clean behavior.
- No service-layer change. No matrix change. No `experienceBySlug` resolver change (already `public: true`).
- Regenerate `apps/admin/schema.graphql` and `packages/graphql/src/admin-graphql-env.d.ts` in this commit. Both regenerated artifacts must be committed alongside the source change.

**Patterns to follow:**

- `apps/admin/src/graphql/types/experience.ts:92-99` — already an authScope-aware field/relation in this file
- Pothos scope-auth field-level gate semantics (per `apps/admin/CLAUDE.md` Permission system section)

**Test scenarios:**

- Happy path: PUBLIC calls `experienceBySlug(locale: "en", slug: "<published-slug>")` selecting `{ experience { id isTemplate ownerId archivedAt createdAt updatedAt locales { status } } }` → `experience.id` and `experience.locales` populated; `isTemplate`, `ownerId`, `archivedAt`, `createdAt`, `updatedAt` all `null`; **`response.errors` is empty** (the `unauthorizedResolver: () => null` overrides Pothos's default-throw and prevents `errors[]` from being populated).
- Happy path: same query with EDITOR fixture → all fields populated with real values; no errors.
- Edge case: PUBLIC calls `experienceBySlug` selecting only public-safe fields (`id`, `locales`) → no `authScopes` evaluation triggers; resolves cleanly with no errors.
- Field-strip ExperienceLocale: PUBLIC calls `experienceBySlug` selecting `{ experience { locales { id title isHomepage createdAt updatedAt } } }` → `isHomepage`, `createdAt`, `updatedAt` all `null` on each locale; `id` and `title` populated; no errors.
- Privilege gate: EDITOR calls `experienceBySlug` selecting `{ experience { locales { isHomepage createdAt updatedAt } } }` → all three fields populated.
- Privilege gate: WORKFLOW_TRIGGER fixture (bearer-key minted role; allowlisted to `write:scene-embeddings`/`write:transcript-embeddings`/`write:manager-enrichment-trigger` per `permissions.ts:174-186`) calls `experienceBySlug` selecting the stripped fields → returns `null` for stripped fields, no errors. **Documents the current contract:** WORKFLOW_TRIGGER is not on `read:experiences` allowlist today; if a future service-to-service caller needs full Experience fields, extend `WORKFLOW_TRIGGER_PERMISSIONS` deliberately rather than by accident.
- `errors[]` assertion: explicit `expect(response.errors).toBeUndefined()` (or empty array depending on harness) for every PUBLIC call selecting stripped fields. This is the load-bearing assertion that proves `unauthorizedResolver` is wired correctly. Without it the test could pass on data-equality while `errors[]` populates and the U5 parity comparator silently contaminates.
- SDL contract: snapshot or string-contains assertion confirming the 6 affected fields' SDL signatures are now nullable (`Boolean` not `Boolean!`, `String` not `String!`).
- Regression: `apps/admin/src/graphql/schema.test.ts` assertions stay green; the `arrayContaining` field list for `Experience` (`schema.test.ts:207`) still includes all field names.

**Verification:**

- `pnpm --filter @forge/admin test` passes.
- `pnpm --filter @forge/admin typecheck` clean.
- `pnpm --filter @forge/admin schema:print` writes the expected additive nullability diff (5 fields flipped from non-null to nullable). `pnpm --filter @forge/graphql generate` produces matching consumer-side type changes. Both regenerated artifacts committed alongside the source change. `admin-schema-drift` CI passes when both files are committed; fails if either is missing.

---

### U3. Widen reference data resolvers to PUBLIC

**Goal:** Anonymous callers can read `languages`, `countries`, and `keywords` for use in homepage language pickers and search filters.

**Requirements:** R5.

**Dependencies:** None. (Independent of U1 and U2.)

**Files:**

- Modify: `apps/admin/src/graphql/types/reference.ts` (3 root resolvers around lines 245, 262, 278 per drift research)
- Modify: `apps/admin/src/graphql/classification.test.ts` (add a file-existence assertion for `public-resolvers.regression.test.ts` per the meta-defense pattern described in Risks — single-line `expect(fs.existsSync(...)).toBe(true)`; deleting either file fails the other)
- Test (new or extend): `apps/admin/src/graphql/types/reference.test.ts`
- Test (new): `apps/admin/src/graphql/public-resolvers.regression.test.ts` — created in U3 as the natural closing commit; carries an enumerated allowlist of every intended-PUBLIC root resolver and asserts each resolves for a null principal

**Approach:**

- Change `authScopes: { loggedIn: true }` → `authScopes: { public: true }` on exactly three root queries in `reference.ts`: `languages` (`:245`), `countries` (`:262`), `keywords` (`:278`). The file's single `builder.queryFields` block exposes only these three.
- **One-pass field review** during implementation, extended scope: confirm `Language`, `Country`, `Keyword` GraphQL types expose no editor-private metadata (audio preview URLs on `Language` are intentionally consumer-facing — confirmed during research; `createdAt`/`updatedAt` on reference rows are low-sensitivity but flag in PR review if any reviewer wants them stripped). **Also extend the review to `videoScene.ts`**: `VideoScene.createdAt`/`updatedAt` and `VideoSceneLocale.createdAt`/`updatedAt` (lines 25-26, 49-50) become anonymously enumerable via the now-PUBLIC video graph. Both types are tagged `@classification public-shape` so exposure is consistent with admin's existing classification, but confirm intent before merge.
- **Create `apps/admin/src/graphql/public-resolvers.regression.test.ts`** — the centralized regression test mitigating SDL-drift CI's blindness to `authScopes` changes. Manifest array of intended-PUBLIC resolver names: `["experienceBySlug", "videoBySlug", "video", "videos", "languages", "countries", "keywords", "watchSetting", "searchExperiences", "hybridSearch", "sceneRecommendations"]`. For each name, the test invokes the query with a `null` principal context and asserts (a) the response resolves (200, not Forbidden), (b) `data.<resolverName>` is not null when seed data exists. Future contributors adding a new PUBLIC resolver MUST add it to this manifest; future contributors accidentally narrowing one MUST update the manifest (which is reviewable). Combined with the file-existence assertion in `classification.test.ts`, deletion of either test fails the other — meta-defense against silent removal.
- No service-layer or matrix change needed — reference data services do not have a `hasPermission` defense-in-depth guard today.
- The matrix already declares `read:reference: "PUBLIC"` at `permissions.ts:83`; the commit message explains that this widening brings resolvers into agreement with the documented matrix intent.

**Patterns to follow:**

- `apps/admin/src/graphql/types/experience.ts:149` (`authScopes: { public: true }` shape)

**Test scenarios:**

- Happy path: PUBLIC calls `languages { id bcp47 name }` → returns the languages array (seeded fixture content).
- Happy path: PUBLIC calls `countries { id name }` → returns the countries array.
- Happy path: PUBLIC calls `keywords { id name }` → returns the keywords array.
- Privilege gate: VIEWER/EDITOR/ADMIN calls continue to resolve (no regression from `loggedIn: true` → `public: true`).
- Regression: any existing reference-resolver test continues to pass.
- **Centralized regression test (`public-resolvers.regression.test.ts`)**: iterate the PUBLIC manifest, invoke each with a `null` principal, assert (a) no `Forbidden` error in `errors[]`, (b) `data.<resolverName>` is not null or empty when seed data exists. Adding a new PUBLIC resolver in any future commit requires extending the manifest (reviewable in PR).
- **Meta-defense assertion** (in `classification.test.ts`): single test that `fs.existsSync('apps/admin/src/graphql/public-resolvers.regression.test.ts')` is `true`. Test fails if the regression file is deleted. Reciprocal: the regression file's first test can assert the classification file exists, but this is excessive — one-way meta-defense is sufficient given the file is the entry point all other classification rules already rely on.

**Verification:**

- `pnpm --filter @forge/admin test` passes including the new reference tests.
- `pnpm --filter @forge/admin schema:print && git diff --exit-code apps/admin/schema.graphql` shows **no diff** (same reason as U2 — `authScopes` directive stripped pre-commit).

---

### U4. Add `watchSetting` query and supporting type

**Goal:** Anonymous callers can resolve `Query.watchSetting` and receive featured-experience and featured-video lists for the homepage. SDL gains a new query and type; `apps/admin/schema.graphql` and `packages/graphql/src/admin-graphql-env.d.ts` regenerate cleanly.

**Requirements:** R6, R7.

**Dependencies:** None on U1/U2/U3, but lands last in the PR because it is the only commit that affects the SDL artifact.

**Files:**

- Create: `apps/admin/src/graphql/types/watch-setting.ts`
- Modify: `apps/admin/src/graphql/schema.ts` (side-effect import — required by admin's "adding a Pothos type" convention per `apps/admin/CLAUDE.md`)
- Create: `apps/admin/src/services/watch-setting.service.ts`
- Test (new): `apps/admin/src/graphql/types/watch-setting.test.ts`
- Test (new): `apps/admin/src/services/watch-setting.service.test.ts`
- Modify: `apps/admin/schema.graphql` (regenerated, committed)
- Modify: `packages/graphql/src/admin-graphql-env.d.ts` (regenerated, committed)

**Approach:**

- Define a `WatchSetting` Pothos object type in `watch-setting.ts` with classification `@classification public-shape` JSDoc tag (per admin's convention). v1 fields match the _shape_ (object trees, not ID lists) consumed at `apps/web/src/lib/content.ts:48-63`:
  - `documentId: ID!` (use admin's Experience cuid; safe because admin's content-dump upserts by `cms_document_id` rather than re-creating rows — so the cuid is stable for the lifetime of the migration).
  - `homepageExperience: ExperienceLocale` (nullable — may not exist for the requested locale).
  - `defaultTemplateExperience: ExperienceLocale` (nullable — same).
- **Consumer-side coordination note:** apps/web's `WatchExperience` fragment at `apps/web/src/lib/fragments/watch-experience.ts:20` is currently `fragment WatchExperience on Experience` because Strapi's per-locale fields (`slug`, `title`, `blocks`, `metaDescription`, `pathSegment`, `ogTitle`, `ogDescription`, `ogImage`) live on `Experience`. Admin's per-locale data model puts those same fields on `ExperienceLocale`. When the homepage migrates (U5b/U6 follow-up), the consumer must rewrite the fragment from `on Experience` to `on ExperienceLocale` and every importer in apps/web that composes `WatchExperience` (e.g., `apps/web/src/lib/content.ts:530-553` `resolveHomepage`) must follow. U2's field-strip applies through this path because `ExperienceLocale` carries U2's `isHomepage`/`createdAt`/`updatedAt` strips and the parent `Experience` (when reached via `ExperienceLocale.experience` — currently not exposed) would carry U2's strips too. The shape choice (`ExperienceLocale` rather than `Experience`) is correct long-term — it matches admin's data model — and the consumer-side fragment rewrite is a small coordinated change tracked in U5b.
- Define `Query.watchSetting(locale: String!): WatchSetting` root resolver with `authScopes: { public: true }`. The resolver delegates to `services.watchSetting.get({ locale, user: ctx.user })`. `WatchSetting` itself is non-null even when its inner fields are null (consumer expects an object to exist).
- Service `WatchSettingService.get({ locale, user })` performs two Prisma reads:
  - Homepage: `prisma.experienceLocale.findFirst({ where: { isHomepage: true, locale, status: "PUBLISHED", experience: { archivedAt: null } }, orderBy: { updatedAt: "desc" } })` (verified: `ExperienceLocale.isHomepage` already exists in admin's data model per drift research). The `orderBy: updatedAt: desc` is the multi-row tiebreak if two locales share the same `isHomepage: true` flag.
  - Template: `prisma.experience.findFirst({ where: { isTemplate: true, archivedAt: null }, include: { locales: { where: { locale, status: "PUBLISHED" } } } })` and return the matched locale row (`experience.locales[0] ?? null`).
  - Service has no `hasPermission` guard (public read; both queries already gate by `status: "PUBLISHED"` for anonymous safety).
- **Pre-implementation production probe:** before locking the locale-fallback semantics, run `curl "https://cms.jesusfilm.org/graphql" -X POST -d '{"query":"{ watchSetting(locale: \"de\") { documentId homepageExperience { documentId locale } } }"}' -H "Content-Type: application/json"` against prod or staging cms. Compare to the `en` response. If Strapi returns the `en` row for a non-`en` locale request (implicit fallback), admin MUST mirror that fallback — strict-null behavior would break every non-English homepage on the U5b/U6 cutover day. Document the probe result in the U4 commit's PR description.
- Side-effect import `import "./types/watch-setting"` added to `apps/admin/src/graphql/schema.ts`. Order does not matter relative to existing types (no shared scalar dependency in v1).
- Regenerate the SDL: `pnpm --filter @forge/admin schema:print` writes new `apps/admin/schema.graphql`. Regenerate the consumer types: `pnpm --filter @forge/graphql generate` writes new `packages/graphql/src/admin-graphql-env.d.ts`. Commit both alongside the source change in the U4 commit.

**Patterns to follow:**

- `apps/admin/src/graphql/types/experience.ts` — Pothos type definition pattern, public-shape classification tag, root query under `builder.queryFields(...)`.
- `apps/admin/src/services/experience.service.ts` — service-class shape (`constructor(prisma)`, async methods).
- `apps/admin/CLAUDE.md` "Adding a new Pothos type" section — three required steps (create file, side-effect import, order if scalar deps).

**Test scenarios:**

- Happy path: PUBLIC calls `{ watchSetting(locale: "en") { documentId homepageExperience { id slug title } defaultTemplateExperience { id slug title } } }` against a fixture with one homepage Experience (`isHomepage: true` locale) and one template Experience (`isTemplate: true`) → resolves with both populated.
- Edge case — locale has no homepage: PUBLIC calls `watchSetting(locale: "de")` when no Experience has `isHomepage: true` for `de` → behavior matches the Strapi probe (strict null vs implicit `en` fallback — decision locked at implementation time from the curl probe). `WatchSetting` object still returned, not the whole query nulled.
- Edge case — no template Experience exists: `defaultTemplateExperience: null`; `homepageExperience` still returned.
- Edge case — homepage Experience has `archivedAt != null`: not returned (filter excludes archived).
- Multi-row tiebreak: when two ExperienceLocale rows have `isHomepage: true` for the same locale (data anomaly), service picks by `updatedAt DESC` and logs a warning. Test asserts deterministic pick + warning log.
- Privilege gate: EDITOR calls the same → same shape (no editor-only field difference at v1).
- Service-layer ABAC discipline: assert the service's Prisma query includes `status: "PUBLISHED"` AND `archivedAt: null` for anonymous callers. Deleting either filter should fail this test — this catches the "future maintainer refactors the service and drops the publish filter" regression. The cascade test that previously walked `homepageExperience.experience` is dropped because `ExperienceLocale.experience` is not exposed today; the Experience field-strip is verified by U2's tests against `experienceBySlug` directly.
- Public-safe field assertion: assert `WatchSetting.homepageExperience` returns only fields the consumer needs from `ExperienceLocale` (`id`, `experienceId`, `locale`, `slug`, `pathSegment`, `title`, `metaDescription`, `ogTitle`, `ogDescription`, `ogImageUrl`, `blocks`, `status`, `publishedAt`); the strip fields from U2 (`isHomepage`, `createdAt`, `updatedAt`) return null.
- SDL contract: `apps/admin/schema.graphql` after `schema:print` contains `type WatchSetting`, `Query.watchSetting(locale: String!): WatchSetting`. Snapshot or string-contains assertion in `watch-setting.test.ts`.
- Classification test: `apps/admin/src/graphql/classification.test.ts` continues to pass — `WatchSetting` uses `builder.objectRef` (not `prismaObject`) and its fields use `t.field` with service resolvers (not `t.relation`), so the walker does not trigger the public-shape→abac-gated check. **Future-maintenance note:** the classification.test.ts walker today only inspects `builder.prismaObject` + `t.relation` patterns. Service-mediated public→abac bridges (like `WatchSetting.homepageExperience: ExperienceLocale`) bypass the walker by construction. This is intentional — the service-layer mediation IS the gate. But it means new such bridges must be added deliberately and reviewed for the same publish-state filtering discipline. Document in System-Wide Impact.

**Verification:**

- `pnpm --filter @forge/admin test` passes.
- `pnpm --filter @forge/admin typecheck` clean.
- `pnpm --filter @forge/admin schema:print && git diff apps/admin/schema.graphql` shows the additive new query and type, nothing else.
- `pnpm --filter @forge/graphql generate && git diff packages/graphql/src/admin-graphql-env.d.ts` shows the regenerated types — commit.
- `admin-schema-drift` CI passes locally if simulated.
- `graphql-generate` CI passes locally if simulated.

---

## System-Wide Impact

- **Interaction graph:** PUBLIC widening affects the Pothos scope-auth pipeline only at the resolver and field level. No middleware, observer, or webhook is touched. The admin editor's data path (Prisma SSR from `apps/admin/src/app/dashboard/**`) is independent and unaffected.
- **Error propagation:** A field-level `authScopes` failure resolves to `null` (per Pothos scope-auth's default for field-level gates). It does NOT produce a top-level GraphQL error. Resolver-level `authScopes: { public: true }` cannot fail. The pattern is fail-safe for consumers — they always get a 200 response with possibly-null fields.
- **State lifecycle risks:** None. Auth changes are pure metadata; no Prisma writes, no migration, no rows changed. Schema-print is read-only.
- **API surface parity:** Mirror the principal-aware filter pattern from `Experience.locales` onto `Video.locales` so the two abac-gated-content types behave consistently for anonymous reads. Once both are filtered, "consumer-facing relation" behavior is uniform across the schema.
- **Integration coverage:** Per-resolver tests are necessary but not sufficient — `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` warns that resolver tests and service tests can both pass while the seam between them is broken. U1's test scenarios include an explicit `/api/graphql` route-handler integration test against a PUBLIC principal to catch that seam.
- **Unchanged invariants:**
  - `experienceBySlug` resolver-level auth (`public: true`) is unchanged.
  - `apps/admin/schema.graphql` after U1+U3 is **byte-identical** to current main (Pothos `authScopes` directives stripped pre-commit by `print-schema.ts`). U2 produces an additive nullability diff on **6 fields** (`Experience.isTemplate/createdAt/updatedAt`, `ExperienceLocale.isHomepage/createdAt/updatedAt`); U4 produces additive new type + query diff. Both U2 and U4 require the regenerated SDL + `admin-graphql-env.d.ts` to be committed.
  - The rate-limit plugin (`apps/admin/src/graphql/plugins/rate-limit.ts`), CORS posture (`apps/admin/src/app/api/graphql/route.ts:28-45`), Better Auth trusted origins (`apps/admin/src/auth/origins.ts:6-10`), and introspection-disable gate are all untouched.
  - `getByCoreId` in `video.service.ts:74-91` is intentionally left gated on `read:videos` because it is called by Core sync internals via service-to-service paths, not via the GraphQL surface.
  - The admin editor experience builder, media library, revision history, and ops surfaces continue to function identically — they all read via Prisma directly. The admin dashboard's videos page (`apps/admin/src/app/dashboard/live-data.ts:494`) reaches `services.video.list` through SSR and is unaffected because the route layer already calls `requireSession()` (gates non-authed users) and EDITOR/ADMIN sessions satisfy any tier — dropping the service-method `hasPermission` guard does not weaken its overall auth posture, but the change is real and worth being explicit about.
  - The ABAC layer (`canEditExperience`, `canEditExperienceLocale`, etc.) reads from Prisma entities with explicit `select` and never consumes GraphQL responses — verified by 4 prior research agents. Field-level authScopes do not affect ABAC.

- **Service-mediated public→abac bridges (discipline note).** `WatchSetting` is `@classification public-shape` but its fields resolve to `ExperienceLocale` (abac-gated). The Pothos pattern that makes this safe is `t.field({ type: "ExperienceLocale", resolve: () => services.watchSetting.get(...) })` rather than `t.relation(...)` — the service is the gate, so the public-shape→abac-gated bridge is mediated. `classification.test.ts` today only walks `builder.prismaObject` + `t.relation` patterns, so this bridge is invisible to the walker by construction. The discipline this requires: any new service-mediated public→abac bridge (e.g., a future `Sitemap { experiences: [ExperienceLocale!]! }`) must (a) only resolve published / public-safe rows in the service, (b) have a service-level test that asserts the WHERE clause includes the publish/archive gates, (c) document the bridge in this plan (or a successor) so future maintainers can audit them as a set. Round 2 surfaced this as a future-maintenance risk — capture in a `docs/solutions/` learning post-merge.

---

## Risks & Dependencies

| Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Three-layer auth contract drift (resolver / service / matrix).** Widening one layer while leaving another gated produces a silent hole (PUBLIC reads 403 at the service guard even after the resolver opens); symmetric risk in reverse — a future contributor re-adds the service guard "for safety" and silently re-blocks anonymous callers.                                                                                                                                                                                                                                                                                   | U1's Key Decision documents the explicit choice to drop the service guards on the three public-exposed methods. The flipped service-layer test assertions in `video.service.test.ts:38-42, 75-79` become **permanent regression guards** — any future re-addition of the `hasPermission` check breaks those tests, not just the resolver integration test. Integration test in U1 covers the route-handler seam at merge time.                                                                                                                                                           |
| **SDL-drift CI insensitivity to `authScopes` changes.** The directive-strip in `print-schema.ts` means U1's authScopes changes (and U3's) produce zero SDL diff — drift CI cannot catch a misfired auth gate or a regression where someone accidentally narrows `experienceBySlug` back to `loggedIn: true`. New-field default is also OPEN (a future contributor adding `Experience.viewCount` without an authScope ships publicly readable).                                                                                                                                                                                      | Per-resolver tests assert auth posture explicitly (PUBLIC happy path, EDITOR happy path, stripped fields are null). **Plus add a centralized regression test** (`apps/admin/src/graphql/public-resolvers.regression.test.ts`) that enumerates every intended-PUBLIC root resolver by name and asserts each resolves for a null principal — provides a single source of truth equivalent to what SDL-diff CI would provide if directives were not stripped. This catches the "test file deleted/renamed" silent regression Security flagged in SEC-003.                                   |
| **`Video.locales` draft leak the moment the root resolver opens.** Without the inline `query` filter, anonymous `videoBySlug` callers can read DRAFT and ARCHIVED locale titles+descriptions.                                                                                                                                                                                                                                                                                                                                                                                                                                       | U1 ships the filter in the same commit as the resolver widening. Test scenario in U1 confirms anonymous gets only PUBLISHED rows against a mixed-status fixture.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Anonymous-IP rate-limit bucket starvation from consumer SSR traffic.** Web/mobile/TV SSR will hit admin from a small set of Railway egress IPs, collapsing into the same `public:${cf-connecting-ip}` bucket and starving real anonymous users.                                                                                                                                                                                                                                                                                                                                                                                   | Out of scope for U2 per the brief's deferred-to-U5b decision on rate-limit identity. Flagged here so reviewers understand the surface is widened without identity segmentation; production traffic at scale requires U5b before any consumer route flips to `admin` mode rendering.                                                                                                                                                                                                                                                                                                      |
| **`getByCoreId` accidentally widened by future maintainers.** Someone reading "we made videos PUBLIC" may relax `getByCoreId`'s guard too, exposing an internal helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Code comment in U1's service-layer change explicitly preserves the `getByCoreId` guard and explains why (Core sync internal, not GraphQL-exposed). Matrix entry stays at VIEWER as a second wall. (No test for `WORKFLOW_TRIGGER` against `getByCoreId` — U1 doesn't change `getByCoreId`, so testing its current behavior is out of U1's scope; that contract is tested by Core sync's own integration tests.)                                                                                                                                                                          |
| **Anonymous reach into the scene graph after U1.** `Video → editions → dubs → VideoScene → locales → VideoSceneLocale` becomes publicly traversable; `VideoSceneLocale` exposes AI-derived `description`, `themes`, `bibleVerses`, `demographics`, `spiritualContext` (`apps/admin/src/graphql/types/videoScene.ts:43-48`). GraphQL Armor's `costLimit: 5000` and `maxDepth: 10` were calibrated when the video graph was VIEWER-gated.                                                                                                                                                                                             | Confirm the scene-graph exposure is intentional (the types are `@classification public-shape`, so admin's existing classification says yes — but the cost-limit was set under different traffic assumptions). Add a pre-merge note to runbook: review GraphQL Armor cost-limit thresholds against a worst-case `videos(limit: 200) { editions { dubs { scenes { locales { …all fields } } } } }` query. Adjust if a single-request cost spikes beyond a reasonable ceiling. Out-of-scope for code changes in U2; flagged for U7 runbook to gate before the canary flips to `admin` mode. |
| **Anonymous-IP rate-limit bucket contaminates the U5 canary parity signal NOW.** PR #915's dual-read comparator is live; once U1 widens the video routes, the parity harness will issue an additional admin call per route render, hitting `public:${cf-connecting-ip}` from a small set of Railway egress IPs. The 60/min anonymous ceiling can be exhausted in seconds at modest traffic; 429s contaminate the parity-clean signal R18a needs.                                                                                                                                                                                    | Pre-merge gate: before merging U2, raise `apps/admin/src/graphql/plugins/rate-limit.ts` anonymous Q/min ceiling for non-prod environments to a level the canary's dual-read traffic comfortably fits inside (suggest 600/min temporarily), OR keep U5 canary at `strapi`-only mode (NOT `dual-read`) until U5b's per-app identity ships. Document the choice in the PR description and the U7 runbook. Without this gate, the canary's parity numbers cannot be trusted to advance through R18a thresholds.                                                                              |
| **`watchSetting` shape mismatch with the consumer (pre-fix).** Earlier draft of this plan defined v1 as ID lists; cross-reviewer pass surfaced that `apps/web/src/lib/content.ts:48-63` consumes full `homepageExperience`/`defaultTemplateExperience` object trees from Strapi today. **Resolved:** U4's v1 shape now matches the consumer exactly.                                                                                                                                                                                                                                                                                | N/A — fixed in plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Editor regression from accidentally over-broad field stripping.** If `read:experiences` permission key is misconfigured (EDITOR doesn't satisfy it), editor sees nulls for stripped fields.                                                                                                                                                                                                                                                                                                                                                                                                                                       | The permission matrix already declares `read:experiences: "VIEWER"` (`permissions.ts:79`). EDITOR/ADMIN both rank above VIEWER in `EDITORIAL_LADDER`. Per-principal test in U2 verifies EDITOR sees full field values.                                                                                                                                                                                                                                                                                                                                                                   |
| **Reference data fields surface unexpected editor-private content.** If any reference resolver exposes a field that shouldn't be public (e.g., an admin-only metadata column), widening leaks it.                                                                                                                                                                                                                                                                                                                                                                                                                                   | U3 implementation includes a one-pass field-by-field review of `apps/admin/src/graphql/types/reference.ts` and `apps/admin/src/graphql/types/videoScene.ts` for any field that smells admin-private. Findings raised in PR review.                                                                                                                                                                                                                                                                                                                                                       |
| **apps/web `isTemplate === true` invariant breaks under nullability flip.** `apps/web/src/lib/content.ts:534` uses strict equality (`settings?.homepageExperience?.isTemplate === true`) to validate that the homepage Experience is NOT a template. After U2 flips `isTemplate` to nullable and `unauthorizedResolver` returns null for PUBLIC, `null === true` is `false` — meaning a template configured as homepage by mistake would PASS the invariant check and render. Strapi's `lifecycles.js` guards this on the write side; admin has no equivalent guard yet (U4 only adds a read resolver, not editor lifecycle hooks). | **For U5b/U6 homepage migration:** before the consumer flips to admin's `watchSetting`, either (a) add an admin-side write guard on `Experience.isTemplate + ExperienceLocale.isHomepage` (prevent setting both true on the same Experience), or (b) reshape the apps/web invariant to fetch `isTemplate` via an EDITOR-tier admin call rather than the PUBLIC one — but this requires apps/web to obtain editor-tier auth which it explicitly doesn't have. Option (a) is the right path. Flagged here so U5b's plan doesn't miss it; no code change in U2.                             |
| **U4 service `include` reads can leak future Experience fields.** The U4 service returns `ExperienceLocale` rows via Prisma `findFirst` with `include: { locales: { ... } }`. Field-level `authScopes` (from U2) fire at GraphQL resolution time, not at Prisma fetch time. A future contributor adding `Experience.internalNote: String?` without an authScope tag ships it publicly readable via U4's path.                                                                                                                                                                                                                       | The centralized `public-resolvers.regression.test.ts` (U3) should ALSO assert a public-safe field allowlist for `Experience` and `ExperienceLocale`: for every field NOT in the allowlist, anonymous responses return `null`. Failure mode: a new field added without an authScope tag fails the test, forcing the new-field author to make the public-or-private decision deliberately. Add a code comment at the U4 service site warning that future Experience fields need authScope review.                                                                                          |

---

## Documentation / Operational Notes

- **Pre-merge operational checks (no code, runbook items):**
  - Confirm `forge-admin` Railway service has `CORS_ALLOWED_ORIGINS` set to include `https://web.jesusfilm.org` (and any preview/staging consumer origins). Today the env var is optional and the Yoga CORS handler fails closed if it's empty — verify the variable is set, not relying on fallback.
  - Confirm `AUTH_TRUSTED_ORIGINS` is set or that the hardcoded fallback in `apps/admin/src/auth/origins.ts:6-10` already includes consumer app origins. Drift research confirmed `web.jesusfilm.org` is in the hardcoded list — likely no env var update needed in prod; document this explicitly so future env-cleanup work doesn't accidentally remove the fallback.
  - Both checks are documented in the U7 runbook follow-up; this plan does not introduce env-var code changes.

- **PR description must include this checklist** (visible merge gate, not just docs):
  - `[ ] Rate-limit ceiling raised in non-prod (suggest 600/min anonymous) OR U5 canary set to strapi-only mode until U5b ships per-app identity` — closes the canary parity contamination risk
  - `[ ] Strapi `watchSetting` locale-fallback probe run; result documented in PR body` — closes U4's locale-fallback question (curl command in U4 approach)
  - `[ ] GraphQL Armor cost-limit ceiling reviewed against post-U1 worst-case scene-graph query` — flags whether `costLimit: 5000` needs raising for the now-PUBLIC video graph
  - `[ ] `apps/admin/schema.graphql`and`packages/graphql/src/admin-graphql-env.d.ts` regenerated for U2 (nullability flip) and U4 (new type/query); both committed`
  - `[ ] Per-principal tests in U1, U2, U3 cover PUBLIC + EDITOR + WORKFLOW_TRIGGER; `errors[]` empty for stripped fields`

- **Post-merge:**
  - Run `/ce-compound` to capture two learnings: (1) "admin PUBLIC widening pattern" — the three-layer coordination story, with the explicit service-guard removal decision and the per-resolver-test discipline; (2) "Pothos field-level `authScopes` invisible to schema-drift CI" — formalize the architectural-patterns implication that field-level auth changes need behavioral tests, not just SDL diffs.
  - Update `docs/admin-core-migration/query-inventory.md` to mark `videoBySlug`, `video`, `videos`, `languages`, `countries`, `keywords`, and `watchSetting` as "PUBLIC on admin" so Units 5b/6/7 see the readiness state.
  - Confirm U5 (PR #915) is unaffected — its parity harness reads `experienceBySlug` only, which was already PUBLIC; the Experience field strip should not affect the canary's selection set (verified by Agent 2 in prior research).

- **Rollback procedure (if a regression surfaces):**
  - U1 only: `git revert <u1-commit>` restores the three `authScopes: { hasPermission: "read:videos" }` lines, the three service-layer guards, and the `Video.locales` filter. No DB rollback needed; no migration involved.
  - U2 only: `git revert <u2-commit>` removes the 7 field-level `authScopes` and the 5 nullability flips. **Two-step revert** — after `git revert`, also run `pnpm --filter @forge/admin schema:print && pnpm --filter @forge/graphql generate` and commit the regenerated artifacts (the revert restores the source but the SDL artifact must regenerate). Consumer code reading the now-non-null fields keeps working because admin's response was already non-null pre-widening; the SDL signature flip is the only change.
  - U3 only: `git revert <u3-commit>` restores `loggedIn: true` on the three reference resolvers.
  - U4 only: **CHECK FIRST:** before reverting, run `grep -rn "watchSetting" apps/web apps/mobile apps/tv | grep -v admin-graphql-env`. Any non-zero hits mean a consumer already uses the type; revert requires coordinated removal in those repos first. Then `git revert <u4-commit>` removes the new query/type/service/tests; re-run `schema:print` + `graphql generate` and commit the regenerated artifacts as a follow-up commit on the revert branch (U4 revert is therefore a two-commit operation, not atomic).
  - All four: standard PR revert. Same two-step caveat applies for U2 + U4 (regenerate + commit artifacts).

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md` (R10, Outstanding Questions, Status section's enumerated admin-side prerequisites)
- **Related plan documents:**
  - `docs/plans/2026-05-08-001-feat-consumer-migration-web-canary-unit-5-plan.md` (Unit 5, in review as PR #915)
  - `docs/plans/2026-05-07-002-feat-consumer-migration-parity-harness-unit-4-plan.md` (Unit 4, completed)
  - `docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md` (Unit 3, shipped in PR #902)
  - `docs/plans/2026-05-07-001-feat-consumer-migration-unit-1-query-inventory-plan.md` (Unit 1, completed)
- **Related PRs:** #902 (dual-client codegen + initial brief Unit 2 partial; merged 2026-05-07), #915 (Unit 5 web canary; open in review)
- **Related code:**
  - `apps/admin/src/graphql/types/video.ts`, `apps/admin/src/graphql/types/experience.ts`, `apps/admin/src/graphql/types/reference.ts`
  - `apps/admin/src/services/video.service.ts`, `apps/admin/src/services/experience.service.ts`
  - `apps/admin/src/auth/permissions.ts`, `apps/admin/src/scripts/print-schema.ts`
  - `apps/admin/schema.graphql`, `packages/graphql/src/admin-graphql-env.d.ts`
- **Institutional learnings:**
  - `docs/solutions/graphql/pothos-relation-abac-filter-required-for-nested-types.md`
  - `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md`
  - `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`
  - `docs/solutions/security-issues/yoga-cors-origin-undefined-allows-all-origins.md`
  - `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`
  - `docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md`
- **Repo-internal references:**
  - `apps/admin/CLAUDE.md` (Permission system, Adding a new Pothos type, conventions)
  - `docs/admin-core-migration/query-inventory.md` (Unit 1 deliverable; consumer query inventory)
- **Migration trackers (per memory):** Urim owns end-to-end (decisions + admin execution) as of 2026-05-07.
