---
title: "feat: consumer migration Unit 1 — query & shape inventory"
type: feat
status: completed
date: 2026-05-07
origin: docs/plans/2026-04-22-001-feat-admin-core-consumer-migration-plan.md
---

# feat: consumer migration Unit 1 — query & shape inventory

## Summary

Implementation plan for **Unit 1** of the admin-core consumer migration: produce a precise, machine-checkable inventory of every Strapi GraphQL operation issued by the three consumer apps (`apps/web`, `apps/mobile`, `apps/tv`) and the runtime shape each consumer expects. The inventory lands as a single committed Markdown deliverable, `docs/admin-core-migration/query-inventory.md`, organized for downstream Units 2–7 to consume as their planning input. This is a documentation-only PR — no consumer code changes, no admin schema widening, no parity tooling. Unit 2 (admin PUBLIC schema readiness) consumes the inventory's "missing PUBLIC" rows; Unit 5 (web vertical slice) consumes the per-operation cache/variables tables; Unit 6 (mobile/TV adapter) consumes the `__typename` → admin `t` mapping table.

---

## Glossary

This plan uses domain-specific terms. Skim this section first if any of them are unfamiliar.

### People & roles

| Term     | Meaning                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Urim** | Sole owner of consumer-side migration as of 2026-05-07. Owns this plan end-to-end (web + mobile + TV inventory, block mapping, PUBLIC classification, verification, and commit). |

### Plan notation

| Term                       | Meaning                                                                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-ID (R1, R2, …)**       | Requirement IDs. Each is a "must-be-true" criterion this plan delivers; numbers trace back to the origin parent plan's Unit 1 spec (lines 120–154).                                                                                                                                          |
| **U-ID (U1, U2, …)**       | Implementation Unit IDs within this plan. Stable across plan edits — never renumbered.                                                                                                                                                                                                       |
| **Origin doc**             | The parent migration plan: `docs/plans/2026-04-22-001-feat-admin-core-consumer-migration-plan.md`. Unit 1's spec lives at lines 120–154 of that file.                                                                                                                                        |
| **Parent plan Unit 2 / 5** | The follow-on units that depend on this inventory's output. Unit 2 = admin PUBLIC schema readiness (consumes "missing PUBLIC" rows); Unit 5 = web vertical slice (consumes per-operation tables).                                                                                            |
| **Inventory deliverable**  | The single Markdown file `docs/admin-core-migration/query-inventory.md` produced by this plan. Directory does not currently exist — it is created in U1.                                                                                                                                     |
| **Operation key**          | Stable identifier per inventoried operation, format `{app}:{ConstantName}`. Example: `web:GET_WATCH_EXPERIENCE`, `mobile:SEMANTIC_SEARCH`. JS const name preferred over GraphQL operation name when they diverge (the const name is what `rg "graphql\("` finds — the verification command). |

### Consumer apps & their data layers

| Term                           | Meaning                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Consumer apps / consumers**  | `apps/web`, `apps/mobile`, `apps/tv` — the three apps that read content from Strapi today and will eventually read from admin.                                                                                                                                                                                                                                                     |
| **Renderer**                   | The React/React Native/RN-TV component that consumes a typed query result and renders a page or section. Each consumer has a different renderer family; their prop contracts are what migration must preserve.                                                                                                                                                                     |
| **Normalizer**                 | The thin per-app function (mobile: `apps/mobile/src/lib/normalizer.ts`; TV: `apps/tv/src/lib/normalizer.ts`) that maps Strapi `__typename` strings to renderer-friendly `kind` discriminants. Web's equivalent is inline in `lib/content.ts`.                                                                                                                                      |
| **Web `content.ts` resolvers** | The web app's RSC data layer (`apps/web/src/lib/content.ts`) — wraps Apollo `client.query` calls with `unstable_cache` + `cache()`, normalizes results into `ResolvedWatchPage` / `ResolvedWatchVideo` discriminated unions for page renderers.                                                                                                                                    |
| **Synthetic watch blocks**     | The 6 `kind` discriminants the web watch route invents at resolve time: `HeroPlayer`, `SiblingCarousel`, `WatchBody`, `StudyQuestions`, `BibleQuotes`, `Share`. NOT Strapi `__typename` values — they exist purely so the watch renderer can dispatch watch-only components alongside Strapi-typed Experience blocks. Defined in `apps/web/src/lib/content.ts` `WatchBlock` union. |

### Admin & block mapping

| Term                        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`__typename`**            | GraphQL's runtime type-discriminator field. Strapi emits `ComponentSectionsVideoHero`, `ComponentSectionsBibleQuotesCarousel`, etc. for dynamic-zone block items — these are what consumer renderers switch on today.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Admin `t` discriminator** | The Zod-discriminator literal each admin block carries (`videoHero`, `bibleQuotesCarousel`, etc.). Defined in `apps/admin/src/domain/blocks.ts`. Replaces `__typename` in admin-sourced responses.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Block scope union**       | Admin blocks are organized into three nested-validity scopes (top-level `BlockSchema`, `SectionContentBlockSchema`, `ContainerContentBlockSchema`) mirroring Strapi's dynamic-zone restrictions. The inventory's mapping table notes which scope each block lives in.                                                                                                                                                                                                                                                                                                                                                                                           |
| **PUBLIC tier**             | Admin's anonymous-request authorization scope. Today exposes 4 queries: `experienceBySlug`, `searchExperiences`, `search` (the hybrid keyword+semantic field — file is `hybrid-search.ts` but the GraphQL field is named `search`, not `hybridSearch`), `sceneRecommendations`. Defined per-field via `authScopes: { public: true }` Pothos annotations on the resolvers in `apps/admin/src/graphql/queries/*.ts` and `apps/admin/src/graphql/types/experience.ts` — NOT in `apps/admin/src/auth/permissions.ts` (that file is a `hasPermission(user, key)` helper, unrelated to PUBLIC scope). The inventory flags every consumer operation against this list. |
| **Preview-only operation**  | A consumer operation that intentionally reads draft / unpublished content (e.g., a Strapi preview-mode query path with `publicationState: PREVIEW` or equivalent). MUST NOT become PUBLIC in admin — must remain authenticated.                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### GraphQL & gql.tada

| Term                     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **gql.tada `graphql()`** | The typed factory exported from `@forge/graphql`. Operations defined in consumer apps as `` graphql`query { ... }` `` get their full TS types inferred from the committed Strapi introspection. This inventory's "every operation" claim = every callsite of `graphql(...)` **AND** every callsite of raw Apollo `` gql`...` `` — at least one consumer operation today uses raw Apollo (`apps/web/src/lib/recommendations.ts:27` defines `SCENE_RECOMMENDATIONS` with ` gql` ``), which `rg "graphql\("` does NOT match. The verification sweep (R7) must run both patterns. |
| **Fragment**             | A reusable GraphQL selection set. Web composes large queries from per-block fragments under `apps/web/src/lib/fragments/`; mobile and TV inline most fragments inside their `queries.ts`.                                                                                                                                                                                                                                                                                                                                                                                     |
| **Cache behavior**       | How a consumer caches a query result: web uses `unstable_cache(..., { revalidate: N })` plus `cache()` (RSC-level); mobile/TV use Apollo's normalized cache with `fetchPolicy` choices. Inventory records the actual cache shape for each operation.                                                                                                                                                                                                                                                                                                                          |

### Project-specific files referenced

| Path                                                                                                     | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/plans/2026-04-22-001-feat-admin-core-consumer-migration-plan.md`                                   | The parent 7-unit migration plan. Unit 1 spec at lines 120–154.                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/admin-core-migration/`                                                                             | (To be created in U1.) New top-level directory holding Unit 1's deliverable plus Unit 7's future runbook (`rollout-runbook.md`).                                                                                                                                                                                                                                                                                                          |
| `docs/admin-core-migration/query-inventory.md`                                                           | (To be created in U5.) The single inventory deliverable. All 5 sub-units write into this one file; U5 is the assembly + verification pass.                                                                                                                                                                                                                                                                                                |
| `apps/web/src/lib/content.ts`                                                                            | Web's RSC data layer. Contains the Strapi-side `graphql()` operations plus the `WatchBlock` synthetic-block union.                                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/lib/fragments/`                                                                            | Per-block web fragments. 17 files plus `index.ts` re-exports + `__tests__/`.                                                                                                                                                                                                                                                                                                                                                              |
| `apps/web/src/lib/{search,demo-search,recommendations}.ts`                                               | Other web `graphql()` callsites discovered during Phase 1 sweep. Search/discovery domain operations live here.                                                                                                                                                                                                                                                                                                                            |
| `apps/mobile/src/lib/queries.ts`                                                                         | Mobile's GraphQL layer — fragments + queries inline (18 `graphql(` callsites total).                                                                                                                                                                                                                                                                                                                                                      |
| `apps/mobile/src/lib/normalizer.ts`                                                                      | Mobile's `__typename` → `kind` mapper (the `TYPENAME_TO_KIND` constant defines the renderer-facing discriminants).                                                                                                                                                                                                                                                                                                                        |
| `apps/tv/src/lib/queries.ts`                                                                             | TV's GraphQL layer — structurally similar to mobile but with deliberate divergence (`LIST_EXPERIENCES` selects VideoHero blocks for focus-driven hero; `SEMANTIC_SEARCH` adds `searchMode` field).                                                                                                                                                                                                                                        |
| `apps/tv/src/lib/normalizer.ts`                                                                          | TV's `__typename` → `kind` mapper.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/admin/src/domain/blocks.ts`                                                                        | Admin's Zod block union — **19 distinct `t` literals** distributed across 3 scope unions: `BlockSchema` (top-level — 17 members incl. admin-only `videoRecommendations`), `SectionContentBlockSchema` (adds section-only `quizButton`), `ContainerContentBlockSchema` (adds admin-only `containerSlot`). The mapping target.                                                                                                              |
| `apps/admin/src/graphql/queries/{search,hybrid-search,scene-recommendations}.ts` + `types/experience.ts` | Where admin's PUBLIC tier is actually defined — per-field `authScopes: { public: true }` Pothos annotations. The 4 PUBLIC fields: `experienceBySlug` (in `types/experience.ts`), `searchExperiences` (`queries/search.ts`), `search` (`queries/hybrid-search.ts`), `sceneRecommendations` (`queries/scene-recommendations.ts`). Cross-check target for U5.                                                                                |
| `apps/admin/schema.graphql` (post-#902)                                                                  | Committed admin SDL artifact, ~865 lines, drift-checked in CI. Lands on main when [PR #902](https://github.com/JesusFilm/forge/pull/902) merges. **Critical seam:** `ExperienceLocale.blocks` is exposed as `JSON` scalar, NOT as a typed union — `t` is a runtime Zod discriminator on the JSON payload, not a GraphQL `__typename`. Unit 5/6 adapters parse JSON before discriminating on `t`. U4's mapping table should annotate this. |

---

## Problem Frame

The parent migration plan defines a 7-unit cutover from Strapi to admin GraphQL for `apps/web`, `apps/mobile`, and `apps/tv`. Every downstream unit assumes a precise, current census of what each consumer reads from Strapi today: Unit 2 needs to know which admin PUBLIC queries to add or harden; Unit 4 needs to know which response fields to compare; Unit 5 needs to know which operations the web vertical slice touches; Unit 6 needs the block `__typename` map for the mobile/TV adapter; Unit 7 needs the rollout staging order. Today, that census exists only as scattered tribal knowledge across three consumer apps' data layers — there is no single artifact a planning agent can grep against. Without it, Units 2–6 will start with conflicting assumptions and silently miss operations (especially the small-surface-area ones in `apps/web/src/lib/{search,demo-search,recommendations}.ts` that Phase 1 research surfaced) — exactly the failure mode the parent plan's "Schema drift disguised as compatible names" risk warns about.

This plan executes Unit 1 of the parent: build that census once, commit it, and verify it covers every `graphql(` callsite under `apps/{web,mobile,tv}/src` so downstream units can plan against a single source of truth.

---

## Requirements

- R1. The inventory deliverable exists at `docs/admin-core-migration/query-inventory.md`, is committed, and renders cleanly as Markdown. (origin Unit 1 Files)
- R2. Every `graphql(` callsite under `apps/web/src`, `apps/mobile/src`, and `apps/tv/src` appears in the inventory exactly once, identified by stable operation key. (origin Unit 1 Test scenario "Inventory includes every `graphql(` operation")
- R3. For each operation, the inventory records: variables (name + GraphQL type), public/private access expectation, cache behavior (concrete: `unstable_cache(revalidate:N)` / Apollo `fetchPolicy: "no-cache"` / etc.), and the renderer / resolver that depends on it. (origin Unit 1 Approach)
- R4. For each consumer-selected field in each operation, the inventory tags it as one of: **direct-admin-parity** (admin emits the same shape), **adapter-required** (admin emits semantically equivalent data under a different shape — e.g., `__typename` → `t`), **missing** (no admin counterpart exists yet — Unit 2 must add it), or **intentionally-deprecated** (consumer should drop the field as part of migration). (origin Unit 1 Approach)
- R5. Every section/block `__typename` value referenced by any consumer query (Strapi `ComponentSections*` family) is mapped to its admin counterpart in `apps/admin/src/domain/blocks.ts` (the `t` discriminator and the scope union it lives in), or explicitly flagged as **missing**. (origin Unit 1 Test scenario "Inventory maps every section/block `__typename`")
- R6. The inventory identifies every preview-only operation (i.e., reads draft / unpublished content) and explicitly marks it MUST-NOT-become-PUBLIC. Every other read operation is classified PUBLIC-eligible (current admin PUBLIC tier, OR Unit-2-widening-required). (origin Unit 1 Test scenario "Inventory identifies preview-only operations")
- R7. The verification commands — `rg "graphql\(" apps/web/src apps/mobile/src apps/tv/src` **AND** ``rg "= gql\`" apps/web/src apps/mobile/src apps/tv/src`` — produce output that the inventory document accounts for line-by-line. The second command is required because at least one consumer operation (`SCENE_RECOMMENDATIONS` in `apps/web/src/lib/recommendations.ts`) uses raw Apollo `` gql`...` `` instead of gql.tada `graphql(...)`; the parent plan's single-pattern command misses it. No callsite present in either rg output is absent from the inventory, and no inventory entry references a callsite absent from both rg outputs. (origin Unit 1 Verification, expanded to catch raw `gql` tags)

**Origin acceptance criteria (parent plan Unit 1 Verification, lines 152–154):** R1, R2, R7 are the parent's stated verification gates; R3–R6 are derived from the parent's Approach + Test scenarios sections.

---

## Scope Boundaries

- No changes to consumer code (`apps/web`, `apps/mobile`, `apps/tv`) — read-only sweep, documentation-only output
- No changes to admin schema, admin auth scopes, or `apps/admin/src/domain/blocks.ts` — admin is the **mapping target**, not the mutation target. Any "missing" rows discovered are written to the inventory and feed Unit 2's planning, not implemented here
- No changes to `packages/graphql` — Unit 3 owns the dual-client work, already in flight on a parallel branch
- No live admin queries, no parity comparison, no fixture generation — those are Unit 4 territory
- No feature flags, no rollout instrumentation, no observability — those are Unit 5 / Unit 7 territory
- No `.cursor/rules` or `CLAUDE.md` updates — the inventory file itself is the only artifact
- No test code (the deliverable is a Markdown file; "verification" is the rg cross-check, not a test runner)
- Manager (`apps/manager`) is **out of scope** — the parent plan explicitly excludes manager migration from this cutover. Only the three consumer apps named in the parent plan's Unit 1 Files block are covered

### Deferred to Follow-Up Work

- Admin PUBLIC-query additions for "missing" operation rows: Unit 2 (`docs/admin-core-migration/admin-public-readiness.md` once written)
- Adapter functions to translate `__typename` → admin `t`: Unit 5 (web canary) and Unit 6 (mobile/TV)
- Live response parity comparison for cataloged operations: Unit 4
- Strapi-to-admin scalar handling decisions (e.g., relative image URL base): also Unit 4 + Unit 5 — flagged in inventory but not resolved
- Manager (`apps/manager`) inventory: separate plan if/when manager migration moves onto the roadmap

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/lib/content.ts` — RSC data layer; defines 5 web `graphql()` operations (`GET_EXPERIENCE`, `GET_WATCH_EXPERIENCE`, `GET_WATCH_SETTINGS`, `GET_ROUTE_VIDEO`, plus the imported `getWatchVideoOperation` and `getWatchVideoBySlugOperation` from `lib/fragments/watch-video.ts`). Uses `unstable_cache(..., { revalidate: 60 })` + `cache()` for RSC dedup. Defines the `WatchBlock` synthetic union (6 `kind` literals) — these are NOT Strapi `__typename`s and must be excluded from the block mapping table to avoid a false "missing" row
- `apps/web/src/lib/fragments/` — 17 per-block fragment files plus `index.ts` re-exports plus `watch-experience.ts` and `watch-video.ts` composite fragments. Each fragment file owns one Strapi block component's projection
- `apps/web/src/lib/{search,demo-search,recommendations}.ts` — three additional web `graphql()` callsites discovered in Phase 1 (`SEMANTIC_SEARCH`, `GET_DEMO_VIDEO`, `GET_VIDEO_BY_SLUG`). Easily missed by a "just look at content.ts" sweep — explicit per-file enumeration in U1 prevents this
- `apps/mobile/src/lib/queries.ts` — 18 `graphql()` callsites (10 leaf fragments + 2 composite fragments + 4 query/listing operations + 2 search operations). All inline in one file
- `apps/mobile/src/lib/normalizer.ts` — defines the canonical `TYPENAME_TO_KIND` map (17 entries: `ComponentSectionsVideoHero` → `videoHero`, etc.). This map is the **starting point** for the U4 block-mapping pass — every entry must be cross-checked against admin's `t` literals
- `apps/tv/src/lib/queries.ts` — 18 `graphql()` callsites (mostly mirroring mobile structurally, with two documented divergences: `LIST_EXPERIENCES` selects VideoHero blocks for focus-driven hero; `SEMANTIC_SEARCH` adds `searchMode` field). The deliberate divergences are why per-app passes can't be collapsed into "mobile + tv share fragments"
- `apps/tv/src/lib/normalizer.ts` — TV's `__typename` → `kind` mapper. Spot-check it against mobile's to surface any silent drift
- `apps/admin/src/domain/blocks.ts` — admin block Zod union: 17 top-level `t` literals + 3 scope unions (`BlockSchema`, `SectionContentBlockSchema`, `ContainerContentBlockSchema`). The mapping target for U4
- `apps/admin/src/graphql/queries/{search,hybrid-search,scene-recommendations}.ts` + `apps/admin/src/graphql/types/experience.ts` — where admin's PUBLIC tier is defined via per-field `authScopes: { public: true }` annotations. The cross-check target for U5's PUBLIC classification pass. (`apps/admin/src/auth/permissions.ts` is a permission-key helper, NOT the PUBLIC tier definition — the parent plan's reference to it as the PUBLIC source is incorrect.)
- `apps/admin/schema.graphql` (will be on main once [PR #902](https://github.com/JesusFilm/forge/pull/902) merges) — committed admin SDL artifact. U4 should cross-read this in addition to `blocks.ts`: it is the actual consumer-facing GraphQL surface, and it exposes `ExperienceLocale.blocks` as `JSON`, not as a typed union — a load-bearing seam for Unit 5/6 adapters
- `apps/web/src/app/api/preview/route.ts` — Strapi preview toggle gated on `STRAPI_PREVIEW_SECRET`, uses Next.js `draftMode()` cookie. U5 must scan for `draftMode().isEnabled` reads in addition to GraphQL variables/headers; the cookie-based mechanism is invisible to operation-level call-site scanning

### Institutional Learnings

- `docs/solutions/cms/admin-app-data-model-decisions.md` (referenced by parent plan) — admin block-shape decisions, especially the `t` discriminator choice and three-scope union pattern. Read before U4 to anchor mapping decisions
- `docs/solutions/integration-issues/mobile-relative-image-url-no-base-origin-20260408.md` (referenced by parent plan) — native consumers need explicit absolute-URL handling. The inventory's per-operation field-tagging (R4) should flag any `imageUrl` / `media.url` / `images[].url` field as adapter-required-or-flag-for-Unit-4 because URL-base resolution differs between Strapi and admin

### External References

- None — this is a read-only documentation pass against in-repo source. No external best-practice research was warranted (Phase 1.2 explicitly skipped: the codebase has strong local patterns for both inventory-style docs — see `apps/cms/schema.graphql` and the per-app `lib/queries.ts` files — and the work has zero external-dependency risk)

---

## Key Technical Decisions

- **Single deliverable file, not per-consumer files.** All 5 sub-units write into one Markdown file at `docs/admin-core-migration/query-inventory.md`. Rationale: the parent plan's Files block specifies a single `query-inventory.md`, and downstream units (esp. Unit 6's mobile/TV adapter) need to read web + mobile + TV side-by-side to identify cross-app structural divergence. A single file is also what the verification command `rg "graphql\("` produces a single grep against — cross-checking is easier when the inventory has one search target.

- **Operation key format = `{app}:{ConstantName}`.** Example: `web:GET_WATCH_EXPERIENCE`, `mobile:LIST_EXPERIENCES`, `tv:SEMANTIC_SEARCH`. Rationale: `rg "graphql\("` finds the JS const name, not the GraphQL operation name (e.g., `web:GET_WATCH_SETTINGS` — the GraphQL op is also `GetWatchSettings`, but mobile's `GET_WATCH_EXPERIENCE` and TV's `GET_WATCH_EXPERIENCE` share the same GraphQL op name `GetWatchExperience` despite being separate callsites). Const-name keying makes the verification rg cross-check trivially line-mappable. Alternative considered: `{app}:{GraphQLOpName}` rejected because of the mobile/TV `GetWatchExperience` collision.

- **Block mapping table uses Strapi `__typename` (canonical) as the join key, NOT the per-app `kind` discriminant.** Mobile's `TYPENAME_TO_KIND` and TV's equivalent are useful research starting points but they are app-local view models — the only stable cross-app identifier is the Strapi `__typename`. Rationale: a single table keyed on `__typename` lets a reader scan once and see "this block exists in admin as `videoHero`, lives in `BlockSchema` + `SectionContentBlockSchema` scopes, mobile renders it as `kind: "videoHero"`, TV renders it as `kind: "videoHero"`, web has no per-block normalization layer". Three-app divergence becomes immediately visible.

- **Synthetic web `WatchBlock` discriminants are documented separately, NOT in the block mapping table.** The 6 `kind: "HeroPlayer" | "SiblingCarousel" | "WatchBody" | "StudyQuestions" | "BibleQuotes" | "Share"` values that `apps/web/src/lib/content.ts` invents at resolve time are NOT Strapi `__typename`s — they are watch-route-only synthetic types layered on top of the Strapi response. Rationale: tagging them in the block mapping table as "missing in admin" is a category error — they don't exist in EITHER Strapi schema OR admin schema; they're a web-renderer concern. They get their own short subsection in the inventory (~5 lines) noting that Unit 5 will need to keep this synthesis layer in the web adapter.

- **PUBLIC classification is binary + "Unit 2 must widen".** Each operation gets one of three labels: (a) **PUBLIC-current** = already in admin's 4-query PUBLIC tier per the `authScopes: { public: true }` annotations in `apps/admin/src/graphql/queries/*.ts` and `apps/admin/src/graphql/types/experience.ts`; (b) **PUBLIC-eligible-needs-widening** = should be PUBLIC but admin doesn't expose it yet (Unit 2 work); (c) **MUST-stay-authenticated** = preview/draft reads (including future `draftMode().isEnabled` paths), never PUBLIC. Rationale: this exact tripartite is what Unit 2's planning needs as input — anything fuzzier creates a per-operation negotiation that Unit 2 will have to redo.

- **Field-level tagging is per-operation, not per-fragment.** When a fragment is reused across operations (e.g., `videoHeroFragment` used in both web's `getWatchVideoOperation` and TV's `LIST_EXPERIENCES`), each operation's row tags the fields independently. Rationale: parity status can diverge by call-site (e.g., the same field could be direct-parity when read in one operation's context and adapter-required in another's because of a sibling field that does not exist in admin). Per-operation tagging keeps the table honest. Cost: the table is longer; mitigation: each operation's table is collapsed under its own subheading.

- **Verification is a manual cross-check, NOT a script.** R7 is enforced by U5 running the rg command and walking each line against the inventory. Rationale: a verification script would be Unit 4 territory (parity tooling) — Unit 1's deliverable is a doc, not a tool. The rg command is short enough to run by hand; the doc is structured (operation key as section anchor) so the cross-check is just "for each rg hit, ctrl-F the constant name in the inventory".

---

## Open Questions

### Resolved During Planning

- **Inventory file path**: `docs/admin-core-migration/query-inventory.md` (mirrors origin parent plan's Files block exactly). Directory does not currently exist — created by U1's first write
- **Operation key format**: `{app}:{ConstantName}` — see Key Technical Decisions above for rationale and alternative-considered
- **Whether to inventory `apps/manager`**: NO — parent plan's Unit 1 Files block names only `apps/web`, `apps/mobile`, `apps/tv`. Manager migration is out of the parent plan's scope entirely
- **Whether to include synthetic web `WatchBlock` discriminants in the block mapping table**: NO — they get a separate subsection (see Key Technical Decisions)
- **Whether U1–U3 (per-app passes) can run in parallel**: YES — each pass writes a distinct subsection of the inventory file. U4 (block mapping) and U5 (PUBLIC classification + verification) require U1–U3 to be merged first since they read the per-app sections
- **Cross-check tooling**: manual rg + ctrl-F (see Key Technical Decisions). No script written

### Open from doc review (2026-05-07, vs PR #902)

The following findings surfaced during `/ce-doc-review` against the plan with PR #902 (Units 2 + 3, brief numbering — admin SDL emit + dual-client codegen) as cross-reference. The P1+P2 findings have already been folded into the plan body above. These are deferred for the implementer's judgment at writing time:

- **R1 distribution.** The current plan claims R1 in U1, U2, U3, U4, AND U5. Coherence-reviewer flagged this as misleading: the file isn't complete-and-renderable until U5 finishes assembly. Decision deferred — either move R1 to U5 only, or split it into R1a (file exists, claimed by U1) + R1b (file is verified and committed, claimed by U5). Either is valid; the plan body is silent today
- **"web ~9" callsite count framing.** Actual `rg "graphql\(" apps/web/src` returns 27 lines (9 ops + 18 fragments). R7's strict line-by-line check applies to all 27. The plan's hedged "9 ops" framing risks an implementer skipping fragment lines during verification. Mitigation already in U1 Approach ("fragments listed as nested selection-set notes"), but R7 itself does NOT spell out that "matching inventory entry" can be either an operation subsection OR a nested fragment note — clarify at writing time
- **`tv:SEMANTIC_SEARCH`'s `searchMode` field framing.** The plan flags this as a "PUBLIC exposure of degraded-backend status decision" for Unit 2 to resolve. Reality: `searchMode` is already PUBLIC in BOTH Strapi (web's `SEMANTIC_SEARCH` selects it today and ships it to the rendered page) AND admin (`apps/admin/src/graphql/queries/hybrid-search.ts:86` exposes `searchMode: HybridSearchMode!` under `authScopes: { public: true }`). The plan's "flag, do not decide" framing risks Unit 2 acting on it and gating an already-public field, which would regress current web search. Re-frame at writing time as: "`searchMode` is intentionally PUBLIC on both sides today; record this consistency as a confirmation, not a pending decision"
- **`Experience.ownerId` and `archivedAt` are PUBLIC-accessible via `experienceBySlug`.** `apps/admin/src/graphql/types/experience.ts:85-88` exposes these without per-field `authScopes`, and `experienceBySlug` is itself PUBLIC. R4's parity-tagging vocabulary (direct-parity / adapter-required / missing / intentionally-deprecated) lacks a category for "admin-side field with no Strapi parity that carries internal state." Add a 5th tag at writing time (e.g., "admin-only-internal-state-flag-for-Unit-2-review") so these fields are surfaced for explicit Unit 2 access-control review rather than silently inheriting the parent query's PUBLIC posture
- **`adminGraphql()` factory cross-reference.** Once PR #902 lands, `packages/graphql/src/admin.ts` exports `adminGraphql()`, `AdminResultOf`, `AdminFragmentOf`, `AdminVariablesOf`. The inventory's `## Scope & Conventions` section should add a one-line forward-reference: "Inventory entries describe today's Strapi-side `graphql()` calls; Unit 5/6 will rewrite each to use `adminGraphql()` from `packages/graphql/src/admin.ts`." Doesn't change U1's deliverable but tightens downstream-unit handoff
- **U1–U3 parallelism scope.** The plan answers "can U1–U3 run in parallel" with "YES" but the answer assumes a single-PR workflow. In a multi-PR workflow, they cannot run truly in parallel — one must land first, then subsequent PRs rebase against the same file. Decision: clarify the answer at writing time as "YES in single-PR; sequential in multi-PR" or move the answer entirely to "Deferred to Implementation" alongside the per-PR vs single-PR choice
- **Terminology normalization** (already applied above): "scope union" used consistently in place of mixed "scope union" / "nested-scope union" — purely mechanical normalization

### Deferred to Implementation

- **Whether each per-app pass produces a per-PR commit or all 5 sub-units land in one PR**: depends on review hygiene preference at implementation time. Default: one PR for the whole inventory (it's a single document; splitting across PRs creates merge-conflict risk on the same file). U-IDs are per-pass for sequencing clarity, not per-PR
- **Exact column set for the operation tables**: lightweight defaults proposed below in U5; final table column order may shift during writing if a column adds noise without value. The R3/R4/R6 fields are non-negotiable; cosmetic shape is not
- **Whether to inline the admin block scope (Block / SectionContent / ContainerContent) per row or as a footnote**: defer to writing time; if the table gets too wide, scopes move to a footnote
- **Format for "preview-only" detection signal**: Strapi consumers don't currently use a uniform preview flag; U5's PUBLIC-classification pass will inspect each operation's actual variables and call site to decide. If no preview-mode operation exists in any consumer today, the MUST-NOT-be-PUBLIC list is empty — that's a valid inventory finding, not a defect

---

## Output Structure

Greenfield deliverable: this plan creates a new top-level docs directory (`docs/admin-core-migration/`) plus the single inventory file. Follow-on units (Unit 7's runbook) will land alongside.

```
docs/
└── admin-core-migration/        # NEW directory
    └── query-inventory.md       # NEW file — the U1 deliverable
```

The inventory file's internal structure (proposed; finalized at writing time):

```
# Admin-Core Consumer Migration — Query & Shape Inventory

## Scope & Conventions
  - Operation key format
  - Field-tagging legend
  - PUBLIC-classification legend

## apps/web Operations
  ### web:GET_EXPERIENCE
  ### web:GET_WATCH_EXPERIENCE
  ### web:GET_WATCH_SETTINGS
  ### web:GET_ROUTE_VIDEO
  ### web:getWatchVideoOperation
  ### web:getWatchVideoBySlugOperation
  ### web:SEMANTIC_SEARCH (search.ts)
  ### web:GET_DEMO_VIDEO (demo-search.ts)
  ### web:GET_VIDEO_BY_SLUG (recommendations.ts — gql.tada)
  ### web:SCENE_RECOMMENDATIONS (recommendations.ts — raw Apollo gql)
  ### web — Synthetic WatchBlock discriminants (NOT Strapi typenames)

## apps/mobile Operations
  ### mobile:GET_WATCH_EXPERIENCE
  ### mobile:LIST_EXPERIENCES
  ### mobile:SEMANTIC_SEARCH

## apps/tv Operations
  ### tv:GET_WATCH_EXPERIENCE
  ### tv:LIST_EXPERIENCES
  ### tv:SEMANTIC_SEARCH

## Block __typename → Admin Discriminator Mapping
  - Single canonical table, joined on Strapi __typename

## PUBLIC Access Classification
  - PUBLIC-current
  - PUBLIC-eligible-needs-widening (feeds Unit 2)
  - MUST-stay-authenticated

## Verification Log
  - rg command output
  - Cross-check pass result
```

---

## Implementation Units

### U1. Web operations + shapes inventory pass

**Goal:** Catalog every `graphql(` callsite under `apps/web/src` into the `## apps/web Operations` section of the inventory file. Each operation gets its own subsection with variables, cache behavior, renderer dependencies, and per-field parity tagging.

**Requirements:** R1, R2, R3, R4

**Dependencies:** none — runs in parallel with U2 and U3

**Files:**

- Create: `docs/admin-core-migration/query-inventory.md` (this is the first sub-unit to write the file; subsequent units append)
- Create: `docs/admin-core-migration/` directory (does not exist yet)
- Read: `apps/web/src/lib/content.ts` (4 inline operations + 2 imported)
- Read: `apps/web/src/lib/fragments/index.ts` (re-export inventory)
- Read: every file under `apps/web/src/lib/fragments/` (17 per-block fragments + 2 composite fragments)
- Read: `apps/web/src/lib/search.ts` (1 operation: `SEMANTIC_SEARCH`)
- Read: `apps/web/src/lib/demo-search.ts` (1 operation: `GET_DEMO_VIDEO`)
- Read: `apps/web/src/lib/recommendations.ts` (**2 operations**: `GET_VIDEO_BY_SLUG` via gql.tada `graphql()`, AND `SCENE_RECOMMENDATIONS` via raw Apollo `` gql`...` ``. The second is invisible to `rg "graphql\("` and must be inventoried explicitly — it is the actual `sceneRecommendations` consumer, with a richer field set than `GET_VIDEO_BY_SLUG`: `similarity`, `themes`, `demographics`, `spiritualContext`, `sceneIndex`, `startSeconds`, `endSeconds`, `playbackId`)
- Read: `apps/web/src/lib/client.ts` (Apollo client + cache config to source the cache-behavior column)

**Approach:**

- Run BOTH `rg "graphql\(" apps/web/src` AND ``rg "= gql\`" apps/web/src`` first; treat the combined output as the work list. Every line becomes a `### web:{ConstantName}` subsection in the inventory. The second pattern catches `apps/web/src/lib/recommendations.ts:27` where `SCENE_RECOMMENDATIONS` is defined with raw Apollo `` gql`...` `` — the gql.tada-only sweep would silently skip it
- For each operation: extract variable list (name + GraphQL type), the renderer/resolver entry point that calls it (e.g., `resolveWatchPage` in `content.ts`), the cache wrapping shape (`unstable_cache(..., { revalidate: 60 })` / `client.query({ fetchPolicy: "no-cache" })` / etc.), and the response shape (top-level + nested fragments composed in)
- Tag each consumer-selected field as direct-admin-parity / adapter-required / missing / intentionally-deprecated. Do NOT yet check against admin for U1 — record the consumer-side need; U4 reconciles against admin's `blocks.ts`. Use a `?` tag if the parity status is genuinely unknown until U4
- Document the synthetic `WatchBlock` discriminants from `content.ts` in their own subsection (NOT a row in the future block mapping table) — note that these 6 `kind` values are watch-route-only synthesis and Unit 5's web adapter must preserve the synthesis layer
- Note the `getWatchVideoBySlugOperation` and `getWatchVideoOperation` are imported from `lib/fragments/watch-video.ts` but **counted as web operations** (their callsite is `content.ts`); they are NOT counted as fragments. The verification rg pass will see `graphql(` in `watch-video.ts` for the fragment definitions plus once in `content.ts` for the operation imports — both lines must appear in the inventory

**Patterns to follow:**

- `apps/cms/schema.graphql` header structure — committed introspection artifacts in this repo open with a "do not edit" / convention banner; the inventory file should open with a similar banner explaining what it is and how to regenerate after consumer-code changes
- The reference plan `docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md` glossary table style — multi-row Markdown tables with consistent column widths render well in GitHub PR review

**Test scenarios:**

- Covers R2 (web slice). Happy path: every line in `rg "graphql\(" apps/web/src` output has exactly one matching `### web:{ConstantName}` subsection in the inventory
- Covers R3. Happy path: each web operation subsection has all of {variables, access expectation, cache behavior, renderer dependency} populated; no field is "TBD"
- Covers R4. Happy path: every consumer-selected field in each operation has exactly one parity tag
- Edge case: the two `getWatchVideo*` operations live in `lib/fragments/watch-video.ts` (an unusual location for operations) — they must be inventoried as web OPERATIONS, not as fragments. Verification: each appears as `### web:{name}` not as a fragment-only entry
- Edge case: the synthetic `WatchBlock` 6-kind union from `content.ts` appears in its own subsection with explicit "NOT a Strapi typename" framing; it does NOT appear as a row in the eventual block-mapping table

**Verification:**

- `rg "graphql\(" apps/web/src` output is line-by-line accounted for in the `## apps/web Operations` section (manual cross-check)
- Spot-check three operations of varying complexity (`web:GET_EXPERIENCE` — simplest, `web:GET_WATCH_EXPERIENCE` — medium, `web:getWatchVideoOperation` — most complex) for completeness against R3 and R4

---

### U2. Mobile operations + shapes inventory pass

**Goal:** Catalog every `graphql(` callsite under `apps/mobile/src` into the `## apps/mobile Operations` section of the inventory file.

**Requirements:** R1, R2, R3, R4

**Dependencies:** none — runs in parallel with U1 and U3 (writes a different file section)

**Files:**

- Modify: `docs/admin-core-migration/query-inventory.md` (append `## apps/mobile Operations` section)
- Read: `apps/mobile/src/lib/queries.ts` (18 `graphql()` callsites)
- Read: `apps/mobile/src/lib/normalizer.ts` (the `TYPENAME_TO_KIND` map — feeds renderer-dependency column)
- Read: `apps/mobile/src/lib/apolloClient.ts` (cache + fetchPolicy config)

**Approach:**

- Same dual-rg enumeration approach as U1 (both `rg "graphql\("` AND ``rg "= gql\`"``), applied to `apps/mobile/src`
- Mobile's 18 callsites split into: 10 leaf fragments (e.g., `VideoHeroFragment`), 2 composite fragments (`ContainerFragment`, `SectionFragment`), 4 query/listing operations (`GET_WATCH_EXPERIENCE`, `LIST_EXPERIENCES`), and 2 search operations (`SEMANTIC_SEARCH` + any related). Distinguish fragments from operations in the inventory — fragments are listed as supporting selection sets under each operation that composes them, NOT as standalone operation rows. Standalone operation count for mobile expected: ~3 (`GET_WATCH_EXPERIENCE`, `LIST_EXPERIENCES`, `SEMANTIC_SEARCH`). Verify during writing
- For each operation, the renderer-dependency column points to the consumer in `apps/mobile/src/components/` (or wherever the Apollo `useQuery`/`useSuspenseQuery` callsite lives) — find these via `rg "GET_WATCH_EXPERIENCE\|LIST_EXPERIENCES\|SEMANTIC_SEARCH" apps/mobile/src`
- Cache-behavior column: mobile uses Apollo InMemoryCache + per-call `fetchPolicy` overrides. Document the actual choice per operation (e.g., `cache-and-network`, `network-only`)

**Patterns to follow:**

- U1's per-operation subsection structure (consistency across the three per-app sections aids the U4 and U5 cross-reads)

**Test scenarios:**

- Covers R2 (mobile slice). Happy path: every line in `rg "graphql\(" apps/mobile/src` output is accounted for — operations as `### mobile:{ConstantName}` subsections, fragments as nested selection-set notes inside the operation that composes them
- Covers R3. Happy path: each mobile operation subsection has all four R3 fields populated
- Covers R4. Happy path: every consumer-selected field has exactly one parity tag
- Edge case: `SEMANTIC_SEARCH` selects `searchMode` ONLY in TV, NOT in mobile. The mobile inventory row for `SEMANTIC_SEARCH` must NOT list `searchMode`; the TV row (U3) WILL. Verifies inventory captures the documented mobile/TV divergence

**Verification:**

- `rg "graphql\(" apps/mobile/src` output line-by-line accounted for
- Spot-check `mobile:GET_WATCH_EXPERIENCE` (the largest mobile operation, composes ~12 fragments) for completeness

---

### U3. TV operations + shapes inventory pass

**Goal:** Catalog every `graphql(` callsite under `apps/tv/src` into the `## apps/tv Operations` section of the inventory file. Explicitly capture the documented mobile/TV divergences.

**Requirements:** R1, R2, R3, R4

**Dependencies:** none — runs in parallel with U1 and U2

**Files:**

- Modify: `docs/admin-core-migration/query-inventory.md` (append `## apps/tv Operations` section)
- Read: `apps/tv/src/lib/queries.ts` (18 `graphql()` callsites — structurally similar to mobile)
- Read: `apps/tv/src/lib/normalizer.ts` (TV's `__typename` → `kind` map)
- Read: `apps/tv/src/lib/apolloClient.ts` (cache + fetchPolicy config)

**Approach:**

- Same dual-rg enumeration as U2 (both `rg "graphql\("` AND ``rg "= gql\`"``)
- Two documented divergences from mobile MUST be captured explicitly (see TV `queries.ts` lines 1–8 and 433–448 source comments):
  1. `tv:LIST_EXPERIENCES` selects a per-experience `ComponentSectionsVideoHero` block for the focus-driven home hero — mobile's listing query does not. Document this as a TV-specific selection in the inventory's `tv:LIST_EXPERIENCES` subsection plus a cross-reference note in `mobile:LIST_EXPERIENCES`
  2. `tv:SEMANTIC_SEARCH` selects an extra `searchMode` field that mobile does not — flag this in U5's PUBLIC-classification pass: `searchMode` exposes degraded-backend status to clients, which is a public/operational decision admin must replicate or decline
- Spot-check `apps/tv/src/lib/normalizer.ts` against `apps/mobile/src/lib/normalizer.ts` for any silent drift in the `TYPENAME_TO_KIND` map; if they diverge, note it in U4's mapping table

**Patterns to follow:**

- U1/U2 per-operation subsection structure

**Test scenarios:**

- Covers R2 (TV slice). Happy path: every line in `rg "graphql\(" apps/tv/src` output is accounted for
- Covers R3. Happy path: each TV operation subsection has all four R3 fields populated
- Covers R4. Happy path: every consumer-selected field has exactly one parity tag
- Edge case: the two documented mobile/TV divergences appear explicitly in the TV inventory (no silent normalization to "same as mobile")
- Edge case: TV's normalizer `TYPENAME_TO_KIND` map matches mobile's; if it diverges, the divergence is recorded as a finding for U4

**Verification:**

- `rg "graphql\(" apps/tv/src` output line-by-line accounted for
- The two mobile/TV divergences are captured verbatim with cross-references between the mobile and TV operation sections

---

### U4. Block `__typename` → admin discriminator mapping pass

**Goal:** Build the single canonical `## Block __typename → Admin Discriminator Mapping` table that joins every Strapi `ComponentSections*` typename used by any consumer query (web + mobile + TV combined) to its admin counterpart in `apps/admin/src/domain/blocks.ts`, OR explicitly flags it as missing from admin.

**Requirements:** R1, R5

**Dependencies:** U1, U2, U3 — needs every consumer's selected typenames cataloged before joining

**Files:**

- Modify: `docs/admin-core-migration/query-inventory.md` (append `## Block __typename → Admin Discriminator Mapping` section)
- Read: `apps/admin/src/domain/blocks.ts` (**19** `z.literal()` `t` values; see Approach below for scope distribution)
- Cross-read (post-#902): `apps/admin/schema.graphql` (committed admin SDL — note that `ExperienceLocale.blocks` is a `JSON` scalar, not a typed union; document this seam in the mapping table)
- Cross-read: the per-app sections written by U1/U2/U3 (extract every `__typename` value referenced)
- Cross-read: `apps/mobile/src/lib/normalizer.ts` and `apps/tv/src/lib/normalizer.ts` (`TYPENAME_TO_KIND` maps as starting point)

**Approach:**

- Build the union of all `ComponentSections*` typenames referenced by any operation across U1/U2/U3. Starting set = mobile's 17-entry `TYPENAME_TO_KIND` (every entry web and TV select is also in this map per the Phase 1 sweep)
- For each typename, look up the corresponding admin `t` literal in `apps/admin/src/domain/blocks.ts`. The file declares **19 distinct `z.literal()` values** distributed across three scope unions:
  - **`BlockSchema` (top-level — 17 members):** `adventCountdown`, `bibleQuotesCarousel`, `card`, `container`, `cta`, `easterDates`, `infoBlocks`, `mediaCollection`, `navigationCarousel`, `promoBanner`, `relatedQuestions`, `section`, `text`, `video`, `videoCarousel`, `videoHero`, `videoRecommendations` (admin-only — no Strapi counterpart, flag asymmetry)
  - **`SectionContentBlockSchema` (section-content-only):** adds `quizButton` (NOT in top-level union — section-restricted in admin; Strapi counterpart is `ComponentSectionsQuizButton` per `apps/mobile/src/lib/normalizer.ts:18`. Mapping table must record the scope restriction so Unit 5/6 adapters don't allow `quizButton` at top-level)
  - **`ContainerContentBlockSchema` (container-content-only):** adds `containerSlot` (admin-only nesting concept — no Strapi counterpart, flag asymmetry like `videoRecommendations`)
- For each row, also record which admin scope union the block belongs to (top-level `BlockSchema` / `SectionContentBlockSchema` / `ContainerContentBlockSchema`) — Strapi's dynamic-zone restrictions and admin's three-scope unions should align; any mismatch is a Unit 5 / Unit 6 adapter concern flagged here
- Flag any Strapi typename with NO admin counterpart as **missing** with a note for Unit 2. Flag any admin `t` with NO Strapi counterpart (e.g., `videoRecommendations`) as **admin-additional** — these are forward-looking blocks and are not migration concerns
- Reconcile against U1's web fragment files: each fragment under `apps/web/src/lib/fragments/` projects exactly one `ComponentSections*` typename — every fragment file's target typename must appear in the mapping table
- Spot-check that mobile's `TYPENAME_TO_KIND` and TV's match each other, and that both map to typenames present in admin's union (via the `t` literal)

**Patterns to follow:**

- Multi-column Markdown table style from the reference plan's glossary (consistent column widths render cleanly in GitHub PR review)

**Test scenarios:**

- Covers R5. Happy path: every Strapi `ComponentSections*` typename selected by any inventoried operation appears as exactly one row in the mapping table
- Covers R5. Happy path: each row has admin `t` literal + admin scope union(s) + parity status (direct / adapter / missing)
- Edge case: `ComponentSectionsCard` appears in admin as `card` but is unused by any consumer query (web/mobile/TV all skip it). Decision: still include in the table marked "consumer-unused" so future operations referencing it have a reference
- Edge case: `videoRecommendations` (admin-only forward-looking block) appears in a separate "admin-additional, not migration concerns" subsection — not in the main mapping table
- Edge case: mobile's `TYPENAME_TO_KIND` and TV's diverge on any entry → divergence is documented as a Unit 6 adapter concern in the row's notes column
- Edge case: an admin scope mismatch (e.g., a Strapi block appears at top-level in a consumer query but the admin counterpart is restricted to `SectionContentBlockSchema` only) is flagged as a Unit 5 adapter concern in the row's notes column

**Verification:**

- The set of `ComponentSections*` typenames in the mapping table equals the set of all typenames extracted from U1/U2/U3 operation rows (manual set-equality check)
- All 17 admin `t` literals in `apps/admin/src/domain/blocks.ts` are accounted for as either a row in the mapping table OR a row in the admin-additional subsection (no admin block silently dropped)

---

### U5. Preview/PUBLIC classification + verification + assembly pass

**Goal:** Build the `## PUBLIC Access Classification` section (tripartite: current-PUBLIC / needs-widening / MUST-stay-authenticated), then run the parent plan's verification command and record the cross-check result in the `## Verification Log` section. Final assembly pass to ensure the doc reads coherently end-to-end.

**Requirements:** R1, R6, R7

**Dependencies:** U1, U2, U3, U4 — needs every operation cataloged AND the block mapping in place for cross-references

**Files:**

- Modify: `docs/admin-core-migration/query-inventory.md` (append `## PUBLIC Access Classification` and `## Verification Log` sections; assembly review of the whole document)
- Read: `apps/admin/src/graphql/queries/scene-recommendations.ts`, `apps/admin/src/graphql/queries/hybrid-search.ts`, `apps/admin/src/graphql/queries/search.ts`, `apps/admin/src/graphql/types/experience.ts` — the 4 PUBLIC queries today, each carrying `authScopes: { public: true }`: `experienceBySlug` (in `types/experience.ts`), `searchExperiences` (`queries/search.ts`), `search` (`queries/hybrid-search.ts` — filename misleading; the GraphQL field is named `search`, NOT `hybridSearch`), `sceneRecommendations` (`queries/scene-recommendations.ts`)
- Read: `apps/web/src/app/api/preview/route.ts` — Strapi preview toggle gated on `STRAPI_PREVIEW_SECRET`; uses Next.js `draftMode()` cookie. Even if no current operation reads `draftMode().isEnabled`, the preview infrastructure exists and any future operation added to that flow MUST be classified MUST-stay-authenticated
- Cross-read: every operation subsection from U1/U2/U3 (read each operation's variables and call site to detect preview-mode signal, e.g., `publicationState: PREVIEW`, `draft: true`, or any auth-required header pattern in the Apollo client config)

**Approach:**

- For each inventoried operation across all three apps, classify into one of three buckets:
  1. **PUBLIC-current**: maps to one of admin's 4 already-PUBLIC queries (`experienceBySlug` ↔ web's `GET_EXPERIENCE` and `GET_WATCH_EXPERIENCE` ; `searchExperiences` / `search` ↔ `*:SEMANTIC_SEARCH` (admin's hybrid keyword+semantic field is named `search`, NOT `hybridSearch`); `sceneRecommendations` ↔ `web:SCENE_RECOMMENDATIONS` — the **raw-`gql`** callsite in `apps/web/src/lib/recommendations.ts:27`. **NOT `web:GET_VIDEO_BY_SLUG`**, which queries the `videos` endpoint with a slug filter and returns `documentId/title/slug/images` — an unrelated field set. Conflating the two would feed Unit 2 a wrong PUBLIC field set for `sceneRecommendations` and silently break consumer rendering of `similarity`/`themes`/`demographics`/`spiritualContext`/`startSeconds`/`endSeconds`/`playbackId`). Verify by grepping `authScopes: { public: true }` in `apps/admin/src/graphql/queries/*.ts` and `types/experience.ts` — do NOT assume from query name alone
  2. **PUBLIC-eligible-needs-widening**: should be PUBLIC (no preview-mode signal, no auth-required header) but admin doesn't yet expose a corresponding PUBLIC query. These rows feed Unit 2's planning. Likely candidates: `web:GET_ROUTE_VIDEO`, `web:GET_WATCH_SETTINGS`, `web:GET_VIDEO_BY_SLUG` (now that it is no longer mistakenly mapped to `sceneRecommendations`), `mobile:LIST_EXPERIENCES`, `tv:LIST_EXPERIENCES`, `web:getWatchVideoOperation`, `web:getWatchVideoBySlugOperation`. Confirm during writing
  3. **MUST-stay-authenticated**: any operation that reads draft/unpublished content (any preview-mode signal) or uses an admin-only Apollo client. **Preview-mode detection is a multi-channel scan, not a single grep:** check (a) GraphQL variables for `publicationState: PREVIEW`-style flags, (b) Apollo client headers/auth config, (c) Next.js `draftMode().isEnabled` reads via `rg "draftMode\(" apps/web/src apps/mobile/src apps/tv/src`, and (d) the existence of `apps/web/src/app/api/preview/route.ts` with its `STRAPI_PREVIEW_SECRET` gate. If no current operation reads `draftMode().isEnabled` (likely today), record explicitly: "Preview infrastructure exists at `apps/web/src/app/api/preview/route.ts`; no current consumer operation branches on it. Any future operation added to that flow MUST be classified MUST-stay-authenticated." This is a finding, not a defect — but the explicit framing prevents Unit 5 from silently widening a future preview path
- For each PUBLIC-eligible-needs-widening row, link to the U4 mapping table where applicable (so Unit 2's planner can see what fields the new admin PUBLIC query needs to support)
- Cross-check `tv:SEMANTIC_SEARCH`'s `searchMode` field specifically — PUBLIC exposure of degraded-backend status is an operational decision admin must replicate or decline (flag, do not decide here)
- Verification pass: run BOTH `rg "graphql\(" apps/web/src apps/mobile/src apps/tv/src` AND ``rg "= gql\`" apps/web/src apps/mobile/src apps/tv/src``, then walk every output line from both commands against the inventory. The second command catches raw Apollo `gql` callsites the first misses (e.g., `apps/web/src/lib/recommendations.ts:27`'s `SCENE_RECOMMENDATIONS`). Record both rg outputs verbatim in the `## Verification Log` section, then record a per-line pass/fail (every line must have exactly one matching inventory entry; the inventory must contain no orphan entries)
- Final assembly review: read the inventory top-to-bottom and confirm (a) Scope & Conventions section explains the operation-key format and field-tagging legend, (b) every per-app section uses consistent subsection structure, (c) the block mapping table cross-references operations correctly, (d) the PUBLIC classification cross-references operations correctly, (e) no "TBD" or "?" tags remain unresolved (any genuine unknown gets a footnote with a follow-up owner)

**Patterns to follow:**

- The reference plan's "Open Questions → Resolved During Planning" structure — explicit tripartite lists with rationale per row are well-tested for downstream agent consumption

**Test scenarios:**

- Covers R6. Happy path: every inventoried operation appears in exactly one of the three PUBLIC-classification buckets
- Covers R6. Happy path: every MUST-stay-authenticated row cites the specific preview-mode signal that justifies the classification (variable name, header, or call-site pattern)
- Covers R6. Edge case: if no consumer operation has a preview-mode signal today, the MUST-stay-authenticated list is empty AND that fact is recorded as a finding ("No consumer operation today reads draft content; if Unit 5 introduces a preview path, it MUST opt out of PUBLIC")
- Covers R7. Happy path: `rg "graphql\(" apps/web/src apps/mobile/src apps/tv/src` output is recorded verbatim in the Verification Log; every line has a matching inventory entry; the inventory has no orphan entries
- Covers R7. Edge case: if a callsite was added to consumer code between U1–U3 writing and U5 running (e.g., parallel branch lands during the inventory window), U5's rg pass catches the new line as un-inventoried — fix is to re-run the relevant U1/U2/U3 step, NOT to silently update the inventory
- Edge case: `tv:SEMANTIC_SEARCH`'s `searchMode` field is flagged as a Unit 2 decision (not silently classified PUBLIC); the rationale is recorded
- Final assembly: spot-check three random operation rows (one per app) against their source files for accuracy after assembly (no copy-paste drift introduced during the merge of U1/U2/U3 sections)

**Verification:**

- `## Verification Log` section contains the full rg output and a per-line pass/fail annotation
- Every operation row has exactly one PUBLIC-classification label
- Inventory file renders as Markdown with no broken table syntax (spot-check in GitHub preview before commit)
- The inventory passes a "fresh agent read" sanity check: a hypothetical Unit 2 planner can pick up the file cold and identify every PUBLIC-eligible-needs-widening row without asking for context

---

## System-Wide Impact

- **Interaction graph:** This plan creates a new `docs/admin-core-migration/` directory plus one Markdown file. No code is modified. Downstream consumers of this artifact: parent plan Units 2, 4, 5, 6, 7 (each unit's planning agent reads the inventory before writing its own plan). No runtime, no CI, no build-graph impact
- **Error propagation:** Not applicable — documentation-only artifact
- **State lifecycle risks:** None (no persistent state, no migration semantics)
- **API surface parity:** The inventory itself becomes the documentation contract for migration; downstream units must NOT silently diverge from it without updating it. Standard "the inventory is now the source of truth" convention applies — but enforced by reviewer hygiene, not tooling
- **Integration coverage:** The R7 verification cross-check (rg vs inventory) is the integration test for this plan. No other test surface
- **Unchanged invariants:** All existing consumer code unchanged. All existing admin schema unchanged. `packages/graphql` unchanged. The only invariant this plan touches is the `docs/admin-core-migration/` directory's existence — it goes from absent to present

---

## Risks & Dependencies

| Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inventory goes stale immediately**: any consumer adds a `graphql(` callsite after this PR merges; downstream Unit 2/5/6 plans build against an outdated inventory and silently miss it                                                                                                                                                                                                                                                                                                                                                                                               | Document the regeneration procedure (re-run the `rg` command, walk the diff, update the affected per-app section) in the inventory's "Scope & Conventions" section. Add a Unit-7 follow-up: if the inventory drifts across more than 2 PRs without re-verification, flag the inventory as stale before any further migration unit kicks off. Do NOT add a CI drift check in this plan — that's tooling work that belongs in Unit 4 or later                                                                                                                                                                                                                                            |
| **Preview-mode detection is heuristic**: U5's "scan call sites for preview signal" pass may miss draft-read patterns. Specifically, `apps/web/src/app/api/preview/route.ts` exists and uses Next.js `draftMode()` (`__prerender_bypass` cookie) gated on `STRAPI_PREVIEW_SECRET` — this is NOT a GraphQL variable or Apollo header, so single-pattern call-site scanning won't catch it. Today no consumer operation reads `draftMode().isEnabled`, but a future operation added to the preview flow could be silently classified PUBLIC-eligible if U5 only scanned GraphQL documents | U5 explicitly examines each operation's full call site PLUS `apps/web/src/app/api/preview/route.ts` PLUS `rg "draftMode\(" apps/web/src apps/mobile/src apps/tv/src` to detect `draftMode().isEnabled` reads. If the multi-channel scan finds no current preview-mode operation, the inventory records explicitly: "Preview infrastructure exists at `apps/web/src/app/api/preview/route.ts`; no current consumer operation branches on `draftMode().isEnabled`. Any future operation added to the preview flow MUST be classified MUST-stay-authenticated regardless of name." Unit 5's web vertical-slice planning will re-verify before any operation is flipped to PUBLIC in admin |
| **Block mapping table over-claims direct parity**: U4's row-by-row mapping says `videoHero` is direct-parity but admin's `videoHero` schema has a different nullability or extra field that breaks the consumer adapter                                                                                                                                                                                                                                                                                                                                                                | Each row's parity status is explicitly per-row and per-field, not per-block-name. The "direct-parity" tag means the admin `t` literal exists with a comparable shape — Unit 4 (parity harness) does the actual response-shape comparison. The inventory's job is to surface candidates, not to certify parity. Flag any genuinely-uncertain row as `?` and let Unit 4 resolve                                                                                                                                                                                                                                                                                                          |
| **Web `WatchBlock` synthetic discriminants accidentally appear in the block mapping table**: a writer mistakes the 6 `kind` literals for Strapi typenames and adds them as "missing in admin"                                                                                                                                                                                                                                                                                                                                                                                          | Key Technical Decisions explicitly documents the synthetic blocks as a separate subsection. U1's test scenarios include a check that the synthetic blocks appear in their own subsection and NOT in the block mapping table. U5's assembly review re-checks this                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Per-PR landing creates merge conflicts on a single Markdown file**: if U1, U2, U3 land as separate PRs they all touch the same file's different sections — git's merge will mostly handle it but headers / formatting can drift                                                                                                                                                                                                                                                                                                                                                      | Default execution: all 5 sub-units land in one PR (single document; cohesive review). U-IDs exist for sequencing clarity, not per-PR splitting. If review-hygiene preference forces a split, U1 lands first (creates the file), then U2 and U3 sequentially (not parallel) to avoid concurrent appends                                                                                                                                                                                                                                                                                                                                                                                 |
| **Discovery of unexpected `graphql(` callsites outside the named files**: Phase 1 sweep found `apps/web/src/lib/{search,demo-search,recommendations}.ts` but a similar undiscovered file might exist in a less-obvious location                                                                                                                                                                                                                                                                                                                                                        | The U1/U2/U3 work lists are rg-driven, not file-list-driven. The rg sweep at the start of each per-app pass IS the file enumeration — anything `graphql(` matches gets inventoried, not just the parent plan's named files. U5's verification rg cross-check is the safety net                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Mobile/TV deliberate divergence not captured**: TV's `LIST_EXPERIENCES` selecting VideoHero and `SEMANTIC_SEARCH` selecting `searchMode` are documented in source comments but a writer might silently treat them as identical                                                                                                                                                                                                                                                                                                                                                       | U3's test scenarios explicitly require capturing both divergences with cross-references between the mobile and TV operation sections. U3's verification spot-check covers `tv:LIST_EXPERIENCES` specifically                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## Documentation / Operational Notes

- The inventory file IS the documentation deliverable; no separate docs PR
- Downstream units' planning agents are expected to read the inventory before writing their plans (Unit 2 picks up "PUBLIC-eligible-needs-widening" rows; Unit 6 picks up the block mapping table). This expectation is recorded in the inventory's opening section
- No rollout, no monitoring, no observability — this is a pure documentation artifact
- Future maintenance: the inventory needs re-verification (re-run rg, update affected sections) before any new migration unit kicks off if more than ~2 consumer PRs have merged since the last re-verification. This convention is documented in the inventory's "Scope & Conventions" section. A formal CI drift check is intentionally NOT in scope (would belong in Unit 4 or later)

---

## Sources & References

- **Origin parent plan:** [docs/plans/2026-04-22-001-feat-admin-core-consumer-migration-plan.md](2026-04-22-001-feat-admin-core-consumer-migration-plan.md) (Unit 1 spec lines 120–154)
- **Reference plan style:** [docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md](2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md) (most recent Unit-of-parent style — glossary, sub-units with stable U-IDs, requirements trace)
- **Related code (read-only):** `apps/web/src/lib/content.ts`, `apps/web/src/lib/fragments/` (17 files), `apps/web/src/lib/{search,demo-search,recommendations}.ts` (note: `recommendations.ts` contains both a gql.tada `graphql()` op AND a raw Apollo `gql` op — `SCENE_RECOMMENDATIONS`), `apps/web/src/app/api/preview/route.ts` (Strapi preview gate, `STRAPI_PREVIEW_SECRET` + `draftMode()`), `apps/mobile/src/lib/queries.ts`, `apps/mobile/src/lib/normalizer.ts`, `apps/tv/src/lib/queries.ts`, `apps/tv/src/lib/normalizer.ts`, `apps/admin/src/domain/blocks.ts`, `apps/admin/src/graphql/queries/{search,hybrid-search,scene-recommendations}.ts`, `apps/admin/src/graphql/types/experience.ts`, `apps/admin/schema.graphql` (post-#902)
- **Related plans (sibling units in flight):** Unit 2 (admin PUBLIC schema readiness — same parent plan); Unit 3 ([dual-client codegen](2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md) — currently in flight on `feat/dual-client-codegen-unit-3` branch)
