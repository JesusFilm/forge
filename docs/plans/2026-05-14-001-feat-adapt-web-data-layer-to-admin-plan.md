---
title: "feat: adapt web's data layer to admin"
type: feat
status: active
date: 2026-05-14
origin: docs/brainstorms/2026-05-14-adapt-web-data-layer-to-admin-requirements.md
---

# feat: adapt web's data layer to admin

## Summary

Rebuild `apps/web`'s data layer on a single long-lived branch so every page reads from admin instead of Strapi. The branch carries the migration-scaffolding revert, the four admin-side widenings the rebuild needs, the new `packages/admin-graphql` package, the rewritten web data layer (`content.ts`, `search.ts`, `recommendations.ts`, `demo-search.ts`, fragments, helpers), local fixture seeding, the admin → web revalidation webhook, and final verification. New UI work pauses on `main` for the duration; mobile and TV continue to read Strapi through a frozen `packages/graphql`.

---

## Problem Frame

`apps/web` reads content from Strapi via `packages/graphql`'s `graphql()` factory. Two weeks of migration-shaped work (parity bridge, `FORGE_CONTENT_API` switch, parity harness, cutover runbook) produced infrastructure that has to be removed later and didn't unblock the smoke-test against prod (see origin Problem Frame). The rebuild treats web as adapting to admin's schema, not migrating between two — no parity, no canary, no dual-source bridges, no cutover vocabulary. The current and forecasted work is large and cross-cutting (~2,300 LOC of data-layer rewrite + scaffolding removal + new package + admin widenings + webhook), so it ships as one branch that flips every page at once when it merges.

---

## Requirements Trace

Every origin requirement (R1-R20) is addressed below.

- **R1, R2, R3, R4, R6** — Revert web-side migration scaffolding: U2, U3
- **R5** — Remove `PARITY_BEARER` Doppler secret + tear down PARITY_BEARER role in admin: U4
- **R7** — Trim `packages/graphql` to Strapi-only; create `packages/admin-graphql`; relocate `admin-schema-drift` CI: U3, U9, U10, U11, U12
- **R8, R9** — Admin's prod posture stays intact (this plan adds widenings only, no reverts; existing widening untouched): U5-U8, U17 (verification)
- **R10** — Every web data fetch reads admin: U13-U19
- **R11** — No migration vocabulary in new code: enforced in each new-code unit; verified by grep at U21
- **R12** — Types and fragments mirror admin's schema directly: U13-U18
- **R13** — Single long-lived branch, one merge: branching policy below, U21
- **R14** — UI work freeze on main: branching policy below
- **R15** — Local admin fixture seeding: U20
- **R16** — Local fixture-based verification before merge: U21
- **R17** — Pre-fork widening audit converted to in-branch units: U5-U8 (see Key Technical Decisions)
- **R18** — Pre-strip mobile/TV import audit (already verified in research; documented in U3)
- **R19** — `CONSUMER_BEARER` env var storage and rotation: U13
- **R20** — Input validation on user-supplied query inputs: U13

---

## Implementation Units

### U1. Cut the rebuild branch from main

- **Goal:** Establish `feat/adapt-web-data-layer-to-admin` as the long-lived branch; document the freeze.
- **Requirements:** R13, R14
- **Dependencies:** none
- **Files:**
  - Branch creation, no code files yet
  - Update `CLAUDE.md` with a one-line note that new UI work pauses on `main` until the branch lands
- **Approach:** Fork from current `main`. Document the freeze decision in `CLAUDE.md` so other contributors see it. Critical fixes still ship to `main`; rebase the branch onto main when those fixes touch shared files (rebase, not merge, to keep history linear).
- **Verification:** Branch exists locally and on origin; freeze note visible to anyone reading `CLAUDE.md`.

### U2. Revert web-side migration scaffolding

- **Goal:** Delete the web-side files that exist only because of the migration framing; remove the env vars they consumed.
- **Requirements:** R1, R2, R6
- **Dependencies:** U1
- **Files (delete):**
  - `apps/web/src/lib/parity-bridge.ts`, `apps/web/src/lib/parity-bridge.test.ts`
  - `apps/web/src/lib/content-api-mode.ts`, `apps/web/src/lib/content-api-mode.test.ts`
  - `apps/web/src/lib/admin-client.ts`, `apps/web/src/lib/admin-client.test.ts` (rebuilt in U13 against the new package)
  - `apps/web/src/lib/fragments/admin-experience.ts`
  - `apps/web/src/lib/__tests__/content-mode-regression.test.ts`
  - `apps/admin/src/domain/package.json` (the ESM/CJS workaround)
- **Files (modify):**
  - `apps/web/src/lib/content.ts` — remove the dual-read path (lines ~270-431 and ~587-624 per research): `fetchAdminSlugExperience`, `fetchSlugExperience` dispatcher, `WatchPageAdminError`, mode-keyed `unstable_cache`, related event logging
  - `apps/web/src/app/[slug]/page.tsx` — remove dual-read branching; return to single-source read state
  - `apps/web/src/env.ts` — delete `FORGE_CONTENT_API`, `FORGE_PARITY_DEBUG`, `FORGE_DISABLE_WATCH_ROUTES` blocks (lines 4-13 and 75-195 per research); keep `ADMIN_GRAPHQL_URL` but leave optional for now (flipped to required in U13)
- **Approach:** Sequential deletions. After this unit, web is back on Strapi-only reads through the existing `packages/graphql` Strapi factory. Tests in `apps/web` typecheck and pass against Strapi. This is intentional — it gives a clean baseline before the rebuild begins.
- **Patterns to follow:** None — these are deletions, not additions.
- **Test scenarios:** Test expectation: none — pure removal. Verification is that `apps/web` typechecks, existing test suite passes (with the deleted files' tests removed), and slug pages still render from Strapi locally.
- **Verification:** `pnpm --filter @forge/web typecheck` passes; `pnpm --filter @forge/web test` passes; local dev server renders a slug page from Strapi.

### U3. Trim `packages/graphql` to Strapi-only

- **Goal:** Strip every admin-side artifact and the parity harness from `packages/graphql`. Mobile/TV keep consuming the Strapi factory unchanged.
- **Requirements:** R3, R7, R18
- **Dependencies:** U2
- **Files (delete):**
  - `packages/graphql/src/parity/` (entire directory: 15 source files + 2 fixture dirs)
  - `packages/graphql/scripts/capture-parity-fixture.ts`, `packages/graphql/scripts/run-batch-verification.ts`
  - `packages/graphql/src/admin.ts`
  - `packages/graphql/src/admin-graphql-env.d.ts`
  - `packages/graphql/src/fragments/admin/` (entire directory — admin block fragments relocate to new package in U9, but they are copied there, not moved)
  - `packages/graphql/src/__tests__/dual-client.types.ts`
- **Files (modify):**
  - `packages/graphql/src/index.ts` — drop admin re-exports; trim to Strapi-only surface
  - `packages/graphql/package.json` — drop `./admin`, `./admin/fragments`, `./parity` exports; drop `@forge/admin` devDep, drop `zod`, drop `p-limit`
  - `packages/graphql/tsconfig.json` — remove the `name: "admin"` schema entry from `gql.tada` plugin config; keep only `name: "strapi"`
  - `packages/graphql/CLAUDE.md` — update to reflect single-schema (Strapi-only) state
- **Approach:** Pre-flight grep audits the assertion in R18 (the research already confirmed `apps/mobile` and `apps/tv` import only `graphql` and `ResultOf` from `@forge/graphql` — zero admin references). Record the grep output as a comment in the PR description for U3.
- **Patterns to follow:** `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md` for the inverse — what to undo from the dual-client setup.
- **Test scenarios:**
  - Strapi-only typecheck passes: `pnpm --filter @forge/graphql typecheck`
  - `pnpm --filter @forge/graphql generate` regenerates only `src/graphql-env.d.ts`
  - `apps/mobile` and `apps/tv` typecheck against the trimmed package
- **Verification:** Mobile and TV builds work unchanged; trimmed package has zero references to `parity`, `admin`, `adminGraphql`.

### U4. Tear down PARITY_BEARER in admin

- **Goal:** Remove every artifact tied to the parity harness's bearer role from admin. Admin's prod posture stays intact for `CONSUMER_BEARER` and PUBLIC widening; only the parity scaffolding goes.
- **Requirements:** R5
- **Dependencies:** U3 (parity harness deleted from `packages/graphql` first)
- **Files (delete):**
  - `apps/admin/src/auth/parity-bearer.ts`
  - Doppler `PARITY_API_KEYS` secret (dev + prd)
- **Files (modify):**
  - `apps/admin/src/auth/permissions.ts` — drop `PARITY_BEARER` role from the principal union; drop `PARITY_BEARER_PERMISSIONS`
  - `apps/admin/src/auth/principal.ts`, `apps/admin/src/auth/context.ts` — remove parity-bearer branch
  - `apps/admin/src/graphql/plugins/rate-limit.ts` — remove the `role === 'PARITY_BEARER'` branch from `identifyForRateLimit`; verify the remaining branches still route web SSR to `consumer:<key>` correctly
  - `apps/admin/src/graphql/types/experience.ts` — drop `experienceTemplates` Pothos field (PARITY-only)
  - `apps/admin/src/config/env.ts` — drop `PARITY_API_KEYS` from Zod schema
  - `apps/admin/src/auth/bearer-csv-disjointness.ts` (or wherever `assertBearerCsvsDisjoint` lives) — revert three-way to two-way (`WORKFLOW !== WEB_ADMIN`)
- **Approach:** Follow `docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md` — the pattern was designed as throwaway scaffolding, so the rollback is mechanical. Update `INTENDED_PUBLIC_RESOLVERS` and any source-walking auth manifests that reference `experienceTemplates`.
- **Patterns to follow:** `docs/solutions/architecture-patterns/parity-bearer-narrow-carveout-pattern-20260513.md` (this is the canonical teardown recipe).
- **Test scenarios:**
  - `apps/admin/src/auth/*.test.ts` — remove PARITY_BEARER-specific tests; verify remaining tests pass
  - `apps/admin/src/graphql/plugins/rate-limit.test.ts` — confirm `identifyForRateLimit` returns `consumer:<key>` for valid CONSUMER_BEARER, `public:<ip>` for anonymous, and no longer references PARITY_BEARER
  - `apps/admin/src/graphql/public-resolvers.regression.test.ts` — `experienceTemplates` should not be in `INTENDED_PUBLIC_RESOLVERS`
- **Verification:** `pnpm --filter @forge/admin test` passes; admin GraphQL schema regenerates cleanly; bearer-CSV disjointness asserter is two-way.

### U5. Admin widening — `Video.parents` and `Video.children` PUBLIC

- **Goal:** Expose the Video-Video relations needed by the watch-page sibling carousel to anonymous consumers.
- **Requirements:** R10, R17 (in-branch variant — see Key Technical Decisions)
- **Dependencies:** U4
- **Files (modify):**
  - `apps/admin/src/graphql/types/video.ts` — add `t.relation('parents', { ... })` and `t.relation('children', { ... })` with `authScopes: { public: true }` and principal-aware filtering mirroring `Video.locales` (PUBLISHED-only for anonymous, all for EDITOR/ADMIN)
  - `apps/admin/src/services/video.service.ts` — coordinate service-layer auth if any guard exists for parents/children traversal
  - `apps/admin/src/graphql/public-resolvers.regression.test.ts` — add `Video.parents` and `Video.children` to `INTENDED_PUBLIC_RESOLVERS`
  - `apps/admin/schema.graphql` — regenerated by `pnpm --filter @forge/admin schema:print`
- **Approach:** Mirror the existing `Experience.locales` principal-aware filter pattern (`apps/admin/src/graphql/types/experience.ts:92-99`). Use `unauthorizedResolver: () => null` on any field-level strip per `docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`. Update the public-resolvers regression manifest in the same commit so drift CI catches a missed widening.
- **Patterns to follow:** `docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`; `apps/admin/src/graphql/types/experience.ts:92-99` for relation filter shape.
- **Test scenarios:**
  - Anonymous caller reading `Video.parents` returns PUBLISHED parents only
  - Anonymous caller reading `Video.children` returns PUBLISHED children only
  - EDITOR caller sees all parents/children regardless of status
  - `apps/admin/schema.graphql` SDL diff is exactly the additive relations
  - `INTENDED_PUBLIC_RESOLVERS` regression test passes with the new entries
- **Verification:** Anonymous GraphQL query against local admin returns parents/children arrays; admin-schema-drift CI passes.

### U6. Admin widening — `videoBySlug` locale-narrowed reads

- **Goal:** Let web fetch a video's locale-specific fields (description, snippet, imageAlt, variants) without overfetching every locale.
- **Requirements:** R10, R17 (in-branch)
- **Dependencies:** U5
- **Files (modify):**
  - `apps/admin/src/graphql/types/video.ts` — choose ONE of two approaches:
    - **Option A** (preferred): Add a `locale` arg to `Video.locales(locale: I18NLocaleCode)` so `videos { locales(locale: $locale) { ... } }` returns a single-element array for the requested locale. Cheapest change.
    - **Option B**: Add a new `videoBySlug(slug, locale)` overload returning a `(video, locale)` projection type.
  - `apps/admin/src/services/video.service.ts` — service-layer locale filtering
  - `apps/admin/src/graphql/public-resolvers.regression.test.ts` — add the new arg or query
  - `apps/admin/schema.graphql` — regenerated
- **Approach:** Default to Option A unless the projection ergonomics are bad for `videoBySlug` callers — the relation-arg path is one Pothos line and matches admin's existing pattern of putting filters on relations. Option B is a fallback if Option A causes nullable-shape friction.
- **Patterns to follow:** `docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`; `apps/admin/src/graphql/types/experience.ts` for the locale-on-relation precedent.
- **Test scenarios:**
  - Anonymous `videoBySlug` with locale returns single-locale data
  - Anonymous `videoBySlug` with non-existent locale returns empty locales array (not null)
  - EDITOR caller can read all locales when locale arg omitted
  - SDL drift: additive only
- **Verification:** Anonymous query exercises the locale narrowing against seeded local admin.

### U7. Admin widening — `Experience.isTemplate` resolution

- **Goal:** Either widen `Experience.isTemplate` to PUBLIC or restructure web's template routing so it doesn't need that field.
- **Requirements:** R10, R17 (in-branch)
- **Dependencies:** U5
- **Files (modify):**
  - Decision needed during implementation; choose ONE of two approaches:
    - **Option A** (preferred): Widen `Experience.isTemplate` to PUBLIC by removing it from the `STRIPPED_FOR_PUBLIC` list in `apps/admin/src/graphql/types/experience.ts:77`. Update `public-resolvers.regression.test.ts`.
    - **Option B**: Refactor `apps/web/src/lib/content.ts` `resolveSlugPage` so template-vs-experience routing uses `watchSetting.defaultTemplateExperience` rather than inspecting `isTemplate` on each Experience. Removes the need for the field; preserves admin's stripped-for-PUBLIC posture.
- **Approach:** Make the decision when the rebuild reaches `resolveSlugPage` in U14. Default is Option A — one-line widening, smaller blast radius. Option B is cleaner long-term but pulls web logic into this unit; defer unless Option A surfaces a security or audit-trail concern during review.
- **Patterns to follow:** `docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`.
- **Test scenarios:**
  - (Option A) Anonymous query for `experienceBySlug` returns `isTemplate` field; EDITOR query returns same
  - (Option B) Web's slug-page routing renders the correct page for both template and non-template Experiences without consulting `isTemplate`
- **Verification:** Watch-page routing renders correctly for templated vs non-templated content against seeded fixtures.

### U8. Drop legacy `isHomepage` fallback in `resolveHomepage`

- **Goal:** Stop relying on the `ExperienceLocale.isHomepage` field (which is STRIPPED_FOR_PUBLIC anyway). Use `watchSetting.homepageExperience` as the single homepage source.
- **Requirements:** R10, R17 (in-branch)
- **Dependencies:** U5
- **Files (modify):**
  - `apps/web/src/lib/content.ts` — remove the `getExperienceByFilters(locale, { isHomepage: { eq: true } })` fallback path in `resolveHomepage`; rely only on `watchSetting.homepageExperience`
- **Approach:** This is a web-side change but it reduces the admin-widening surface (no need to expose `isHomepage` to PUBLIC). Lands in the same phase as U5-U7 because it's part of the "what does admin need to expose" decision tree.
- **Patterns to follow:** None — pure simplification.
- **Test scenarios:**
  - Home route (`/`) renders the same content via `watchSetting.homepageExperience` against seeded fixtures
  - Test that previously exercised the legacy fallback path is removed or rewritten
- **Verification:** Local home page renders correctly with `watchSetting.homepageExperience` as the only resolution path.

### U9. Bootstrap `packages/admin-graphql` package

- **Goal:** Create the new single-schema admin client package; copy admin block fragments from old location.
- **Requirements:** R7, R11
- **Dependencies:** U3
- **Files (create):**
  - `packages/admin-graphql/package.json` — workspace name `@forge/admin-graphql`, `"type": "module"`, raw-TS exports (`.`, `./fragments`)
  - `packages/admin-graphql/tsconfig.json` — single-schema gql.tada config (`schemas: [{ name: "admin", schema: "../../apps/admin/schema.graphql", tadaOutputLocation: "./src/admin-graphql-env.d.ts" }]`)
  - `packages/admin-graphql/vitest.config.ts`
  - `packages/admin-graphql/src/index.ts` — barrel: re-exports `adminGraphql` factory + types + fragments
  - `packages/admin-graphql/src/admin.ts` — `adminGraphql` factory + `AdminFragmentOf`, `AdminResultOf`, `AdminVariablesOf` types
  - `packages/admin-graphql/src/fragments/` — copy 19 admin block fragments from old `packages/graphql/src/fragments/admin/` location (these were already built and can be lifted nearly verbatim per research)
  - `packages/admin-graphql/src/fragments/watch-experience.ts` — root `AdminWatchExperience` fragment
  - `packages/admin-graphql/src/fragments/index.ts` — barrel
- **Approach:** Lift the existing admin fragments verbatim. Strip the Strapi-vocabulary aliases that exist for parity (`adventTitle: title`, `ctaHeading: heading`, etc.) only where they no longer serve a purpose — web's new rebuild can adopt admin's native field names everywhere. The alias decision is per-fragment; default to dropping aliases unless they materially clarify renderer code.
- **Patterns to follow:** `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md` for the per-package codegen discipline (lexicographicSortSchema, AST directive stripping, etc.). The new package consumes admin's committed SDL artifact (`apps/admin/schema.graphql`) — it does NOT import from `apps/admin/src/domain/*` or any other admin source, sidestepping the ESM/CJS trap documented in `docs/solutions/runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md`.
- **Test scenarios:**
  - Package builds: `pnpm --filter @forge/admin-graphql typecheck`
  - Codegen produces `admin-graphql-env.d.ts`: `pnpm --filter @forge/admin-graphql generate`
  - Importing `adminGraphql`, `AdminFragmentOf`, `AdminResultOf`, `AdminVariablesOf` from `@forge/admin-graphql` resolves
- **Verification:** A small consumer file in the new package's test directory imports the factory and writes a sample query that typechecks.

### U10. Wire codegen, Turbo, CI for the new package

- **Goal:** Connect the new package to the build system; split admin schema drift from Strapi schema drift in CI.
- **Requirements:** R7
- **Dependencies:** U9
- **Files (modify):**
  - `turbo.json` — add a new `generate` task definition (or update the existing one) so `@forge/admin-graphql` codegen runs with `inputs: ["../../apps/admin/schema.graphql"]` and `outputs: ["src/admin-graphql-env.d.ts"]`; trim `@forge/graphql`'s `generate` task to Strapi-only inputs/outputs
  - `.github/workflows/ci.yml` — split the `graphql-generate` job (lines 78-95 per research): one job per package, each gated on its own `affected` filter. `admin-schema-drift` keeps watching `apps/admin/schema.graphql` — no change to that job.
- **Approach:** Two filter targets in CI rather than one. Each job's `git diff --exit-code` covers exactly the artifact owned by its package.
- **Patterns to follow:** `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md` for the per-job-per-artifact split.
- **Test scenarios:**
  - Trigger CI on a no-op admin SDL change — `admin-schema-drift` and the new admin-graphql `generate` job both fail with helpful messages
  - Trigger CI on a Strapi-only schema change — only `@forge/graphql`'s generate job fires (not the admin one)
- **Verification:** A test PR that touches `apps/admin/schema.graphql` runs the right CI jobs.

### U11. Type-isolation guard for the new package

- **Goal:** Prevent accidental cross-schema imports inside web consumers.
- **Requirements:** R7, R11
- **Dependencies:** U9, U10
- **Files (create):**
  - `packages/admin-graphql/src/__tests__/type-isolation.types.ts` — compile-time test using `@ts-expect-error` directives proving Strapi types from `@forge/graphql` cannot be used as `AdminFragmentOf` / `AdminResultOf` arguments, and vice versa
- **Approach:** Mirror the deleted `packages/graphql/src/__tests__/dual-client.types.ts` but for the single-package version — confirms web cannot accidentally feed Strapi types into the admin client.
- **Patterns to follow:** `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md` (the type-isolation pattern + its three pitfalls).
- **Test scenarios:**
  - `pnpm --filter @forge/admin-graphql typecheck` fails if a Strapi type leaks through
  - Removing one of the `@ts-expect-error` lines causes typecheck to fail with the expected message
- **Verification:** Run `pnpm --filter @forge/admin-graphql typecheck`; manually remove one ts-expect-error and confirm CI catches it.

### U12. Document new package conventions

- **Goal:** Onboarding doc for the new package.
- **Requirements:** R7, R11
- **Dependencies:** U9-U11
- **Files (create):**
  - `packages/admin-graphql/CLAUDE.md` — single-schema gql.tada client conventions, codegen flow, fragment authoring patterns, the SDL-only consumption rule (no imports from `apps/admin/src/domain/*` at runtime to avoid the tsx-ESM trap)
- **Approach:** Model on `packages/graphql/CLAUDE.md`. Keep it tight — operational conventions only, no migration history or rationale prose.
- **Patterns to follow:** `packages/graphql/CLAUDE.md` structure.
- **Test scenarios:** Test expectation: none — documentation file.
- **Verification:** Doc is discoverable from the package root; references match actual code.

### U13. Rebuild `apps/web/src/lib/client.ts` against the new package

- **Goal:** Single Apollo client pointed at admin's GraphQL endpoint; CONSUMER_BEARER from env; module-load validation.
- **Requirements:** R10, R19, R20
- **Dependencies:** U2 (old admin-client.ts deleted), U9 (new package exists)
- **Files (modify or replace):**
  - `apps/web/src/lib/client.ts` — Apollo client construction: `link` points at `env.ADMIN_GRAPHQL_URL`; `authMiddleware` adds `Authorization: Bearer ${env.WEB_ADMIN_API_KEYS.split(",")[0]}`; 3s timeout; module-scope bearer cache
  - `apps/web/src/env.ts` — flip `ADMIN_GRAPHQL_URL` from `.optional()` to required; flip `WEB_ADMIN_API_KEYS` from `.optional()` to required; add a `.refine()` host-allowlist that rejects `auth.jesusfilm.org` (mirror the trap from `packages/graphql/src/parity/live-config.ts:24` before that file deletes)
- **Files (create):**
  - `apps/web/src/lib/client.test.ts` — env-validation tests, bearer wiring tests
- **Approach:** The single Apollo client replaces the dual Strapi/admin-client.ts split. CONSUMER_BEARER is required at env-validation time — module load fails fast in environments missing the value. Rotation procedure (R19): add new key to admin's `WEB_ADMIN_API_KEYS` CSV → update web env → remove old key. Document this in `apps/web/CLAUDE.md`.
- **Patterns to follow:** `docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md` for bearer semantics; `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md` for the optional→required flip discipline (preconditions: Railway env vars provisioned in dev + prd before this unit lands).
- **Test scenarios:**
  - **Happy path:** module imports successfully when both env vars are set
  - **Edge:** module throws at import when `ADMIN_GRAPHQL_URL` is unset
  - **Edge:** module throws at import when `WEB_ADMIN_API_KEYS` is unset
  - **Edge:** `client.ts` extracts the first key from a CSV value
  - **Edge:** host-allowlist rejects `auth.jesusfilm.org` at validation time
  - **Integration:** `client.query()` against local admin returns expected shape with bearer attached
- **Verification:** `pnpm --filter @forge/web typecheck && pnpm --filter @forge/web test`; local query against admin succeeds when CONSUMER_BEARER and ADMIN_GRAPHQL_URL are set.

### U14. Rebuild `content.ts` main resolvers (Experience reads)

- **Goal:** Replace Strapi-based `resolveWatchPage`, `resolveSlugPage`, `mergeWatchExperience`, `getWatchPageMetadata` with admin-based equivalents. Includes Experience-side fragments.
- **Requirements:** R10, R11, R12
- **Dependencies:** U13 (Apollo client), U7-U8 (admin widenings for isTemplate, isHomepage)
- **Files (modify):**
  - `apps/web/src/lib/content.ts` — rewrite the Experience-fetching half (resolveWatchPage / resolveSlugPage / mergeWatchExperience / experienceToMetadata family); replace `GET_EXPERIENCE`, `GET_WATCH_EXPERIENCE`, `GET_WATCH_SETTINGS` Strapi operations with admin operations using `adminGraphql()` from `@forge/admin-graphql`
- **Files (create / move):**
  - `apps/web/src/lib/fragments/watch-experience.ts` — rebuilt as an `AdminWatchExperience` fragment composing all 17 admin block fragments from `@forge/admin-graphql/fragments`
- **Files (delete):**
  - Strapi-shaped fragment files that are no longer consumed after the rebuild — list compiled during implementation (most of `apps/web/src/lib/fragments/` if every consumer migrates in this unit)
- **Approach:** The renderer's `__typename` switch in `apps/web/src/components/sections/index.tsx` already tolerates the Strapi `ComponentSections*` vs admin `*Block` shape diff via the per-block alias map. Decision per fragment: keep the Strapi-vocab alias (so renderer code is unchanged) OR drop alias and rename renderer access. Default: drop aliases — fresh framing — but defer per-fragment to whichever lowers reviewer cognitive load. Locale handling: admin's `experienceBySlug(locale, slug)` returns `ExperienceLocale` directly (matches what we want); `watchSetting(locale)` returns `{ homepageExperience, defaultTemplateExperience }`.
- **Patterns to follow:** `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` — centralize the admin-query builders so reshape is one signature change per fetch, not N. `docs/solutions/graphql/server-side-strapi-queries-nextjs.md` for the Apollo + `fetchPolicy: "no-cache"` + route-level ISR shape (preserve this).
- **Test scenarios:**
  - **Happy path:** `resolveWatchPage(locale)` returns homepage Experience via `watchSetting.homepageExperience` against seeded fixtures
  - **Happy path:** `resolveWatchPage(locale, slug)` returns the slug Experience via `experienceBySlug`
  - **Edge:** Returns `isWatchPageMissingError` when slug doesn't exist
  - **Edge:** Returns the template Experience via `watchSetting.defaultTemplateExperience` when slug exists but is template-type (or routing path per U7 decision)
  - **Integration:** Slug page route renders correctly end-to-end against seeded fixtures
- **Verification:** Local slug pages render expected content from seeded fixtures.

### U15. Rebuild `content.ts` video resolvers (Video reads)

- **Goal:** Replace `resolveWatchVideo`, `resolveWatchVideoBySlug`, the 6 synthetic-watch-block builders, and the `RouteVideo` Strapi shape with admin equivalents.
- **Requirements:** R10, R11, R12
- **Dependencies:** U13, U5 (Video.parents/children PUBLIC), U6 (videoBySlug locale)
- **Files (modify):**
  - `apps/web/src/lib/content.ts` — rewrite the Video-fetching half (resolveWatchVideo, resolveWatchVideoBySlug, mergeWatchExperience video-template path, the 6 synthetic-watch-block builders); replace `GET_ROUTE_VIDEO`, `getWatchVideoOperation`, `getWatchVideoBySlugOperation` Strapi operations
- **Files (create / move):**
  - `apps/web/src/lib/fragments/watch-video.ts` — rebuilt as a `WatchVideo` fragment composing admin's `Video` type with locale-narrowed `locales(locale: $locale)`, `parents`, `children`, `images`, `variants` (and `studyQuestions`, `bibleCitations` per current shape)
- **Approach:** Admin's `Video` model splits locale-varying fields (description, snippet, imageAlt) to `VideoLocale`. Web's `WatchVideo` fragment needs to flatten the single-locale result client-side (since web only renders one locale at a time per page). Use U6's locale-narrowed `videoBySlug` so the response is small. The synthetic-watch-block builders (`buildHeroBlock`, `buildSiblingCarouselBlock`, `buildWatchBodyBlock`, `buildStudyQuestionsBlock`, `buildBibleQuotesBlock`, `buildShareBlock`) become helpers over the admin Video shape — their output union (renderer block types) is unchanged.
- **Patterns to follow:** Same as U14 — `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`.
- **Test scenarios:**
  - **Happy path:** `resolveWatchVideoBySlug(slug, locale)` returns video with locale-specific description, snippet, imageAlt
  - **Happy path:** SiblingCarousel block built from `Video.parents` and `Video.children` matches expected video list
  - **Edge:** Returns `WatchVideoError` when video doesn't exist
  - **Edge:** `Video.locales` with non-existent locale returns empty array — handle gracefully (404)
  - **Integration:** `/[slug]/[locale]/page.tsx` renders video page end-to-end against seeded fixtures
- **Verification:** Local video pages render expected content; SiblingCarousel populates correctly.

### U16. Rebuild `search.ts` and `recommendations.ts` against admin

- **Goal:** Point semantic search and scene recommendations at admin's `search` and `sceneRecommendations` PUBLIC queries.
- **Requirements:** R10, R11, R12
- **Dependencies:** U13
- **Files (modify):**
  - `apps/web/src/lib/search.ts` — replace Strapi `SEMANTIC_SEARCH` operation with admin's `search(q, locale, type?, limit?, offset?, mode?, debug?)`; update result-type mapping to admin's `HybridSearchResult` shape (already largely compatible per research)
  - `apps/web/src/lib/recommendations.ts` — replace raw `gql` `SCENE_RECOMMENDATIONS` with `adminGraphql()` typed query against admin's `sceneRecommendations(videoId, slug, locale, sceneIndex?, limit?)`; **change `videoId: Int!` to `videoId: ID!`** to match admin's cuid-based type
  - `apps/web/src/lib/recommendations.ts` — replace Strapi `GET_VIDEO_BY_SLUG` with admin's `videoBySlug(slug)` selecting only the fields demo-recommendations needs (`documentId, title, slug, description, images`)
- **Approach:** Both queries already have admin PUBLIC equivalents (verified in research). The `videoId` type flip is a one-line web-side change. Recommendations becomes type-safe via gql.tada instead of raw `gql`. Search's error mapping (`SearchError` with `code`, `message`, `retryAfterSeconds`) preserves.
- **Patterns to follow:** `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md` — sweep with both `rg "graphql\(" apps/web/src` AND `rg "= gql\`" apps/web/src`to confirm`recommendations.ts` was the only raw-gql callsite; if others surface during implementation, fold them in.
- **Test scenarios:**
  - **Happy path:** `searchVideos(query, limit, 0, "video")` returns admin-shaped results
  - **Edge:** `searchVideos` with empty query returns empty results (or per admin's contract)
  - **Edge:** `sceneRecommendations` with non-existent video slug returns empty array (admin returns `[]` for `VideoNotFoundError`)
  - **Edge:** `videoId` is treated as string everywhere (no Int parsing)
  - **Integration:** `/demo-search` and `/demo-recommendations/[slug]/[locale]` render correctly against seeded fixtures
- **Verification:** `searchVideos` returns admin-shaped results in local dev; recommendations page renders against seeded video.

### U17. Rebuild `demo-search.ts` against admin

- **Goal:** Demo-search-detail page uses admin's `videoBySlug` instead of Strapi's `GET_DEMO_VIDEO`.
- **Requirements:** R10, R11, R12
- **Dependencies:** U13, U6
- **Files (modify):**
  - `apps/web/src/lib/demo-search.ts` — replace `GET_DEMO_VIDEO` Strapi operation with `adminGraphql()` typed query against `videoBySlug(slug)` selecting only the fields demo player needs (`documentId, slug, title, description, images, primaryLanguage, variants`)
- **Approach:** Smaller version of U15's `resolveWatchVideoBySlug` — demo doesn't need the full WatchVideo fragment. Use the locale-narrowed `Video.locales(locale)` from U6.
- **Patterns to follow:** Same as U15.
- **Test scenarios:**
  - **Happy path:** `getDemoPlayableVideo(slug, locale)` returns playable variant + image
  - **Edge:** Returns appropriate error for unknown slug
  - **Integration:** `/demo-search/[slug]/[locale]/page.tsx` renders demo player against seeded fixtures
- **Verification:** Demo player renders against seeded video.

### U18. Rebuild `enrichment.ts` and `experience-metadata.ts`

- **Goal:** Update the data-normalization helpers so they consume admin's response shape directly.
- **Requirements:** R10, R11, R12
- **Dependencies:** U14, U15
- **Files (modify):**
  - `apps/web/src/lib/enrichment.ts` — rewrite `enrichMediaItem()` and `enrichRouteRelatedVideo()` against admin's flatter shape: admin's `MediaCollection.items[]` has `videoId` + `imageUrl` directly (no nested `video{...}` join). Either hydrate `videoId` via a separate query (deferred — keep `titleOverride` + `imageUrl` fallback as the renderer already does per `apps/web/src/components/sections/index.tsx:53-70`) or accept the flat shape.
  - `apps/web/src/lib/experience-metadata.ts` — update `experienceToMetadata()` to read from admin's `ExperienceLocale` directly (the metadata fields — `metaDescription`, `ogTitle`, `ogDescription`, `ogImageUrl`, `pathSegment` — are all top-level on `ExperienceLocale` per research)
- **Approach:** Most of `experience-metadata.ts` only changes type signatures. `enrichment.ts` may shrink — the `imageOverride` and `video{...}` joins disappear because admin doesn't emit them; renderer fallbacks already cover the missing data. videoId hydration is a deferred concern (note in plan, not part of this unit).
- **Test scenarios:**
  - **Happy path:** `enrichMediaItem` for admin MediaCollection item returns expected shape
  - **Happy path:** `experienceToMetadata` builds `Metadata` from admin's `ExperienceLocale`
  - **Edge:** Missing `imageUrl` falls back to renderer-side default
- **Verification:** Page `<head>` metadata renders correctly for seeded Experiences.

### U19. Update routes and `/api/revalidate` consumer

- **Goal:** Route handlers point at the new resolvers; cache invalidation path is preserved for U22 to retarget.
- **Requirements:** R10, R13
- **Dependencies:** U14, U15, U16, U17, U18
- **Files (modify):**
  - `apps/web/src/app/page.tsx` — calls `resolveWatchPage(DEFAULT_LOCALE)` (no signature change but imports settle from `@forge/admin-graphql`)
  - `apps/web/src/app/[slug]/page.tsx` — calls `resolveWatchPage(DEFAULT_LOCALE, slug)`; remove any leftover error handling specific to dual-read state
  - `apps/web/src/app/[slug]/[locale]/page.tsx` — calls `resolveWatchVideoBySlug` then falls back to `resolveWatchPage`; `mergeWatchExperience` from admin-shape responses
  - `apps/web/src/app/demo-search/[slug]/[locale]/page.tsx`, `apps/web/src/app/demo-recommendations/[slug]/[locale]/page.tsx` — use admin-backed resolvers from U16/U17
  - `apps/web/src/app/api/revalidate/route.ts` — confirm route shape supports admin's webhook payload (built in U21); no logic change here, just verification that the route handler can accept admin-shaped events
- **Approach:** Mostly type-cleanup — the resolver signatures haven't changed, only their implementations. Verify each route renders against seeded fixtures.
- **Test scenarios:**
  - **Integration:** Each route renders end-to-end against seeded fixtures
  - **Integration:** Route-level `revalidate` is `false` (ISR via webhook only)
  - **Edge:** Routes handle `null` from `experienceBySlug` correctly (404)
- **Verification:** Manual click-through every route in local dev.

### U20. Local admin fixture seeding

- **Goal:** Reproducible local fixture content so every developer can render every web page locally.
- **Requirements:** R15
- **Dependencies:** U5-U8 (admin widenings); fixtures need to exercise the widened surface
- **Files (create):**
  - `apps/admin/scripts/seed-web-fixtures.ts` — TypeScript script that uses admin's existing mutation surface to create a curated set of Experiences (homepage + ~3-5 slug Experiences across locales), Videos (with `parents`/`children` relations), watch settings, languages, countries, keywords
  - `apps/admin/scripts/web-fixtures.json` — checked-in JSON fixture file (the data source the script consumes)
  - `apps/admin/scripts/seed-web-fixtures.test.ts` — script-level test that the seed is idempotent and produces expected shape against a clean local DB
  - `apps/admin/CLAUDE.md` — add a section documenting `pnpm --filter @forge/admin seed-web-fixtures` for new contributors
- **Approach:** Follow the producer-side hash-gated pattern from `docs/solutions/platform/admin-experience-content-dump-pattern.md` for idempotence — keying on a deterministic `(documentId, locale)` so repeated runs don't duplicate. Script ships a `DATABASE_URL` prod-URL guard (refuse to run if host matches a Railway prod host) per the security-lens FYI concern.
- **Patterns to follow:** `docs/solutions/platform/admin-experience-content-dump-pattern.md` for idempotent seeding; admin's existing `pnpm --filter @forge/admin run-sync.ts` script for the operator-discipline + env-var-driven shape.
- **Test scenarios:**
  - **Happy path:** Running the script against an empty local DB seeds the full fixture set; web pages render after running it
  - **Idempotence:** Running the script twice against the same DB produces no duplicates
  - **Safety:** Script aborts with a clear error when `DATABASE_URL` resembles a Railway prod URL
  - **Coverage:** Seeded fixture set covers every page type web renders (homepage, slug Experience, slug video, search-result-shaped content)
- **Verification:** `pnpm --filter @forge/admin seed-web-fixtures` produces a working dev DB; manual smoke of every web page succeeds locally.

### U21. Admin content-revalidation webhook → web

- **Goal:** Replace the Strapi → web revalidation pipeline with an admin-emitted equivalent so ISR cache stays fresh.
- **Requirements:** R10 (cache freshness implicit in "no user-visible regression")
- **Dependencies:** U19
- **Files (create):**
  - `apps/admin/src/services/revalidate-webhook.ts` — server-side webhook emitter. Fires on Experience/Video/WatchSetting publish or update events. POSTs `{ model, slug, locale }` (matching the existing payload shape web's route already handles) to `env.WEB_REVALIDATE_URL` with `Authorization: Bearer ${env.WEB_REVALIDATE_TOKEN}`
  - `apps/admin/src/services/revalidate-webhook.test.ts`
- **Files (modify):**
  - `apps/admin/src/services/experience.service.ts`, `apps/admin/src/services/video.service.ts`, `apps/admin/src/services/watch-setting.service.ts` — wire the webhook emitter into publish/update lifecycle hooks
  - `apps/admin/src/config/env.ts` — add `WEB_REVALIDATE_URL` + `WEB_REVALIDATE_TOKEN` env vars (optional in admin's schema since admin runs without web in some envs)
  - `apps/web/src/app/api/revalidate/route.ts` — verify bearer token, payload validation
  - `apps/web/src/env.ts` — add `STRAPI_REVALIDATE_TOKEN` rename to `ADMIN_REVALIDATE_TOKEN` (matching the new producer); flip to required
- **Approach:** Mirror Strapi's existing webhook shape so web's `/api/revalidate` route doesn't need redesign — only its trust anchor changes from Strapi's signing token to admin's. Doppler env: `WEB_REVALIDATE_URL` + `WEB_REVALIDATE_TOKEN` on admin's project; `ADMIN_REVALIDATE_TOKEN` on web's project. Receiver (web) deploys token entry first; producer (admin) deploys POST URL+token second — per the receiver-first deploy discipline in `docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md`.
- **Patterns to follow:** `docs/solutions/graphql/server-side-strapi-queries-nextjs.md` for the ISR-via-webhook shape (preserve it).
- **Test scenarios:**
  - **Happy path:** Publishing an Experience in admin triggers the webhook; web's `/api/revalidate` receives the payload and calls `revalidatePath` for the matching slug+locale
  - **Happy path:** Same for Videos and WatchSettings
  - **Edge:** Invalid bearer rejected with 401; payload validation rejects malformed events with 400
  - **Edge:** Webhook is best-effort (admin doesn't fail the publish if the POST fails); failed posts log structured events for ops follow-up
  - **Integration:** End-to-end: publish in admin → wait < 30s → fetch slug page in web → see updated content
- **Verification:** Local end-to-end: seed fixture, edit Experience in admin's editor, observe page refresh on web within a few seconds.

### U22. Final verification and Tier-2 review checkpoint

- **Goal:** Confirm every page renders correctly against seeded fixtures; run Tier-2 code review before merging the branch.
- **Requirements:** R10, R16
- **Dependencies:** U2-U21
- **Files:** No new files — this is a verification + review unit
- **Approach:** Three steps:
  1. **Local smoke checklist** — click through every web route (`/`, `/[slug]`, `/[slug]/[locale]`, `/demo-search`, `/demo-search/[slug]/[locale]`, `/demo-recommendations/[slug]/[locale]`) against seeded fixtures. Verify locale switching, error states (404), and webhook revalidation after editing a fixture
  2. **Grep audit for migration vocabulary** — `rg -i 'parity|canary|cutover|consumer-migration|FORGE_CONTENT_API|dual-read|admin-mode' apps/web packages/admin-graphql` returns zero results (matches R11). Allowed exceptions: comments referencing past learnings or origin docs, if any
  3. **Tier-2 ce-code-review** — run with the routing rule favoring Apply for reliability/security/correctness findings at confidence 75+. Address findings before push to integration branch
- **Patterns to follow:** `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md` for Tier-2 routing discipline.
- **Test scenarios:** Test expectation: none — verification unit. Smoke checklist + grep audit + review are the verification.
- **Verification:** All web routes render expected content from fixtures; grep returns zero migration-vocab matches; Tier-2 review finds no P0/P1 unresolved items.

---

## Key Technical Decisions

- **Admin widenings ship as the first units inside the rebuild branch, not as separate PRs to main before fork (deviation from origin R17).** Decided during planning (2026-05-14): U5-U7 (the three admin-side widenings) and U8 (a small web-side cleanup that removes the need for a fourth widening) are bundled with the rebuild for sequencing simplicity. R8/R9's spirit ("admin's prod posture stays untouched") is preserved in the sense that U5-U7 are additive, not reverts. The trade-off: the rebuild branch carries admin source changes (more reviewer scope) but ships with everything coherent in one merge.
- **The new `packages/admin-graphql` package consumes admin's committed SDL only, never `apps/admin/src/domain/*` source.** Sidesteps the tsx-ESM trap in `docs/solutions/runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md`. Eliminates the ESM/CJS workaround at `apps/admin/src/domain/package.json`. Does not require promoting `apps/admin/package.json` to `"type": "module"`.
- **Package naming: `@forge/admin-graphql` at `packages/admin-graphql/`.** Matches existing `@forge/graphql` convention. Web imports `import { adminGraphql, AdminFragmentOf } from "@forge/admin-graphql"`.
- **`ADMIN_GRAPHQL_URL` and `WEB_ADMIN_API_KEYS` flip from `.optional()` to required in U13.** Railway provisioning is a precondition before that unit lands (lesson from `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`).
- **No new harness, no parity, no canary — verification is local-fixture smoke + types + Tier-2 review.** Honors origin R16; substitutes manual click-through for automated comparison.
- **Strapi-shape fragment aliases (e.g., `adventTitle: title`) drop where possible.** Default to admin's native field names in rebuilt fragments. Preserve an alias only when removing it would force a parallel rename in renderer code that isn't worth the cognitive cost in this rebuild.
- **Revalidation webhook is built (admin emits → web receives) rather than time-based fallback.** Honors the brainstorm's "no user-visible regression" success criterion at production cache-freshness parity.

---

## Risks & Dependencies

- **Production content prerequisite.** Admin prod has no Experience content (`docs/solutions/workflow-issues/parity-harness-prod-gate-defects-20260514.md`). When the rebuild branch merges, web flips to admin-only reads — every Experience page 404s until content lands in admin prod. The content-into-prod-admin path is out of scope for this brainstorm (origin Scope Boundaries) but is the load-bearing pre-cutover gate. The merge can land WITHOUT content (the code works); the public flip requires content. Surface this in the merge PR description and runbook.
- **Long-lived branch divergence.** Critical fixes ship to `main` during the rebuild window. Each fix touching `apps/web/src/lib/`, shared types, or `apps/admin/` may need to rebase into the branch. If 2-3 critical fixes land per week (origin Deferred / Open Questions), rebase cost compounds. Trigger: if more than 5 rebases happen, reconsider per-route incremental cutover or accelerate the rebuild scope.
- **CONSUMER_BEARER rotation midway through the rebuild.** Rare but possible. Procedure documented in U13. If it happens, admin's `WEB_ADMIN_API_KEYS` CSV must add the new key before web's `WEB_ADMIN_API_KEYS` env var updates, or web's queries 401 in the gap.
- **Admin widening surprise gaps.** Research surfaced 4 known gaps. A 5th could surface during U14-U17 implementation (e.g., a field the audit missed). Handle: ship the widening on the branch as a new admin-side unit; do not bypass with a service-bearer escalation.
- **ESM/CJS regression risk.** New package consumes admin's SDL artifact only, not source. If a future change adds a `from "@forge/admin/..."` import to `packages/admin-graphql`, the tsx-ESM trap returns. Codified in U12's CLAUDE.md.
- **Mobile/TV consumption assumption.** Research confirmed mobile and TV only import `graphql()` and `ResultOf` from `@forge/graphql`. If that changes mid-rebuild (a mobile or TV PR adds an admin import), the U3 trim breaks them. Watch for this in the branch's rebases from main.

---

## Scope Boundaries

- How content reaches production admin (Strapi sync, manual re-entry, one-shot import) is owned outside this plan. The rebuild branch can merge without prod content; the public flip cannot happen until content exists.
- Mobile and TV rebuilds are out of scope. They continue reading Strapi through the trimmed-but-still-present `packages/graphql`. Their migrations follow separate brainstorms.
- Strapi decommission (deleting `apps/cms`, removing its Railway service) happens after mobile and TV migrate. Not in this plan.
- Admin-side reverts of any kind are excluded (origin R8, R9). PARITY_BEARER teardown (U4) is the only admin-side change tied to a revert, and it's removing scaffolding, not undoing widening.
- Strapi-half cleanup of `packages/graphql` beyond what U3 does. The package stays in place for mobile/TV; it gets deleted when those apps migrate.
- Unrelated UI work that landed on main in parallel during the brainstorm (#920 Bible Quotes, #913, #923 video page polish, #936 language switcher) is not reverted. Critical fixes during the rebuild window are exempt from the freeze.

### Deferred to Follow-Up Work

- **`MediaCollection.items[].videoId` hydration on the web side.** Admin returns flat `videoId` instead of nested `video{...}`. The renderer's existing fallback to `titleOverride` + `imageUrl` is sufficient; full hydration is a separate optimization PR (see `apps/web/src/components/sections/index.tsx:53-70` for the renderer's current tolerance).
- **`packages/graphql` deletion.** The Strapi-only trimmed package stays in place until mobile and TV migrate. When they do, delete it entirely.
- **Promote `apps/admin/package.json` to `"type": "module"`.** Not required for this rebuild (the new package's SDL-only consumption sidesteps the ESM trap). Worth doing as a separate PR with its own Tier-2 review per `docs/solutions/runtime-errors/tsx-esm-named-export-resolution-across-workspace-package-boundary-20260508.md`.

---

## Outstanding Questions

### Deferred to Implementation

- [Affects U7] Choose Option A (widen `Experience.isTemplate` to PUBLIC) vs Option B (refactor `resolveSlugPage` to use `watchSetting.defaultTemplateExperience`). Default Option A; defer the decision until U7 implementation surfaces a concrete reason to prefer Option B.
- [Affects U14] Per-fragment decision on whether to keep or drop Strapi-vocabulary aliases (`adventTitle: title`, `ctaHeading: heading`, etc.). Default: drop; revisit per fragment if removing forces a parallel rename in renderer code that exceeds the cognitive cost of keeping the alias.
- [Affects U6] If Pothos relation-arg pattern (`Video.locales(locale)`) doesn't compose well with the existing `videoBySlug` projection, switch to Option B (`videoBySlug(slug, locale)` overload). Decide during U6 implementation.
- [Affects U20] Final fixture scope — how many Experiences and Videos to seed. Aim for "every web page renders" coverage; expand if specific edge cases (multi-locale fallback, deep-link Video parents/children) need exercising.
- [Affects U21] Webhook payload schema details (admin's event names, field set). Resolve when wiring the emitter; align with web's existing route handler so the receiver shape doesn't need rework.
