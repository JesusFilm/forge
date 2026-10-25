---
date: 2026-05-11
topic: consumer-migration-web-cutover-strategy
---

# Consumer Migration — Web Cutover Strategy Under Accelerated Strapi Sunset

## Summary

Replace U5b's phased-ramp architecture with a direct admin cutover for `apps/web` only, backed by comprehensive batch verification. Introduce a synthetic admin GraphQL schema overlay so admin's `blocks: JSON` scalar is consumed as a typed discriminated union. The shape adapter and `admin-with-fallback` mode from the prior U5b plan are dropped; the parity harness from PR #912 is repurposed from runtime canary to one-shot batch verification. Web cuts over first; mobile and TV migrations follow once web admin-mode is stable in production, but each platform gets its own focused brainstorm rather than being bundled here.

---

## Problem Frame

The current U5b plan (`docs/plans/2026-05-11-002-feat-consumer-migration-unit-5b-web-admin-rendering-plan.md`) was sized for a multi-month Strapi sunset. Its phased-ramp architecture (`strapi` → `dual-read` → `admin-with-fallback` → `admin`) depends on Strapi being live as a fallback and as a parity baseline for weeks. R18a's go/no-go thresholds alone need 7–14 day observation windows.

Strapi is now scheduled for deprecation and removal within approximately 1–2 weeks (working assumption — see Key Decisions for the rationale around treating this as the planning constraint). The phased ramp can't complete in that window — the safety net it's built around is going away faster than the ramp can validate the cutover. Continuing with U5b as written produces an incoherent architecture: most of its intermediate stages have no Strapi to lean on by the time they'd run.

The work shifts from "gradual ramp with Strapi safety net" to "direct cutover for web with comprehensive pre-cutover verification." Web is the first and only platform in this brainstorm's scope. Mobile and TV migrations follow web's burn-in but each gets its own focused brainstorm — bundling all three platforms here would mix per-platform concerns (mobile's Apollo persisted-cache, TV's focus/remote-control UX, EAS vs TV-store release cadences) and produce an unwieldy plan tree. Web first establishes the architectural pattern (admin prereqs, synthetic schema overlay, batch verification, fragment rewrite); mobile and TV each inherit the foundation as a dependency and address their own platform-specific concerns in their dedicated brainstorms.

This brainstorm does NOT plan Strapi removal itself. It plans web's path forward given Strapi removal as a fixed external constraint.

---

## Actors

- A1. **Urim:** sole owner of consumer migration (web, mobile, TV) AND admin-side prerequisites per the 2026-05-07 ownership flip recorded in the origin brief.
- A2. **Web / mobile / TV end users:** consume content rendered from whichever backend the per-app flag currently points at; must observe no behavior change during the cutover except in incident scenarios where they receive a clean error or maintenance page.
- A3. **Batch verification harness:** repurposed from PR #912's runtime parity comparator. Runs offline against the full published-slug corpus, produces a per-slug diff report, and gates the cutover.
- A4. **Admin service:** the strategic content API. Must absorb production-rate read traffic for web, mobile, and TV in sequence within the cutover window.
- A5. **Strapi service (during transition):** the current content API. Continues serving consumers until each app cuts over. May optionally run zero-traffic for an additional 1–2 weeks post-codebase-removal as an emergency-only backstop (subject to coordination ask in Outstanding Questions).

---

## Key Flows

- F1. **Batch verification cycle**
  - **Trigger:** Urim runs the batch differ against the published-slug corpus before flipping any consumer app to admin mode.
  - **Actors:** A1, A3
  - **Steps:** Enumerate every published slug from the canonical source. For each, fetch the Strapi response and the admin response in parallel. Normalize and compare via the existing parity harness. Output a structured per-slug diff report. Inspect diffs, classify as bug-in-admin / bug-in-consumer / acceptable / allow-listable, fix the actionable items, re-run. Continue until the diff set is empty or every remaining diff is explicitly allow-listed with rationale.
  - **Outcome:** A go/no-go artifact for the cutover. Either the diff set passes the bar (proceed) or it doesn't (fix and re-run).
  - **Covered by:** R4, R5, R7, R17.

- F2. **Web cutover progression**
  - **Trigger:** Batch verification's diff set has passed the bar; admin-side prerequisites (PR-A) are deployed; Urim is ready to flip web from `strapi` to `admin`.
  - **Actors:** A1, A2, A4
  - **Steps:** Deploy web with `FORGE_CONTENT_API=admin` enabled. Monitor admin error rate, latency, and route-render failure rate against U5's existing parity-log baseline. Burn-in window is hours-to-days (not weeks) — set by incident observation, not a fixed observation window. Mobile and TV cutovers follow once web's burn-in completes without incident.
  - **Outcome:** Web reads admin in production. Mobile and TV cutovers are unblocked.
  - **Covered by:** R3, R10, R12.

- F3. **Rollback during cutover**
  - **Trigger:** Admin returns broken data, elevated error rate, or unexpected user-facing breakage post-cutover.
  - **Actors:** A1, A2
  - **Steps:** Two layers, in escalation order. (1) Flip a route-level feature flag that disables affected pages and serves a maintenance fallback — seconds-to-minutes; bounded blast radius (the route is non-functional but cleanly so). (2) Code-revert the cutover commit and redeploy — 5–15 minutes. The Strapi-service backstop is NOT a layer here — see Key Decisions; per the no-backstop assumption, Strapi-service shuts off when `apps/cms` is removed and is not available as a rollback target.
  - **Outcome:** Affected route returns to a safe rendering state. Investigation proceeds without user-visible breakage.
  - **Covered by:** R16.

---

## Requirements

**Architecture — admin as sole consumer source**

- R1. Admin's GraphQL SDL types `ExperienceLocale.blocks` as `[ExperienceBlock!]!` where `ExperienceBlock` is a discriminated union of all 17 top-level block kinds defined in admin's Zod `BlockSchema` (`apps/admin/src/domain/blocks.ts`). Two nested unions accompany it: `SectionContentBlock` (13 members — includes `QuizButtonBlock` and `ContainerBlock`, excludes `videoHero`/`videoRecommendations`) and `ContainerContentBlock` (10 members — includes `ContainerSlotBlock` divider, excludes self-and-section). The unions, member object types (~19 distinct), leaf object types (~7: `BibleQuoteItem`, etc.), and enums (~10) are defined as **Pothos types in admin** at `apps/admin/src/graphql/types/blocks.ts`, matching the existing pattern admin uses for every other type. The discriminator field `t` (a Zod literal, e.g., `t: "adventCountdown"`) is preserved on every block as a `String!` field; GraphQL's auto-injected `__typename` provides the canonical discriminator for consumer dispatch. Admin's `ExperienceLocale.blocks` resolver projects the stored JSON payload into the typed shape at request time using a `resolveType` callback that dispatches on `t`. Web consumes this via the existing `adminGraphql()` factory; mobile and TV inherit the same surface when their own brainstorms reach planning. _(Mechanism validated by spike on 2026-05-11 — see Key Decisions for spike-resolved details.)_
- R2. Consumer-side fragments are authored against admin's schema (on the `ExperienceLocale` type) and live in `packages/graphql` as shared exports. Per-app translation layers (the "adapter" pattern from the prior U5b plan) are not introduced.
- R3. `FORGE_CONTENT_API` collapses to two values for the cutover window: `strapi` and `admin`. The prior `dual-read` and `admin-with-fallback` modes are dropped — no Strapi-backed runtime fallback exists, since Strapi cannot outlast the cutover.

**Verification — comprehensive before cutover, not gradual after**

- R4. A batch verification harness runs against the full published-slug corpus before any consumer app flips to `admin` mode. Output is a structured per-slug diff report covering all four diff classes from PR #912 (structural, value, order, semantic).
- R5. The cutover gate is: empty diff set OR every remaining diff is allow-listed with documented rationale. The allow-list mechanism reuses PR #912's existing `DEFAULT_ALLOW_LIST` extension pattern.
- R6. The verification approach is iterative: fix actionable diffs (in admin, in the consumer code, or in the data), re-run, repeat until the gate passes. The number of cycles is unbounded by design — the gate is correctness, not time.

**Admin prerequisites — durable from prior U5b plan**

- R7. Admin gains a `CONSUMER_BEARER` principal: a bearer-authenticated identity granted no permissions beyond PUBLIC, used solely so admin's rate-limit plugin can bucket consumer SSR traffic separately from anonymous-IP traffic.
- R8. **Web only** sends an API-key bearer (named symmetrically with the admin-side env var to prevent operator copy-paste errors) on every admin request. Mobile and TV do NOT send a bearer key — their requests come from per-device IPs which work fine under admin's anonymous-IP rate-limit bucketing (the bucket-starvation concern that motivated the bearer is web-specific, caused by Railway's shared egress IP pool). Avoiding a bearer on mobile/TV eliminates the extractable-key class of risk by design. Bearer comparison on the admin side uses timing-safe primitives.
- R9. Admin's `experienceBySlug` resolver applies a server-side filter that excludes `isTemplate=true` Experiences for PUBLIC and `CONSUMER_BEARER` callers, so the consumer code's existing template-rejection check remains sound under admin reads.
- R10. The CONSUMER_BEARER principal's permission set is asserted empty via CI across BOTH authorization surfaces: (a) the editorial-permission system — a test enumerates every `PermissionKey` and asserts `hasPermission(CONSUMER_BEARER, key)` returns false; AND (b) the workflow-trigger allowlists (e.g., `WORKFLOW_API_KEYS`-derived allowlists, any future trigger-allowlist patterns) — a test asserts CONSUMER_BEARER's key value is not present in any workflow-trigger allowlist and that the principal type is not granted any workflow-trigger capability. The composite assertion prevents accidental privilege escalation through either surface; the empty-set invariant is machine-enforced on both, not conventional.

**Cutover sequencing and safety**

- R11. Admin-side changes (R7, R8, R9, R10 plus security hardening from the prior U5b plan: timing-safe bearer comparison, Apollo error-log scrubbing, principal-resolution ordering) ship as their own PR and deploy to admin production BEFORE consumer-side cutover code opens. The two-PR shape matches PR #921's precedent and the cross-app receiver-first rotation rule.
- R12. The web app's `unstable_cache` wrapper on the watch route re-throws admin-specific typed errors (rather than converting them to the sentinel-returned error pattern used for Strapi). This makes Next.js's segment error boundary actually fire on admin failures in `admin` mode — the prior U5b plan's P0 reviewer finding remains valid and the fix is preserved.
- R13. The `apps/web/src/app/[slug]/error.tsx` boundary ships as a Client Component and catches only typed admin-mode errors. Strapi-mode behavior is unchanged through the brief transition period — the existing inline-error rendering in `[slug]/page.tsx` continues to handle Strapi sentinel errors until Strapi is removed.

**Mobile and TV — deferred to follow-up brainstorms**

- R14. Mobile and TV cutover is OUT OF SCOPE for this brainstorm. The synthetic admin schema (R1), admin-shape fragments in `packages/graphql` (R2), admin prerequisites (R7–R11), and the verification approach (R4–R6) become a foundation that mobile and TV's own brainstorms inherit. The expectation is: web cuts over and burns in successfully, then a mobile brainstorm opens to plan mobile's cutover (addressing Apollo persisted-cache invalidation, EAS release cadence, per-platform concerns), then similarly for TV.

**Rollback — two layers, no Strapi backstop**

- R16. A route-level feature flag exists on each affected consumer route that, when flipped, disables the route and serves a maintenance fallback. This is the primary fast rollback (seconds-to-minutes). Code-revert + redeploy is the secondary path (5–15 minutes). The Strapi-service backstop is NOT included as a rollback layer — the brainstorm assumes Strapi-the-service shuts off when `apps/cms` is removed (see Key Decisions for the assumption rationale).

_(R17–R19 moved to Dependencies / Assumptions per doc-review feedback — they describe existing shipped state, not new behavior to build.)_

---

## Acceptance Examples

- AE1. **Covers R4, R5, R6.** Given the published-slug corpus on Strapi, when the batch verification harness runs end-to-end and outputs the per-slug diff report, then the report is structurally complete (no missing slugs) and the operator can decide go/no-go from the report alone without re-running against partial data.
- AE2. **Covers R3, R12, R13.** Given web is in `admin` mode and admin returns a 5xx or times out for a slug the user requests, when the response cycle completes, then the user receives the `[slug]/error.tsx` boundary's UNAVAILABLE UX — not garbage HTML, not a server crash, and not a 60-second cached error sentinel.
- AE3. **Covers R12.** Given web is in `strapi` mode (transitional, before cutover) and Strapi returns a not-found sentinel, when the page renders, then the existing inline `<ExperienceEmpty>` path fires — `error.tsx` does NOT fire. Mode-aware error boundary behavior is preserved.
- AE4. **Covers R11.** Given admin-side prerequisites have NOT yet deployed and a web build accidentally enters `admin` mode, when web makes its first admin-bearer request, then admin rejects it as an unrecognized bearer; web's request falls through to the safety net (logged as `forge.parity.consumer_bearer_missing`, served as `strapi`-mode for that request). No silent partial cutover.
- AE5. **Covers R16.** Given web has been cut over and a P0 incident surfaces, when the operator triggers a rollback, then either (a) a feature-flag flip serves a maintenance page within seconds, or (b) a code-revert redeploy restores the prior consumer surface within 5–15 minutes. The exact recovery path depends on which option the operator selects based on the incident shape. No Strapi-service backstop is available — the assumption is that Strapi shuts off when `apps/cms` is removed.
  _(AE6 — covering mobile/TV cutover behavior — removed when scope narrowed to web only. Mobile and TV acceptance examples live in their dedicated future brainstorms.)_

---

## Success Criteria

- **Web reads admin in production for the slug-page route** with zero P0 user-visible regressions during burn-in. Once web is stable, mobile and TV brainstorms can open with the architectural foundation already proven.
- **The batch verification diff set passes the gate before web cutover happens**, and the diff report is preserved as evidence — operators returning to investigate post-cutover anomalies can reproduce the verification baseline.
- **No per-app adapter ships in `apps/web`** — web consumes admin-shape fragments from `packages/graphql` directly. The synthetic admin schema overlay in `packages/graphql` (R1) IS shared infrastructure that mobile and TV will later inherit; this success criterion bars per-app translation in the consumer, not the shared codegen surface.
- **The empty CONSUMER_BEARER permission set is CI-asserted** across both editorial-permission and workflow-trigger surfaces — adding any permission to the set fails CI, making the security invariant machine-enforced.
- **Web is the architectural pattern that mobile and TV will follow** — by the time web burn-in completes, the synthetic schema overlay, admin prereqs, batch verification, and rollback story are proven foundations. Each subsequent platform's brainstorm inherits them as dependencies rather than re-deciding them.
- **A downstream planner / implementer can execute web cutover from this brainstorm + the resulting plan without reinventing scope** — the requirements here are concrete enough that `ce-plan`'s output is execution detail, not product re-definition.

---

## Scope Boundaries

- **Mobile cutover.** Out of scope for this brainstorm. Mobile gets its own dedicated brainstorm AFTER web's admin-mode is stable in production. That brainstorm addresses Apollo persisted-cache invalidation (origin R16), EAS update lag, TestFlight/app-store review timing, and per-platform rollback mechanics. The synthetic admin schema overlay + admin-shape fragments shipped under this brainstorm become a dependency that mobile inherits.
- **TV cutover.** Out of scope for this brainstorm. TV gets its own brainstorm AFTER mobile is stable (or in parallel with mobile, at Urim's discretion). That brainstorm addresses focus-state + remote-control UX, TV-store release cadence, and per-platform rollback. Same foundation-inheritance as mobile.
- **Strapi removal itself.** Explicit user exclusion. This brainstorm treats Strapi removal as a fixed external constraint and plans around it. Anything about decommissioning the Strapi service, deleting `apps/cms`, removing the Strapi-bound `graphql()` factory, or related cleanup is owned by whoever's driving Strapi sunset — out of scope here.
- **Pothos `defaultStrategy` hardening** (PR #921 R1 residual). Owned by U7; not blocking U5b's cutover.
- **Admin video draft-field leakage fix** (PR #921 R5, R6 residuals — `Video.dubs`, `VideoService.list/getById/getBySlug` filter only on `deletedAt: null`). Separate small admin PR. If mobile or TV's cutover surfaces routes that depend on those fields, the residual becomes blocking — that's mobile/TV's call, not U5b's.
- **Apollo persisted-cache invalidation strategy for mobile** (origin R16). Smaller question under this design because there's only one schema shape, but still requires a documented experiment before mobile reaches admin mode. Deferred to mobile's own brainstorm.
- **GraphQL Armor cost-limit recalibration** for the now-PUBLIC video scene graph. Owned by U7.
- **Per-route or per-slug flag granularity** (origin R17 no-redeploy rollback). U7 owns the per-route mechanism; U5b uses process-wide env vars + redeploy as it does today.
- **The U5 deletion PR.** Sequenced after U5b cutover completes — a separate concern that retires:
  - `apps/web/src/lib/parity-bridge.ts` (consumer-side dual-read bridge)
  - The `dual-read` mode machinery in `apps/web/src/lib/content-api-mode.ts` (mode enum collapses to `strapi | admin`; the four-value normalization + deletion-checklist cross-references retire)
  - `apps/web/src/lib/fragments/admin-experience.ts` (U5's parity-comparison admin operation; replaced by admin-shape fragments in `packages/graphql`)
  - The `dual-read` branch in `fetchSlugExperience` (`apps/web/src/lib/content.ts:370-436`), including `fetchStrapiSlugExperience`, `fetchAdminSlugExperience`, and `isAbortTimeoutError` helpers no longer needed under direct cutover
  - The 7 runtime parity log events: `forge.parity.diff`, `forge.parity.admin_timeout`, `forge.parity.harness_error`, `forge.parity.strapi_failed_admin_succeeded`, `forge.parity.both_failed`, `forge.parity.admin_missing`, `forge.parity.canary_failed`
  - The regression snapshot at `apps/web/src/lib/__tests__/content-mode-regression.test.ts`
  - Env vars: `FORGE_CONTENT_API` (collapses to a hardcoded constant or removed entirely), `FORGE_PARITY_DEBUG`
  - `ADMIN_GRAPHQL_URL` host-allowlist constants in `apps/web/src/env.ts` (the URL stays but the env schema simplifies)

  Not part of U5b's path; tracked as a deletion follow-up in Outstanding Questions. The list above is the audit baseline so the deletion PR doesn't have to reconstruct scope by reading the superseded plan.

- **U5b's prior phased-ramp design** (`docs/plans/2026-05-11-002-…`). Superseded by this brainstorm's direct-cutover approach. The prior plan's status flips to `superseded`; durable parts (admin prerequisites R7–R11) lift into the new plan.

---

## Key Decisions

- **Web-only scope for this brainstorm; mobile and TV get their own focused brainstorms.** Multiple doc-review reviewers flagged that bundling web + mobile + TV in one brainstorm conflates concerns that warrant separate planning (mobile's Apollo persisted-cache, TV's focus/remote-control UX, EAS vs TV-store release cadences). Web cuts over first; its architectural decisions (synthetic schema, batch verification, admin prereqs) become the proven foundation that mobile and TV inherit. Each platform's own brainstorm addresses its per-platform concerns rather than this brainstorm trying to anticipate them. Rationale: web verification holds → architecture is proven → mobile and TV brainstorms can focus on per-platform deltas, not architecture.

- **Plan against the 1-2 week Strapi-removal timeline as working assumption; accept the compressed-architecture trade-offs.** The timeline is a soft estimate (not formally confirmed) but the team is choosing to plan against it rather than negotiate an extension. Consequence: direct cutover instead of phased ramp; batch verification carries the safety weight; no Strapi-service backstop in the rollback story; no observation-window thresholds. If the timeline hardens further or slips, this decision is revisitable, but the brainstorm proceeds under the compressed assumption.

- **Web-only bearer key; mobile and TV use anonymous-IP rate limiting.** The CONSUMER_BEARER mechanism (R7–R8) ships only on web. Web SSR needs it because Railway's shared egress IP pool would otherwise saturate admin's anonymous-IP rate-limit bucket. Mobile and TV requests originate from per-device IPs, so anonymous-IP bucketing works fine for them — adding a bearer to their apps would create a P0 security risk (the key is trivially extractable from mobile/TV binaries) for no operational benefit. This eliminates the P0 mobile/TV bearer-extraction concern from the doc review by design rather than mitigation.

- **Synthetic admin schema overlay over per-app adapter.** Even though this brainstorm only ships web, the synthetic schema is built once in `packages/graphql` and will be the contract mobile and TV inherit. Generating from admin's authoritative content-block schema gives a single typed surface; the alternative (per-app adapter on web, then again on mobile, then again on TV) creates three permanent compatibility layers with no deletion trigger. The "structurally infeasible" framing from the prior U5b plan was about scope within a single PR; with agentic velocity, the schema-generation work pays for itself even across just the web cutover and gives mobile/TV a head start.

- **Synthetic schema feasibility validated via spike — completed 2026-05-11.** Adversarial review flagged that the Zod-to-GraphQL discriminator mapping was unspecified and gql.tada's parser tolerance for a 17-member nested discriminated union was unproven. A 1-2 hour spike ran against admin's actual `BlocksSchema` at `apps/admin/src/domain/blocks.ts` and resolved the following:
  - **Discriminator field is `t`, not `kind`.** Both the brainstorm draft and the adversarial finding guessed `kind`; the actual Zod literal field is `t` (e.g., `t: z.literal("adventCountdown")`). R1's Pothos types declare `t: String!` matching the Zod field; GraphQL's `__typename` provides the canonical consumer discriminator (the renderer can dispatch on either — they carry identical information).

  - **Top-level union has 17 members, not 16.** `BlockSchema.options` enumerates: AdventCountdownBlock, BibleQuotesCarouselBlock, CardBlock, ContainerBlock, CtaBlock, EasterDatesBlock, InfoBlocksBlock, MediaCollectionBlock, NavigationCarouselBlock, PromoBannerBlock, RelatedQuestionsBlock, SectionBlock, TextBlock, VideoBlock, VideoCarouselBlock, VideoHeroBlock, **VideoRecommendationsBlock** (forward-looking, R5 of admin migration playbook; no renderer yet). The discriminator-map's `STRAPI_TO_ADMIN_KIND` lists 16 shared kinds and tracks `videoRecommendations` separately under `ADMIN_ONLY_KINDS`; both apply to the union.

  - **Three unions, not one.** Production overlay needs `ExperienceBlock` (17 members), `SectionContentBlock` (13 members — includes `QuizButtonBlock` and `ContainerBlock`, excludes top-level-only kinds), `ContainerContentBlock` (10 members — includes `ContainerSlotBlock` divider). Members are shared across unions (e.g., MediaCollectionBlock appears in all three) — standard GraphQL supports a single object type as a union member in multiple unions.

  - **gql.tada accepts the SDL and produces usable TypeScript types.** Spike verified by running `gql-tada generate output` against a representative 5-kind SDL overlay; produced 48-line `.d.ts` with full introspection types, unions emitted with `possibleTypes` literal-union lists, enum types resolve to TS literal unions. A typecheck pass against sample queries selecting `... on TypeName { ... }` from each union succeeded with zero errors. Nested unions (Container.content → ContainerContentBlock; Section.content → SectionContentBlock referencing Container) work as expected. **No structural blockers.**

  - **Generation path: hand-authored Pothos types + drift-CI test (NOT build-time codegen from Zod).** Admin's schema is already sourced from Pothos; defining the union types and members as Pothos types matches the existing pattern and is the most idiomatic option. A drift-CI test asserts that admin's Pothos union members exactly match admin's Zod `BlockSchema.options` set (and similarly for the section/container nested unions). New block kinds: developer adds the Zod schema → drift-CI fails with "Zod has X kinds, Pothos union has Y" → developer adds the matching Pothos type. Estimated LOC for the full set: ~510 (19 Pothos object types + 3 unions + 7 leaf types + ~10 enums + JSON-to-typed resolver + drift-CI test).

  - **Spike artifacts preserved under `.tmp/spike-synthetic-schema/`** for reference: `synthetic-overlay.graphql` (representative 5-kind SDL), `tsconfig.json` (gql.tada config), `spike-env.d.ts` (gql.tada-generated introspection types), `spike-query.ts` (typechecked sample queries with union narrowing). These are scratch outputs, not production code.

  - **Outcome: R1's mechanism is committed.** Hand-authored Pothos union types + drift-CI against `BlocksSchema`. `ExperienceLocale.blocks` resolver projects the stored JSON into the typed shape via Pothos's `resolveType` callback dispatching on `t`. This is the path `ce-plan` plans against.

- **Direct cutover, not phased ramp.** `admin-with-fallback` mode exists to give Strapi a chance to catch admin failures during the ramp. With Strapi sunsetting before the ramp could complete, the mode has no fallback target and adds runtime branching cost for no safety benefit.
- **Batch verification replaces observation-window thresholds.** R18a's "parity diff ≤ 1% over 7 days" approach requires a long live-comparison window. A one-shot corpus differ is deterministic, complete (every slug, not sampled), and produces a binary go/no-go gate. The verification baseline is captured as an artifact rather than as a window of production telemetry.
- **Mobile and TV migrate by importing shared fragments, not by repeating the per-app pattern.** This was the implicit cost of the adapter approach — every app would re-implement the translation. Sharing the fragments in `packages/graphql` makes mobile and TV adoption mechanical.
- **Two-PR sequencing (admin first, web second) preserved.** The cross-app receiver-first rotation rule still applies regardless of the simplified cutover. Admin's CONSUMER_BEARER recognition must be live before web's bearer-bearing traffic arrives.
- **No Strapi-service backstop in the rollback story.** The brainstorm assumes Strapi-the-service shuts off when `apps/cms` is removed; there is no zero-traffic buffer window. Rationale: this is the safer default to plan against — if the team later confirms a backstop IS available, that's a free upgrade with no replan needed. If we'd assumed a backstop and the team declined, the runbook would need revision before cutover. The assumption can be revisited if the team independently raises that a backstop is possible.

---

## Dependencies / Assumptions

- **PR-A admin-side work deploys to forge-admin production BEFORE web's cutover commit opens.** Same deploy-order discipline as PR #921 and the prior U5b plan; the cross-app rotation rule (`docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`) governs.
- **Admin's content-block schema (the Zod-validated kind set) is stable on the timescale of the cutover.** New kinds added to admin's block schema during the cutover window must be added to the synthetic GraphQL overlay as the same time — drift-CI catches the mismatch. This is a low-effort discipline but worth flagging.
- **Strapi-the-service shuts off when `apps/cms` codebase is removed.** No zero-traffic backstop window assumed. Rollback story is feature-flag + code-revert only. The batch verification gate (R4–R6) carries more weight as a result — there's no runtime safety net to catch what verification misses. This is the safer default per Key Decisions; the assumption can be revisited if the team independently confirms a backstop IS possible.
- **Strapi service remains live through every consumer's burn-in completion.** `apps/cms` codebase removal is sequenced to occur only AFTER the last consumer app (TV) completes its burn-in and rolls forward from `admin` mode. Concretely: web cuts over → web burn-in → mobile cuts over → mobile burn-in → TV cuts over → TV burn-in → then `apps/cms` codebase + Strapi service removal proceeds. If Strapi service removal happens before the last burn-in completes, the rollback paths (F3) become unavailable mid-migration. Coordinate with whoever owns Strapi removal so the codebase-deletion task waits for U5b-or-equivalent completion across all three platforms.
- **The brief's R16 Apollo persisted-cache invalidation experiment is solved before mobile reaches admin mode.** The question is smaller under this design (one schema shape, not two) but still load-bearing for mobile's cache-coherence story.
- **`packages/graphql` codegen continues to consume two SDL artifacts during the cutover window** — Strapi's (frozen as of the cutover commit) and admin's (with the synthetic blocks overlay). Once Strapi is removed, the Strapi factory + types collapse in a follow-up PR not owned by this brainstorm.
- **Existing shipped infrastructure depended on (does not need to be built):**
  - **Parity harness (PR #912):** `packages/graphql/src/parity/` (normalizers, comparator, discriminator map, allow-list, capture script) is repurposed from runtime canary use to one-shot batch verification. The code does not change; only its orchestration and deployment shape changes.
  - **Admin PUBLIC widenings (PR #921):** `videoBySlug`, `videos`, `languages/countries/keywords`, field-level Experience strip, new `watchSetting` query. Unchanged and prerequisite for mobile and TV cutover.
  - **Dual-client codegen (PR #902):** `adminGraphql()` is the forward-going factory; `graphql()` (Strapi-bound) becomes redundant once cutover completes. This brainstorm does not plan that collapse — see Scope Boundaries.

---

## Outstanding Questions

### Resolve Before Planning

_No items. The Strapi-service backstop coordination question was resolved by adopting the no-backstop assumption (see Key Decisions); the rollback story is feature-flag + code-revert only. If the team later confirms a backstop IS available, treat that as a free upgrade and amend the runbook in a small follow-up — no replan needed._

### Deferred to Planning

- **[Affects R1][RESOLVED by 2026-05-11 spike]** Generation mechanism: hand-authored Pothos types in `apps/admin/src/graphql/types/blocks.ts` with a drift-CI test asserting alignment between admin's Zod `BlocksSchema` and the Pothos union members. Not build-time codegen — admin's existing Pothos pattern is the right shape. See Key Decisions for spike details.
- **[Affects R4, R5][Technical]** Batch verification orchestration: where does the harness run (CI job, manual local invocation, scheduled task)? How are results persisted (artifact in CI, committed report, dashboard)? Planning picks the lightest-weight surface that makes the diff report durably reviewable.
- **[Affects R14][Needs research]** Mobile and TV consumer adoption sequencing: do they ship admin-mode behind their own per-platform flag in lock-step with web's cutover, or do they wait for web's burn-in to complete first? The brief's original sequencing ("mobile precedes TV; both follow web") still holds in spirit; the timing of each platform's cutover is a separate planning question.
- **[Affects R2][Technical]** `WatchExperience` fragment migration path: do consumers update their existing fragment to point at admin's `ExperienceLocale` type in one PR, or does the migration ship with both fragments coexisting briefly during the cutover commit? Planning picks the safer commit boundary.
- **[Affects R12, R13][Technical]** `error.tsx` boundary's exact classification logic for non-typed errors that escape the cache wrapper unexpectedly: re-throw to Next's segment-default boundary, render a minimal generic UX, or log + render the existing inline path? Planning picks based on commit-time review of edge cases.
- **[Affects U5b's prior plan][Operational]** When the prior plan at `docs/plans/2026-05-11-002-…` is marked `status: superseded`, who owns the deletion PR for U5's runtime canary infrastructure (PR #915's `parity-bridge.ts`, multi-mode `content-api-mode.ts` machinery, admin operation file, deletion-checklist cross-references)? The deletion is appropriate but separate from U5b's cutover scope.

---

## Deferred / Open Questions

_Added 2026-05-11 from doc-review round 1 (6 reviewers: coherence, feasibility, product-lens, security-lens, scope-guardian, adversarial). 24 findings deferred for planning-time engagement and product-decision resolution. Each item lists the affected section, severity, reviewer, and concern. ce-plan should engage with these as input alongside the requirements above. Items are not blocking the brainstorm but require concrete decisions before or during planning._

### Resolved by 2026-05-11 dialogue (post-doc-review)

After the doc-review round, a clarifying-questions pass resolved several of the deferred items below by making explicit decisions:

- **P0 — Strapi-removal timeline confirmation** → RESOLVED. The 1-2 week timeline is a soft estimate from team chatter; the team is choosing to plan against it as a working assumption and accept the compressed-architecture trade-offs rather than negotiate for an extension. The decision is documented in Key Decisions; if the timeline shifts materially in either direction, the assumption is revisitable.
- **P0 — Mobile/TV bearer-key extraction risk** → RESOLVED. Web is the only platform that ships a bearer key (R8 narrowed). Mobile and TV use anonymous-IP rate-limiting because each device has its own IP, eliminating the extraction-risk class by design rather than mitigation.
- **P1 — Mobile/TV compression unjustified** → MOOT. Mobile and TV cutover is now out of scope for this brainstorm (web-only). Per-platform concerns (compression, EAS lag, TV store cadence, Apollo persisted-cache) get addressed in mobile's and TV's own dedicated brainstorms.
- **P1 — Document bundles 4 scopes** → RESOLVED. Scope narrowed to web cutover + foundation (admin prereqs, synthetic schema, batch verification). Mobile and TV brainstorms are explicit follow-ups.
- **P1 — Mobile/TV cutover blocked by Apollo cache experiment** → MOOT for this brainstorm. The cache experiment moves to mobile's brainstorm as a prerequisite.
- **P1 — Single shared bearer key across 3 platforms** → MOOT. Only web ships the bearer; the multi-platform sharing concern dissolves.
- **P2 — R15 weakens brief's mobile/TV gating** → MOOT. R15 removed entirely (mobile/TV out of scope).
- **P2 — Mobile/TV per-platform concerns minimized in R14/R15** → MOOT. R14/R15 reframed; mobile/TV concerns get full treatment in their own brainstorms.

### Remaining open items from 2026-05-11 review

_(Both P0s from the original review are RESOLVED above. The remaining items below are P1/P2 concerns for web cutover. Items that were mobile/TV-specific are MOOT and have been removed; items that were resolved by clarifying-question dialogue are tracked in the "Resolved" subsection above.)_

#### P1 — architectural and contractual concerns

- **[Affects R18 → now Dependencies, Scope Boundaries][Coherence]** _(coherence, 100)_ — `watchSetting` was originally listed in R18 (which is now moved to Dependencies/Assumptions). It remains unclear whether web's cutover scope includes the homepage path (which uses `watchSetting`) or only the slug-page path (which doesn't). If web's cutover is slug-page only, `watchSetting` is irrelevant for this brainstorm and only matters at mobile/TV time (when homepage migrates). If web also migrates homepage, an explicit web requirement is needed. **Open for planning to clarify.**

- **[Affects R1, Key Decisions][Architecture]** _(scope-guardian + product-lens, 100 cross-persona agreement)_ — Synthetic admin schema overlay is permanent infrastructure once shipped, even though only web consumes it in this brainstorm's scope. Zod↔GraphQL drift becomes a forever maintenance surface; every new block kind added to admin's Zod schema must be mirrored in the overlay; the brief's "no compatibility shim" scope boundary may apply. Before planning: promote the build-time-generated-from-Zod option (currently deferred) to a Key Decision with rationale, OR explicitly acknowledge that the overlay is permanent infrastructure (not migration scaffolding) and define drift-CI failure response ownership.

- **[Affects R1][RESOLVED by 2026-05-11 spike]** Zod-to-GraphQL discriminator mapping clarified: the Zod literal field is `t` (not `kind`). Pothos types declare `t: String!` matching the Zod field; GraphQL's `__typename` is auto-injected by Pothos's union `resolveType` callback dispatching on `t`. Consumers can dispatch on either `__typename` or `t`. No silent type-vs-runtime divergence — the discriminator is preserved exactly as Zod defines it.

- **[Affects F1, R4][Operational]** _(adversarial, 75)_ — Batch verification scale, runtime, load profile entirely unspecified: corpus size including locale fan-out, target end-to-end runtime per cycle, parallelism vs admin rate-limit headroom, whether the harness runs against admin-prod or a staging mirror. R6's "unbounded cycles" is incompatible with the 1-2 week Strapi-removal deadline if a single cycle exceeds hours. Estimate before planning.

- **[Affects F1, R4][Operational]** _(adversarial, 75)_ — Batch verification is a point-in-time snapshot; admin content evolves between snapshot completion and traffic cutover. No mechanism described for verifying content published in that gap. Under the no-Strapi-backstop assumption, this gap becomes a user-visible breakage vector. Consider editorial freeze during cutover window, delta-only re-run on slugs modified between snapshot and cutover, or admin-side write-blocking.

- **[Affects R8, R11][Security]** _(security-lens, 100)_ — Web's bearer key lifecycle requirements absent: no rotation policy (interval, trigger events), no log-scrubbing commitment (must not appear in application logs, CI logs, crash reports, analytics payloads), no source-control prohibition. Apollo error-log scrubbing mentioned only parenthetically in R11. Add a dedicated security requirement covering all three. (Scope narrowed to web — only web carries the bearer.)

**P2 — contradictions, scope clarifications, and operational gaps**

- **[Affects AE4, R3][Coherence]** _(coherence, 75)_ — AE4 describes a bearer-missing fallback serving `strapi`-mode for the request, but R3 says only `strapi` and `admin` modes exist with no runtime Strapi fallback. Either update R3 to acknowledge an auth-error fallback mode, or rewrite AE4 to state admin rejects the bearer and the request fails with a 401.

- **[Affects R16, Scope Boundaries][Scope]** _(scope-guardian, 100)_ — R16 requires "route-level feature flag" but Scope Boundaries states U7 owns route-level granularity. Pick one: U5b ships per-route flag mechanism (expanding scope), or R16 means per-app process-level (consistent with Scope Boundaries but weaker than F3's "bounded blast radius" framing).

- **[Affects R6, Problem Frame][Internal contradiction]** _(adversarial, 75)_ — R6 says "unbounded cycles — gate is correctness, not time" but Problem Frame says Strapi removal is a "fixed external constraint" in 1-2 weeks. Both can't be true. Specify the contingency: if diff set hasn't converged by T-N days before Strapi removal, what happens? Coordinate Strapi extension? Force-cutover with extended allow-list? Defer cutover?

- **[Affects A5, Key Decisions, Outstanding Questions][Decision quality]** _(product-lens, 75)_ — No-Strapi-backstop assumption frames the backstop as an external coordination ask, but Urim owns both consumer-side and admin-side work — the "team" that would confirm a backstop is the same person making the decision. Resolve explicitly: do I keep Strapi running zero-traffic for 1-2 weeks as a runtime backstop or not? Document the actual reason if "no."

- **[Affects R1][RESOLVED by 2026-05-11 spike]** gql.tada parser compatibility with 17-member nested unions confirmed working. Spike ran `gql-tada generate output` against a representative SDL overlay (5 block types covering all structural patterns: simple, enum-bearing, nested-array, two nested unions, shared-member-across-unions) and produced a usable `.d.ts` with all unions exposed via `possibleTypes` literal-union lists. Sample queries selecting from each union with `... on TypeName { ... }` typechecked clean.

- **[Affects F1, R4, R7][Security/Operational]** _(security-lens, 75)_ — Batch verification fetches every published slug from admin at corpus scale. Specify: (1) what identity the harness authenticates as (CONSUMER_BEARER → saturates the SSR bucket; separate verification credential → bypasses rate-limit protections meant to protect admin); (2) concurrency caps and back-off behavior; (3) whether the run is isolated from production traffic paths.

- **[Affects R1][Security]** _(security-lens, 75)_ — Synthetic schema overlay derives types from admin's Zod BlocksSchema. Does any field on any block kind carry information safe internally but PUBLIC-disclosure-risky (draft-state metadata, internal IDs, locale-gating logic)? Add a field-level audit to the admin-side PR that ensures no block field exposed through the overlay is outside PUBLIC posture.

- **[Affects Rollback / F3][Operational]** _(security-lens, 75)_ — Emergency admin takedown procedure undefined. Rollback story addresses consumer side only. If admin itself is incident origin (auth compromised, schema regression leaking data), feature flag only stops new requests; doesn't stop existing sessions or direct API callers. Add admin's own incident-response surface: who can take admin offline, what mechanism (Railway stop, Cloudflare WAF rule, network-level block), who owns the decision.

- **[Affects Outstanding Questions, Scope Boundaries][Scope]** _(adversarial, 75)_ — U5 deletion PR creates dead-weight runtime branching during cutover. R3's two-value collapse makes U5's runtime canary infrastructure dead the moment direct cutover happens. Consider bringing the U5 deletion into U5b's scope as a co-shipment (natural with R3's collapse) rather than tracking as a follow-up.

- **[Affects R4-R6, Key Decisions][Risk weighting]** _(product-lens, 75)_ — Batch verification now carries the safety weight of the entire phased ramp under the no-Strapi-backstop assumption, but R6's "unbounded cycles" has no time budget against the Strapi-removal deadline. Add explicit contingency: if cycles don't converge before deadline, the fallback is X (Strapi extension request, partial cutover with allow-list, deferred cutover, etc.).

### From 2026-05-11 review — FYI observations (no decision required)

- **[Affects Problem Frame][Premise]** _(product-lens, 50)_ — "Highest-leverage move right now" claim implicit; opportunity cost vs alternative work (TV app development, admin editorial features) not surfaced.
- **[Affects Summary, Problem Frame][Premise]** _(product-lens, 50, demoted via same-persona premise collapse)_ — Sunk-cost framing on PR #912/#915 not addressed; "what if we did nothing on consumer migration for 4 weeks" not considered.
- **[Affects Problem Frame, Key Decisions][Architecture alternative]** _(product-lens, 50, demoted via same-persona premise collapse)_ — Alternative "decouple Strapi codebase removal from Strapi service removal" not evaluated — `apps/cms` source deletion + manager write-path kill + frozen read-only Strapi service serving consumers for 4-6 weeks is the 80%-value-at-20%-cost option.
- **[Affects Requirements][Prioritization]** _(product-lens, 50)_ — Requirements R1-R19 have no priority differentiation (P0/P1/P2 tags or must-have/should-have framing). Under deadline pressure, planner discovers priority hierarchy on contact with reality.
- **[Affects Outstanding Questions][Categorization]** _(scope-guardian, 50)_ — Deferred-to-Planning items mix product decisions (mobile/TV sequencing) with operational/research questions (deletion-PR ownership, batch orchestration). Separate categories would clarify which need pre-planning resolution.
- **[Affects F1, R4][Operational]** _(feasibility, 50)_ — Batch verification corpus size + runtime budget not estimated; should pair with the corpus-size estimate in product-9 / adv-3 above.
- **[Affects Problem Frame, Key Decisions][Strategic]** _(adversarial, 50)_ — Alternatives to "synthetic schema + direct cutover" not seriously considered: (a) coordinated Strapi extension by 2-4 weeks, (b) ship `blocks: JSON` and narrow with runtime Zod in consumer fragments. Briefly enumerate and dismiss (or accept).

### Pre-planning recommendation

**All four originally-upstream items are now resolved by the 2026-05-11 dialogue + rescope + spike:**

- Strapi timeline → "plan against 1-2 weeks; accept compressed trade-offs" (Key Decision)
- Mobile/TV bearer extraction → web-only bearer (Key Decision)
- Scope bundling → web cutover only; mobile/TV get their own brainstorms (Key Decision)
- Synthetic schema feasibility → hand-authored Pothos union types + drift-CI test, discriminator field `t`, gql.tada parser compatibility confirmed (Key Decision; spike artifacts under `.tmp/spike-synthetic-schema/`)

`ce-plan` is unblocked. The remaining P1s and P2s in the deferred section are plan-time decisions, not brainstorm-time blockers. Specifically, planning will resolve:

- `watchSetting` web-cutover scope (slug-page only vs slug-page + homepage)
- Bearer key lifecycle (rotation policy, log-scrub commitment, source-control prohibition)
- Batch verification scale/runtime estimate + orchestration surface
- Batch verification snapshot-vs-evolving-content mechanism
- The internal contradictions (AE4 vs R3; R16 route-level vs Scope Boundaries)
- The unbounded-cycles-vs-deadline contingency

Note: the doc-review's P1 "synthetic schema permanent maintenance" concern is acknowledged but not resolved here — it's accepted as the cost of the synthetic-schema architecture. Drift-CI is the mitigation; admin's block schema is stable enough that the maintenance cost is small.
