---
date: 2026-05-05
topic: consumer-migration-implementer-brief
---

# Consumer-Side Strapi → Admin Migration — Implementer's Brief

## Summary

A web-implementer's brief for the consumer-side migration from Strapi to admin: build a typed dual-client in `packages/graphql`, ship one canary experience page on admin's existing PUBLIC schema, then expand sequentially to the rest of web, mobile, and TV behind a reversible flag. As of 2026-05-07, Urim owns both consumer-side and admin-side execution end-to-end (admin PUBLIC widenings, CI, env vars, and the consumer routes themselves) — there is no longer a cross-owner handoff.

---

## Problem Frame

The repo currently runs two content planes side by side. Strapi (`apps/cms`) has been the production content API for public consumers for over a year. `apps/admin` is the strategic replacement — its data plane (R1-R5 of Nisal's playbook: scene/transcript embeddings, experience content migration, hybrid search, recommendations API) has fully landed since 2026-04-29.

The consumer-side cutover — the layer that moves `apps/web`, `apps/mobile`, and `apps/tv` from reading Strapi to reading admin — is sequenced under feat-104 (`docs/plans/2026-04-22-001-feat-admin-core-consumer-migration-plan.md`, owned by tataihono). As of the audit run on 2026-05-05, none of feat-104's seven implementation units have started. The plan was last touched 2026-04-24 and tatai's actual queue has been admin-internal editorial features (media library, editor controls, core-sync hardening) for the last 14 days. The web app has continued shipping Strapi-coupled feature work in the same window, accumulating more callsites that will eventually need migration.

The cost of waiting longer is not zero: every week that passes adds new Strapi-typed query surface, mobile/TV cutover blocks behind web, and the strategic risk that admin's editor and consumer paths diverge in ways that make a one-shot cutover harder. Web/mobile/TV are explicitly Urim's ownership per the project memory; the gap is execution capacity, not authority.

---

## Actors

- A1. **Urim (sole owner):** owns both consumer-side (`apps/web`, `apps/mobile`, `apps/tv`, `packages/graphql`) and admin-side (`apps/admin` GraphQL surface, permission system, schema, deployment env vars, CI) execution and decisions for this migration. As of 2026-05-07, tatai has handed full ownership over — there is no longer a cross-owner split.
- A2. **Web / mobile / TV end users:** consume content rendered from whichever backend the per-route flag points at. Must observe no behavior change during canary, ramp, or rollback.
- A3. **Automated parity comparator:** runs in `dual-read` mode. Fetches both Strapi and admin in parallel, normalizes, compares, and emits structured diffs.

---

## Key Flows

- F1. **Per-route resolution under dual-read.**
  - **Trigger:** Consumer app renders a route covered by a content-source flag set to `dual-read`.
  - **Actors:** A2 (end users), A3 (parity comparator).
  - **Steps:** App resolves data from Strapi as the user-facing source. In parallel, the same logical query is issued against admin and normalized to the route's expected shape. The two normalized shapes are compared; structured diff is emitted to logs/metrics. The user response renders from Strapi only.
  - **Outcome:** User sees Strapi-rendered content unchanged. Operations team sees a parity signal for that route.
  - **Covered by:** R5, R7, R12, R13.

- F2. **Per-route migration progression.**
  - **Trigger:** A consumer app route is selected for migration.
  - **Actors:** A1, A3.
  - **Steps:** Route lands in `strapi` mode (no admin fetch). Switches to `dual-read` for parity collection over a defined window. When parity diff rate falls below the threshold defined in R18a, switches to `admin-with-fallback` mode (admin is the rendering source; Strapi retained as fallback). Once the fallback-save rate (R17a) meets its stricter threshold for its stricter window, fallback is removed for that route.
  - **Outcome:** Route reads from admin in production. Strapi callsites for that route are deleted.
  - **Covered by:** R5, R7, R8, R17, R17a, R18, R18a.

- F3. **Rollback during canary or ramp.**
  - **Trigger:** Admin returns broken data, elevated error rate, or unacceptable parity diff after a route has moved off `strapi` mode.
  - **Actors:** A1, A2.
  - **Steps:** Operator flips the route's content-source flag back to `strapi`. Affected caches are cleared per the runbook. The runbook's verification step confirms zero requests served by admin source for the rolled-back route within the verification window. No code revert, no redeploy.
  - **Outcome:** Route serves Strapi-rendered content immediately. Investigation proceeds without user-visible disruption.
  - **Covered by:** R17, R17a, R19.

---

## Requirements

**Dual-client foundation (Unit 3)**

- R1. `packages/graphql` exports a second typed GraphQL factory bound to admin's schema, sitting alongside the existing Strapi factory. Both factories are independently typed; mixing a query bound to one with a result type from the other is a TypeScript error. The gql.tada plugin uses the multi-schema configuration shape (`schemas: [...]` array in tsconfig with per-entry `name`, schema path, and `tadaOutputLocation`), and each factory passes its `name` to `initGraphQLTada` so the introspection types do not conflate.
- R2. Admin's schema is sourced as a static SDL artifact committed to the repo, mirroring the existing Strapi pattern. The artifact is regenerated by an admin-side script that emits SDL from admin's Pothos schema; downstream codegen does not require admin to be running.
- R2a. CI verifies that the live Pothos schema matches the committed SDL artifact and fails the build on drift. The check lives as a new `admin-schema-drift` job in `.github/workflows/ci.yml`, mirroring the existing `graphql-generate` job and gated on `@forge/admin` affected via Turbo's `--affected` detection — there is no separate "admin pipeline", just a job in the shared `forge-ci` workflow. Without this check, consumer-side codegen can silently drift from the live schema between admin merges and consumer canary.
- R3. The first dual-client landing is a small, standalone PR with no consumer-side migration changes attached. Existing Strapi callsites in web, mobile, TV, and manager continue to type-check and run unchanged after merge. The dual-client's admin factory issues anonymous HTTPS calls (no `Authorization` header) by default; non-PUBLIC admin queries are out of scope for the dual-client until Unit 2 widens those resolvers' auth scopes.

**Consumer query and shape inventory (Unit 1)**

- R4. A short inventory document records every Strapi GraphQL operation in `apps/web`, `apps/mobile`, and `apps/tv`, with each operation tagged for admin parity status (already-PUBLIC on admin, needs admin schema widening, needs new admin resolver, or adapter-only encoding mismatch). The inventory must enumerate every `graphql(` callsite in those apps, not only the operations in `apps/web/src/lib/content.ts`. As of 2026-05-06, the in-scope callsite count is 27 (`apps/web`) + 18 (`apps/mobile`) + 18 (`apps/tv`) = 63 across consumer apps; the inventory PR's definition of done is enumerating all 63 (refresh the count at PR time, since concurrent feature work may add more — see Outstanding Questions on inventory staleness). The inventory becomes the source of truth for migration completion (see Success Criteria).

**Web canary slice (Unit 5 — first route)**

- R5. The first canary is a single non-homepage experience route that depends only on admin's currently-public `experienceBySlug` query. No admin-side schema additions are required to start.
- R6. A web-side block adapter translates admin's JSON-encoded `blocks` shape to the typed-block shape the existing renderer dispatch consumes. The adapter is fixture-tested with examples of every block variant the consumer renders today.
- R6a. The block adapter has a defined unknown-variant contract: when admin emits a block whose discriminator the adapter does not recognize, the adapter logs a structured warning capturing the discriminator value, skips the unknown block from rendering (does NOT throw or crash the route), and emits a metric so the first occurrence triggers an alert. Urim runs a recurring (monthly) audit diffing admin's `src/domain/blocks.ts` Zod union against the web adapter's coverage so adapter gaps surface before they appear in production.
- R7. A `dual-read` mode is available per route via a `FORGE_CONTENT_API` flag (values: `strapi`, `admin-with-fallback`, `admin`, `dual-read`). In `dual-read`, Strapi remains the rendering source and admin is fetched in parallel for parity logging only — admin failures do not break user-facing rendering.
- R8. When the canary route is in `admin` mode, an admin failure does not crash the route. Failure surfaces as a route-level error matching the existing Strapi failure semantics (the listener that today distinguishes "no experience found" continues to behave consistently).

**Web migration expansion (Unit 5 — remaining routes)**

- R9. After the canary route has held in `admin` mode for the parity-clean window defined in R18a, remaining web routes (homepage, additional experience-slug routes served by `[slug]/page.tsx`, watch-video, watch-video-by-slug) migrate one at a time using the same dual-read → admin progression. Watch-video and watch-video-by-slug depend on Unit 2 widening `videoBySlug`/`videos` auth scopes — Urim ships those widenings before or alongside their consumer migration. Routes whose admin queries are already PUBLIC migrate first.
- R10. Routes that depend on admin schema additions not yet exposed PUBLIC (homepage's `watchSetting` equivalent, watch-video's `videoBySlug`/`videos`, reference data) wait until those resolvers are widened. Sequencing is Urim's call: widening can land in the same PR as the canary, alongside Unit 3, or after canary parity holds — whichever optimizes review hygiene per change. The widenings include the explicit PUBLIC projection that strips internal fields (`ownerId`, `isTemplate`, internal timestamps) before anonymous reads.
- R11. The web app's existing cache and revalidation contract (route ISR, `unstable_cache` revalidation windows, response-source-aware fetch policies) is preserved through migration. No consumer-visible cache behavior change during canary or ramp.

**Parity harness (Unit 4 — sequenced ahead of Unit 5 dual-read)**

- R12. A parity comparator lives in `packages/graphql` and compares normalized route data (not raw GraphQL JSON) between Strapi and admin sources. It produces structured diffs identifying field-level mismatches.
- R12a. The comparator's diff taxonomy is explicit and covers four classes: structural (field presence — extra or missing fields), value (deep equality on present fields), order (ordered-collection identity), and semantic (locale-correctness for localized content, ID identity preservation, URL canonicalization). Each class has a fixture covering a known-bad admin response (off-by-one locale, missing field, swapped collection order). Structural and semantic mismatches are blocking; value and order mismatches are configurable per route.
- R13. The comparator is fixture-driven first. Live-comparison mode (running against staged admin data) is gated on the fixture suite passing and on auth/env wiring being stable. Unit 4's fixture-driven comparator must land before or in the same PR as the Unit 5 canary's `dual-read` mode; without it, dual-read produces no observable parity signal and the canary's value is lost.
- R14. The comparator's output is suitable as PR evidence: structured diff format, deterministic ordering, no spurious noise from timestamps or non-canonical ID ordering.

**Mobile and TV migration (Unit 6)**

- R15. Mobile and TV cutover begin only after the web full migration is complete and stable in production. Mobile precedes TV.
- R16. Mobile and TV renderer prop contracts are not changed by the migration. The existing normalizers absorb the admin-shape differences. Cache-key versioning strategy for Apollo persisted-cache (per-block-discriminator vs schema-hash vs app-version-tied wholesale wipe) is deferred to Unit 6 research; mobile/TV cutover does not advance to `admin` mode without a documented experiment validating the chosen strategy on the Strapi-cached → admin-fresh upgrade path.

**Rollout, observability, rollback (Unit 7)**

- R17. Rollback is performed by flipping a route's content-source flag and clearing affected caches. No code revert and no redeploy is required to roll back a consumer route from admin to Strapi. The runbook's cache-clear step is idempotent and re-runnable, and includes a verification step confirming zero requests served by admin source for the rolled-back route within a defined verification window.
- R17a. The transition from `admin-with-fallback` to `admin` (fallback removed) has its own go/no-go criterion, distinct from the dual-read → admin transition. Gated on a fallback-save rate metric (count of admin failures caught by Strapi fallback / total admin-mode requests for that route) below a stricter threshold for a stricter window than the parity-clean window. This prevents the fallback from masking accumulated admin issues that surface all at once when removed.
- R18. Migration progress is observable in production with at minimum: parity diff rate per route (broken down by R12a's four classes), admin GraphQL error rate, missing-content rate (admin returned no result where Strapi would have), route-render failure rate, fallback-save rate per route, anonymous-traffic 401/403 counts per route (auth-failure signal), and 429 rate-limit events keyed by identity bucket type (per-user vs per-IP vs per-app). Observability surfaces span both consumer-side logging/metrics and admin-side dashboards; both sides are Urim's queue, and admin dashboard mods land alongside the consumer work that needs them.
- R18a. Thresholds for "clean" observation windows are defined before the canary route advances to admin mode. At minimum: parity diff rate, admin error rate, missing-content rate, and fallback-save rate must each be defined with a numeric threshold and a duration in the runbook. The exact numbers are appropriately deferred to planning, but the requirement to define them before any route advances is hard.
- R19. A runbook documents the per-consumer go/no-go criteria, the rollback procedure, the stages a route must pass through (`strapi` → `dual-read` → `admin-with-fallback` → `admin` → Strapi fallback removed), and the metrics and thresholds that gate progression. Pre-canary checklist includes setting admin's `CORS_ALLOWED_ORIGINS` and `AUTH_TRUSTED_ORIGINS` Railway env vars to include the consumer-app origins that will issue requests in dual-read mode (Urim updates these directly alongside the canary PR).

---

## Acceptance Examples

- AE1. **Covers R1.** Given the dual-client has shipped, when a developer writes a query bound to the Strapi factory and assigns its result to a variable typed by the admin `ResultOf` utility (or vice versa), the assignment fails at TypeScript compile time.
- AE2. **Covers R5, R7, R8.** Given the canary route in `dual-read` mode, when admin returns a 5xx or malformed response, the user-facing rendering still completes from Strapi and the parity comparator records the admin failure as a diff entry, not a route-render failure.
- AE3. **Covers R7, R17.** Given a route currently in `admin` mode, when an operator flips its flag value to `strapi` and runs the documented cache-clearing step, the next request for that route renders from Strapi without a redeploy and the runbook's verification step confirms zero admin-source traffic for that route within the verification window.
- AE4. **Covers R10.** Given the homepage route has no admin PUBLIC equivalent for `watchSetting` resolution, when the migration sequence reaches the homepage, the homepage stays in `strapi` mode and the migration proceeds to other routes that do not depend on Unit 2 widenings yet.
- AE5. **Covers R6, R6a, R12, R12a.** Given an experience whose admin record contains every supported block variant, when the block adapter normalizes admin's response and the parity comparator compares the result against the Strapi response for the same logical experience, the structured diff is empty across all four diff classes (structural, value, order, semantic). When admin emits a block discriminator the adapter does not recognize, the adapter logs a structured warning, skips that block, and the route renders successfully.
- AE6. **Covers R15.** Given the web migration is incomplete, when a mobile or TV migration is attempted, the runbook's go/no-go checklist (R19) blocks operator advance and an explicit operator decision is required to override — mobile and TV cannot ride a partially-migrated web cutover by default. (Process check, not system enforcement.)

---

## Success Criteria

- **Canary mechanics validated.** The dual-client, block adapter, parity comparator, dual-read flag, and rollback runbook all function as specified for the canary experience route, observed via `admin` mode in production for the duration defined in R18a.
- **Web migration complete.** All operations enumerated in the R4 inventory document — across `apps/web/src/lib/content.ts`, `apps/web/src/lib/fragments/`, search, recommendations, and any other `graphql(` callsites — render from admin in production for the duration defined in R18a, with parity-clean windows met for each.
- **Mobile and TV migration complete.** Mobile and TV consumers issue zero GraphQL queries against `apps/cms` for the routes covered by this migration, observed via production telemetry for the duration defined in R18a post-cutover.
- **Self-evident factory choice.** A new contributor adding a query to `apps/web` can identify which factory to use (`graphql` vs `adminGraphql`) and verify their query type-checks against the correct schema without needing to ask. The dual-client distinction is self-evident from the import paths and naming.
- **Rollback executable from runbook alone.** Rollback for any migrated route can be demonstrated end-to-end in staging without a code change. The runbook is precise enough that an on-call engineer who has not worked on this migration can execute a rollback from the runbook alone.

---

## Scope Boundaries

- Admin-side schema rewrites beyond the migration's needs are out. The migration includes targeted PUBLIC widenings (`videoBySlug`/`videos`/reference query auth scopes, a `watchSetting`-equivalent resolver, the explicit PUBLIC projection that strips `ownerId`/`isTemplate`/internal timestamps) — these are Urim's to ship as part of Unit 2, sequenced before or alongside the consumer routes that need them. Net-new admin features unrelated to consumer migration are out.
- `apps/manager` cutover (R9 of Nisal's playbook) is out. Manager keeps writing to Strapi until tatai/Nisal sequence its own cutover separately.
- Strapi decommission (`feat-022` kill switch, `apps/cms` deletion) is out. Once all consumer apps are reading admin in production, the platform team owns Strapi removal as a downstream task.
- Personalization stack (R6 of Nisal's playbook — watch events, FPMC, Two-Tower, A/B logging) is out. Built natively in admin separately.
- Revalidation webhook redesign (R7 of Nisal's playbook — admin emitting revalidation events to apps/web) is out. Web's existing revalidation listener contract is preserved unchanged during this migration; admin-side webhook work is owned separately.
- Schema stitching, GraphQL gateway, or any Strapi-compatibility shim on admin is out. Per the existing plan, admin schema decisions stay clean; consumers absorb encoding differences via adapters.
- Dual-write at any layer is out. No phase exists where both Strapi and admin receive the same writes.
- Re-embedding scene/transcript vectors or any data-plane work is out. R1-R5 of Nisal's playbook are already shipped; this migration is read-path only.
- Admin editor UX parity with Strapi is out. The migration does not wait for editor parity; admin's editorial surface evolves on its own track.
- Big-bang regen of `packages/graphql` against admin's schema is out for the duration of this migration. The dual-client coexists with Strapi until consumer cutover is complete; only then does `packages/graphql` collapse back to single-target admin (see Key Decisions for the sunset trigger).

---

## Key Decisions

- **Dual-client over single-client during the migration window.** Two typed factories coexist in `@forge/graphql` until consumer cutover is complete. Rationale: a multi-week, per-route migration across web/mobile/TV with different release cadences requires both schemas live in the same runtime for type safety, parity checking, and per-route rollback. Single-client (regenerate against admin) was rejected because it breaks all existing callsites simultaneously and removes the rollback path. The dual-client is explicitly temporary scaffolding — when Strapi is decommissioned, `packages/graphql` collapses to single-target admin.

- **Dual-client sunset trigger and owner.** A dual-client cleanup ticket is opened on the same day mobile and TV both report their first parity-clean window in `admin` mode (no fallback). Urim owns that ticket. If Strapi decommission has not started within 8 weeks of full consumer cutover, raise it to engineering leadership rather than silently absorb the carrying cost of two factories, two SDLs, the adapter layer, the parity harness, and the runbook.

- **Phased per-route cutover behind a reversible flag, not a one-shot R8 swap.** Rationale: Nisal's playbook argues for one-shot at R8 once admin has full coverage, but feat-104's plan explicitly chose phased dual-source. This brief inherits feat-104's choice. One-shot is rejected because mobile and TV have different release cadences than web (EAS, TestFlight, app store reviews) and cannot ship atomically with a web cutover. The cadence numbers that justify phased over one-shot are deferred to planning (see Outstanding Questions).

- **Adapter in the consumer, not a Strapi-compatibility schema in admin.** Rationale: admin's block model (JSON-encoded with Zod-validated discriminators) is a deliberate departure from Strapi's typed-component dynamic-zone shape. Cloning Strapi's wire format on admin would freeze admin's data model behind Strapi's, defeating the point of the migration. Encoding differences are absorbed by web/mobile/TV-side adapters whose lifetime ends with the migration.

- **First canary is a single non-homepage experience route, not the homepage and not the watch-video flow.** Rationale: only `experienceBySlug` is currently PUBLIC on admin. A non-homepage experience route is the only first-slice option that requires no prior Unit 2 widening. The canary validates dual-client + adapter + flag mechanics; it does NOT validate homepage or watch-video parity, which depend on Unit 2 widenings and are the long-pole risks. This sequencing keeps the first PR small and lets Unit 2 widenings land in their own PRs as the migration reaches each route that needs them.

- **Admin schema is committed SDL, not live introspection.** Rationale: admin disables introspection in production via `@envelop/disable-introspection`. Sourcing schema from a committed SDL artifact (mirroring Strapi's `apps/cms/schema.graphql` pattern) avoids depending on a running admin during codegen and matches the workspace convention. Drift is prevented by the CI check in R2a, owned by admin's pipeline.

- **Unit 3 lands as a small standalone PR before any consumer migration code.** Rationale: dual-client is the foundational interface every consumer-side query will be written against. Landing it cleanly first, without dependent work attached, makes review hygiene tractable (one concern per PR) and gives a single revertable unit if the typed-client shape needs revision. Even with single ownership, foundational scaffolding deserves to land before the work that depends on it.

- **Sync with tatai before opening Unit 3 — REMOVED 2026-05-07.** Tatai handed full ownership over; the design-sync gate is gone. The five technical decisions that the sync would have locked (factory naming, schema-source convention, scalar mappings, CI integration shape, Turborepo task-graph wiring) are recorded directly in `docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md` as Urim's confirmed defaults.

---

## Dependencies / Assumptions

- **Admin-side prerequisites are Urim's queue, sequenced before the consumer routes that depend on them.** Specifically: (a) admin's Pothos schema emits deterministic SDL via `printSchema` (script at `apps/admin/src/scripts/print-schema.ts` — not yet built), (b) the `admin-schema-drift` CI check in R2a, (c) admin Railway env var updates (`CORS_ALLOWED_ORIGINS` and `AUTH_TRUSTED_ORIGINS`) before the canary opens, (d) the explicit PUBLIC projection that strips internal fields (`ownerId`, `isTemplate`, internal timestamps) from `experienceBySlug` results before consumer apps issue anonymous reads in production. Each lands in its own PR or alongside the consumer change that needs it; Urim sequences as he sees fit.

- **Admin's `apps/admin/src/graphql/types/experience.ts` `experienceBySlug` resolver continues to return everything the canary route needs from its existing PUBLIC scope, including all blocks attached to the experience locale.** This is the case in the codebase as of 2026-05-07.

- **Admin's runtime is operationally stable enough to absorb production-rate read traffic for at least one consumer route.** This has not yet been load-tested under consumer-app traffic; it is an assumption to be validated during canary. Rate-limit capacity specifically (admin's anonymous-IP 60/min ceiling collapsing under shared-egress consumer traffic) is unverified and must be either capacity-tested or addressed by a per-app service-bearer identity before consumer traffic reaches production.

- **The existing web revalidation listener (the endpoint Strapi calls when content publishes) continues to function unchanged during migration.** Admin's revalidation webhook (R7 of Nisal's playbook) is out of scope; the assumption is that the existing Strapi-side webhook keeps caches fresh for any route that is still rendering from Strapi.

- **Mobile and TV's existing normalizer architecture (the `kind`-discriminator union on the consumer side) can absorb admin's block shape via the same adapter pattern web uses, with native-specific concerns layered separately.** This has not been verified beyond reading the mobile and TV normalizer files; some structural divergence may surface during Unit 6.

---

## Outstanding Questions

### Deferred to Planning

- **[Affects R5][Technical]** Which specific non-homepage experience route is chosen as the canary (`/easter/[locale]`, `/christmas/[locale]`, or another)? Selection criteria: route stability over the next few weeks, low edit churn, representative block coverage, ability to validate parity against a known-good Strapi response.
- **[Affects R6][Technical]** Adapter placement: lives in `apps/web/src/lib/` (web-only), in `packages/graphql/` (shared with mobile/TV), or split (a shared core in `packages/graphql` with consumer-specific extensions per app)? Trade-off is reuse vs coupling.
- **[Affects R7][Technical]** `FORGE_CONTENT_API` flag granularity: per-app process-level (one value for all routes), per-route via a route-aware lookup, or per-request via a header for staged rollout? Storage mechanism (env var vs config store) materially affects R17's "no redeploy" claim — env-var-only means a "per-route" rollback is actually a service redeploy, contradicting R17.
- **[Affects R12, R12a][Technical]** Comparator implementation pattern: pure-data normalizers + structural diff, or a property-test approach with generated fixtures? Plan suggests the former; planning can confirm against expected fixture volume.
- **[Affects R10][Needs research]** Exact list of admin PUBLIC schema widenings Urim ships in Unit 2 after canary. Today the audit identifies known gaps (`videoBySlug` auth-scope, reference data auth-scope, `watchSetting` equivalent, explicit PUBLIC projection that strips `ownerId`/`isTemplate`/internal timestamps), but the canary may reveal additional gaps (e.g., embedded-image URL handling, locale-fallback semantics, sensitive fields embedded in block payloads) that are only discoverable end-to-end.
- **[Affects R16][Needs research]** Mobile and TV's Apollo persisted-cache invalidation strategy when block shapes change. Three candidate approaches: per-block-discriminator versioning (correct, complex), schema-hash key derivation (deterministic, may over-invalidate), app-version-tied wholesale wipe (simple, loses unrelated cache). Resolution requires a documented experiment validating the chosen approach on the Strapi-cached → admin-fresh upgrade path. Mobile cutover does not advance to `admin` mode without this resolved.
- **[Affects R18, R19][Technical]** Concrete observability surfaces: are parity diff rates, auth-failure signals (401/403), 429 rate-limit events, and fallback-save rates emitted to existing logging, to a new dashboard, or to the admin app's `/dashboard/system-status` page? Planning should pick the lightest-weight surface that meets R18.
- **[Affects R18a, R19][Technical]** Numeric thresholds for the parity-clean window (parity diff rate, observation duration) and for the fallback-removal window (fallback-save rate, stricter duration). These are gating thresholds for route progression and must be defined before the canary advances. Aggressive (24h) vs conservative (30d) durations materially shift the migration timeline.
- **[Affects Key Decisions — phased-vs-one-shot][Needs research]** Concrete cadence anchors for EAS/TestFlight (mobile) and TV-store release cycles, and the resulting overlap window where Strapi must keep serving while mobile/TV catch up. The dual-client carrying cost (R1–R3 + R12–R14 + R17–R19) needs to be sized in weeks and compared against the overlap window. If the overlap is small, the one-shot alternative (web ships at R8, mobile/TV defer behind a thinner shim) becomes viable.
- **[Affects R10, security][Needs research]** Exact rate-limit identity strategy for consumer-side admin reads: (a) a per-app service bearer token (distinct from `WORKFLOW_API_KEYS`) that produces a per-app key, or (b) a distinct Redis key prefix for consumer SSR traffic, or (c) accepting the shared anonymous bucket and capacity-testing it. Resolution determines whether admin's 60/min anonymous bucket survives production consumer traffic without starving editorial users.
- **[Affects R4, R8][Technical]** Inventory staleness: by the time Unit 5 ships, web will have added new `graphql(` callsites from concurrent feature work. Decide whether to (a) add a CI lint failing on any new `graphql(` callsite that isn't tagged with admin-parity status in the inventory, or (b) freeze concurrent Strapi-coupled feature work in `apps/web` for the migration duration with explicit org-level agreement. Status quo (rely on memory) is rejected.

---

## Status as of 2026-05-07

Snapshot of where this work sits in the repo. Update or extend on the next material change.

- **Ownership change (2026-05-07):** Tatai handed full ownership of the migration over to Urim — both consumer-side and admin-side, decisions and execution. Unit 1 (design sync with tatai) is removed; tatai availability budgets, escalation paths, and concrete-asks workflow are all gone. The brief and Unit 3 plan reflect the single-owner shape.
- **All five Unit 3 design decisions are locked** (recorded in `docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md`):
  1. Factory naming: `adminGraphql` + `AdminResultOf` / `AdminFragmentOf` / `AdminVariablesOf`. Strapi keeps bare names.
  2. Schema-source: SDL at `apps/admin/schema.graphql`, emit script at `apps/admin/src/scripts/print-schema.ts` using `printSchema(lexicographicSortSchema(builder.toSchema()))` with explicit "do not edit" header.
  3. Scalar mappings: none on either factory; gql.tada defaults.
  4. CI integration: new `admin-schema-drift` job in `.github/workflows/ci.yml`, mirrors existing `graphql-generate` job, gated on `@forge/admin` affected via Turbo.
  5. Turbo wiring: `inputs`-based — `generate` task adds `apps/admin/schema.graphql` to `inputs` and `src/admin-graphql-env.d.ts` to `outputs`. Separate `schema:print` task with `outputs: ["schema.graphql"]`. **No `dependsOn` edge.**
- **No consumer-migration code has landed yet.** Units 2–7 are all `not-started` against the codebase. No `apps/web`, `apps/mobile`, or `apps/tv` route reads from admin; no `packages/graphql` dual-client wiring has landed.
- **All four admin-side prereqs remain unbuilt:**
  - (a) `apps/admin/src/scripts/print-schema.ts` does not exist
  - (b) `apps/admin/schema.graphql` does not exist
  - (c) `admin-schema-drift` CI job is not in `.github/workflows/ci.yml`
  - (d) Admin Railway env vars (`CORS_ALLOWED_ORIGINS`, `AUTH_TRUSTED_ORIGINS`) and explicit PUBLIC projection on `experienceBySlug` are not yet wired
- **Admin's PUBLIC scope verified at 4 queries today:** `experienceBySlug` (`apps/admin/src/graphql/types/experience.ts:149`), plus `searchExperiences`, `hybridSearch`, `sceneRecommendations`. The canary's target (`experienceBySlug`) is unblocked. Everything else needed by web's homepage and watch-video routes is still gated and now Urim's to widen:
  - `videoBySlug` — `apps/admin/src/graphql/types/video.ts:312` (`hasPermission: "read:videos"`)
  - `video(id)` — `apps/admin/src/graphql/types/video.ts:327` (`hasPermission: "read:videos"`)
  - `videos(limit, offset)` — `apps/admin/src/graphql/types/video.ts:340` (`hasPermission: "read:videos"`)
- **Five commits landed 2026-05-05 → 2026-05-06:** all on embedding backfill performance (feat-116 S3 cache + batched OpenRouter, feat-117 bulk pgvector writes via `INSERT … unnest(...) ON CONFLICT`). None affect admin's GraphQL surface, `packages/graphql`, or `apps/web`'s content layer. The brief's strategic frame is undisturbed.

---

## Next Steps

→ `/ce-plan` (or direct implementation) for Unit 2 admin-side prereqs and Unit 3 dual-client codegen. The Unit 3 plan already exists at `docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md` with all five design decisions resolved. The next concrete action is implementation — Unit 2 admin-side artifacts (print-schema script, committed SDL, CI job) sequenced before or alongside Unit 3's `packages/graphql` wiring, then Unit 4 (parity comparator) and Unit 5 (web canary) in their own PRs.
