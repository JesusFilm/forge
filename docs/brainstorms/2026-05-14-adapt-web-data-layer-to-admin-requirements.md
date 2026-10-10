---
date: 2026-05-14
topic: adapt-web-data-layer-to-admin
---

# Adapt Web's Data Layer to Admin

## Summary

Rebuild the web app's data layer to read content from admin only. Revert all web-side migration scaffolding and the shared `packages/graphql` dual-client, while leaving admin's production widening untouched. Build the new admin-reading version on a single long-lived branch, with new UI work paused on main, and verify locally against seeded admin fixtures before flipping.

---

## Problem Frame

Over the past two weeks, the web app has been moving from Strapi to admin through a phased migration: a dual-read parity bridge in web, a parity harness in `packages/graphql`, a `FORGE_CONTENT_API` env switch, and a cutover runbook. Smoke-testing against production on 2026-05-14 surfaced three stacked blockers — admin has no Experience content, the harness false-positives on an empty corpus, and a workaround was needed for ESM/CJS interop. None of these are fixable by tightening the migration pipeline.

Only one of those three blockers — the harness false-positive — is migration-shaped. The other two would exist under any framing: admin needs content regardless of how web reaches it, and the ESM/CJS gap lives in admin's module graph. The deeper issue is the ongoing carrying cost of the migration framing. Treating this as a _migration_ carries Strapi-shaped assumptions through every layer of new code (parity translations, dual-source bridges, cutover flags, harness scaffolding) and produces infrastructure the team will have to remove anyway when mobile and TV migrate. The work needs to be re-framed: web is being adapted to admin's schema, full stop. Strapi is not a reference point.

---

## Requirements

**Revert what exists only because of the migration framing**

- R1. Remove all web-side files that exist only because of the migration: `apps/web/src/lib/parity-bridge.ts`, `apps/web/src/lib/content-api-mode.ts`, `apps/web/src/lib/admin-client.ts`, the admin-shape fragment at `apps/web/src/lib/fragments/admin-experience.ts`, and their test files.
- R2. Remove the dual-read path inside `apps/web/src/app/[slug]/page.tsx`. The slug page returns to a single-source read state.
- R3. Remove the parity harness in `packages/graphql/src/parity/` and `packages/graphql/scripts/run-batch-verification.ts`.
- R4. Remove `docs/admin-core-migration/cutover-runbook.md`.
- R5. Remove the `PARITY_BEARER` secret value from Doppler (dev + prd). The admin-side keyring code that referenced `PARITY_BEARER` (in `parity-bearer.ts`, `permissions.ts`, `rate-limit.ts`) becomes a separate admin-cleanup follow-up — outside this rebuild's scope per R8 and R9.
- R6. Discard the untracked workaround at `apps/admin/src/domain/package.json` and the untracked harness-defects writeup.
- R7. Create a new package (e.g., `packages/admin-graphql`) that holds the admin client web reads from. It knows nothing about Strapi. Freeze the existing `packages/graphql` for mobile and TV's continuing Strapi access — leave its Strapi factory and types in place, but strip dead admin-side artifacts (the `adminGraphql()` factory, the admin SDL, `admin-graphql-env.d.ts`) and the parity harness from it. The `admin-schema-drift` CI job (currently keyed to `apps/admin/schema.graphql` and `admin-graphql-env.d.ts` inside `packages/graphql`) relocates to the new package alongside those artifacts. The old package deletes entirely when mobile and TV later rebuild against admin.

**Leave admin's production posture untouched**

- R8. Do not revert admin's PUBLIC widenings (#921). They stay in production exactly as they are.
- R9. Do not revert admin-side `CONSUMER_BEARER` or related admin enablement. Admin's production auth posture stays as it is.

**Rebuild the web data layer against admin**

- R10. Every web page that currently reads Strapi instead reads admin. The surface area includes — at minimum — slug Experience pages, the homepage, video pages, search, recommendations, and reference data (languages, countries, keywords). The exact list is enumerated during planning.
- R11. The new code uses no migration vocabulary anywhere — no "dual", "parity", "canary", "cutover", "consumer-migration", `FORGE_CONTENT_API`, or equivalent. Names describe what code does today, not how it got there.
- R12. Types and fragments mirror admin's GraphQL schema directly. No translation layer to a Strapi-shaped intermediate.
- R13. The rebuild ships on a single long-lived branch. No per-route incremental cutover. When the branch merges, every web page that reads content flips to admin at once.

**Branch lifecycle and local development**

- R14. New UI feature work pauses on `main` while the rebuild branch is live. Critical fixes still ship.
- R15. Local development uses fixture content seeded into local admin's Postgres. Every developer can render every web page locally from those fixtures.
- R16. Verification before the rebuild branch merges is local — visual and functional smoke against seeded fixtures, plus type-system coverage. No new verification harness, no parity comparison, no canary.

**Preconditions before forking the rebuild branch**

- R17. Audit every web data fetch against admin's current PUBLIC widening surface. Any gap where a web query needs a field or operation that is not yet PUBLIC becomes an admin-side widening ticket that ships before the rebuild branch forks.
- R18. Grep `apps/mobile` and `apps/tv` for imports of `adminGraphql()`, the admin SDL, `admin-graphql-env.d.ts`, or anything else in the admin half of `packages/graphql` before stripping those artifacts. Mobile and TV are asserted to consume only the Strapi factory; the audit confirms it.

**Security posture for the new admin-only package**

- R19. `CONSUMER_BEARER` lives in env vars (Railway service settings + Doppler `forge-web` project), never committed to source. Rotation procedure: add the replacement key to admin's `CONSUMER_BEARER` CSV, update web's env var, then remove the old key from admin's CSV.
- R20. The new package validates and bounds user-supplied query inputs (slug length, locale format matching BCP-47, search string length) before forwarding them as GraphQL variables. Treat web's URL surface as untrusted input even though the downstream endpoint is admin's own GraphQL.

---

## Success Criteria

- After the rebuild branch merges and admin has production content, every web page that previously rendered from Strapi renders the equivalent content from admin, in the same locations, with no user-visible regression.
- No migration vocabulary appears anywhere in the new web code, in `packages/graphql`, or in adjacent docs that came out of this work.
- A developer joining the team after the rebuild lands can read the web app's data layer without needing to know Strapi ever existed.
- `apps/web` builds, runs, and tests without `apps/cms` (Strapi) running. There is no shared code path between them.

---

## Scope Boundaries

- How content reaches production admin (sync from Strapi, manual re-entry, one-shot import) is owned outside this brainstorm. The rebuild is not blocked on the answer; the production flip is.
- Mobile and TV rebuilds are not in scope. They inherit admin's widening surface and follow their own brainstorms.
- Strapi decommission (deleting `apps/cms`, removing its Railway service, turning off the database) happens after web flips and is not part of this work.
- Any new verification harness, parity comparison, canary infrastructure, or migration scaffolding of any kind is explicitly excluded.
- Admin-side reverts of any kind are excluded. Admin's production posture stays exactly as it is today.
- Unrelated UI work that landed on main in parallel (#920 Bible Quotes, #913 carousel polish, #923 video page polish, #936 language switcher) is not part of the revert. Only commits that exist because of the migration framing are reverted.

---

## Key Decisions

- **Frame the work as "adapt web to admin," not as a migration.** Migration framing carries Strapi assumptions into every layer of new code and produces scaffolding the team has to remove later. A clean-slate frame avoids both costs.
- **Do-nothing baseline considered and rejected.** A cheaper path exists: fix the two real harness defects (empty-corpus false-positive, ESM/CJS workaround), seed content into prod admin, then flip the existing `FORGE_CONTENT_API` switch — days of work, not weeks. Rejected because the migration-shaped infrastructure (parity bridge, dual-read, cutover runbook) still has to come out later when mobile and TV migrate. Paying carrying cost now or later is a choice about _when_, not _whether_. Doing it now resets the mental model for everything that follows.
- **Hard revert web-side and shared-client migration code; leave admin's widening live in production.** The widening code itself is not migration-shaped — it is just "admin is readable by anonymous callers." Reverting it would re-lock production doors with operational risk to current and future consumers.
- **Whole web at once on a long-lived branch.** Per-route incremental cutover would require either parity scaffolding (rejected) or pages coexisting in mixed states (rejected). A single branch with a single merge is the cleanest path under the no-scaffolding constraint.
- **Freeze new UI work on main during the rebuild.** Avoids merge cost between rebuild branch and main. Trade-off accepted: feature shipping pauses for the duration.
- **Seed admin locally with fixtures for development and verification.** Solves both the local-dev gating problem and provides a reproducible verification baseline without building a new harness.
- **Web builds against a brand-new admin-only package; freeze the existing `packages/graphql` for mobile/TV.** Keeps the new web code free of any Strapi references, avoids touching mobile/TV today, and gives a clean deletion target later — the old package goes away entirely when mobile and TV finish their own rebuilds.

---

## Dependencies / Assumptions

- Admin's GraphQL schema is stable enough during the rebuild that codegen does not shift under the branch. Codegen runs against the committed admin SDL. (The PUBLIC widening coverage question is now an explicit pre-fork audit step — see R17.)
- The team accepts no feature shipping from web during the rebuild window. Critical fixes are the only exception.
- Forge has no staging environment. Verification happens locally, then directly in production after the merge.
- Fixture content for local admin is reproducible — checked into the repo or generated by a script — so every developer's environment matches.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R10][Technical] Enumerate every web data fetch that touches Strapi today — full list, not "at minimum." Start from `apps/web/src/lib/content.ts` and adjacent files and produce a comprehensive map during planning.
- [Affects R15][Technical] Cheapest way to seed admin locally with fixtures — SQL dump checked into the repo, a TypeScript script calling admin mutations, manual editor authoring with documented steps, or something else. Plan-time decision.
- [Affects R11][Technical] Internal shape of the renamed/restructured admin client — single factory function name, fragment organization, SDL filename, environment variable names. Names matter, and the rebuild is the right time to choose them.
- [Affects R13][Technical] Branch strategy specifics — does the rebuild branch fork off main today and never merge back from main, or rebase periodically against critical fixes that ship?
- [Affects R10][Technical] Whether `apps/web/src/lib/search.ts` and `apps/web/src/lib/recommendations.ts` are already admin-coupled (they may not need full rebuild). Verify current state during planning.
- [Affects R16][Needs research] Whether purely-local fixture verification is enough confidence to merge a whole-web rewrite, or whether a low-tech pre-merge smoke gate is needed (e.g., an admin-dev URL with seeded content for click-through). Open question because forge has no staging.

---

## Deferred / Open Questions

### From 2026-05-14 review

- **Content path into admin has no named owner or timeline** — Scope Boundaries (P1, product-lens, adversarial, confidence 100)

  Success criteria depend on admin having production content, but no owner, trigger, or candidate mechanism is named. The merge of a multi-week rebuild branch becomes a permanent live-deferred state — code shipped but unflippable — until someone else solves the content problem. Given the team has just been blocked by exactly this gap on 2026-05-14, declaring it out of scope without naming who decides or when is the highest-impact known unknown in the plan. At minimum the brainstorm should commit to resolving it in parallel with the rebuild rather than after.

  <!-- dedup-key: section="scope boundaries" title="content path into admin has no named owner or timeline" evidence="How content reaches production admin (sync from Strapi, manual re-entry, one-shot import) is owned outside thi" -->

- **Verification approach concentrates all risk on one merge** — R13, R16 (P1, adversarial, confidence 75)

  Whole-web cutover + no staging + no harness + local-only verification + frozen main concentrates all risk on a single merge moment. If post-merge prod reveals a class-of-page failure (a fragment shape that fixture seeding didn't catch, an admin field that behaves differently in prod, a code path no fixture exercised), there is no incremental rollback unit — the rebuild branch is the rollback unit. Treating "no scaffolding" as an absolute may be inheriting an emotional reaction to the prior failure rather than a reasoned constraint. A single low-tech pre-merge smoke gate (admin-dev URL with seeded content) is cheaper than discovering a class-of-failure in prod with no path back.

  <!-- dedup-key: section="r13 r16" title="verification approach concentrates all risk on one merge" evidence="The rebuild ships on a single long-lived branch. No per-route incremental cutover. When the branch merges, every" -->

- **R7 proposes a new package whose content already exists in packages/graphql** — R7 (P1, scope-guardian, confidence 75)

  The `adminGraphql()` factory, the admin block fragments, `admin-graphql-env.d.ts`, and the admin SDL already live in `packages/graphql`. The proposed new package replicates this content into a new monorepo package with its own `package.json`, Turbo pipeline entry, and workspace wiring — adding infrastructure overhead without a new capability. The stated goal (web reads admin; mobile/TV keep reading Strapi) is equally achievable by keeping `packages/graphql` as-is and pointing web at the already-present `adminGraphql()` export while mobile/TV continue using `graphql()`. The "clean separation" argument depends entirely on a future deletion event when mobile/TV rebuild.

  <!-- dedup-key: section="r7" title="r7 proposes a new package whose content already exists in packagesgraphql" evidence="R7. Create a new package (e.g., packages/admin-graphql) that holds the admin client web reads from. It knows" -->

- **Frozen-main with critical fixes still produces branch drift** — R14 (P1, product-lens, confidence 75)

  The plan can ship as written and still fail in the most likely way: long-lived branches against an actively-developed app diverge. Even with main "frozen for new UI," critical fixes will ship, and any of them touching the data layer, shared components, or types create rebase friction. The doc treats the freeze as binary ("pauses" / "critical fixes still ship") without examining the realistic case where 2-3 critical fixes land per week and rebase cost compounds. The inversion question — "what scenario produces a stale, un-mergeable branch?" — is not addressed, and the success criteria don't include a time-budget for the rebuild window.

  <!-- dedup-key: section="r14" title="frozenmain with critical fixes still produces branch drift" evidence="New UI feature work pauses on main while the rebuild branch is live. Critical fixes still ship." -->

- **Rate-limit dead branch leaves anonymous bucket holding web SSR** — R5 (P1, security-lens, confidence 75)

  After R5 removes `PARITY_BEARER`, the `identifyForRateLimit` function in `apps/admin/src/graphql/plugins/rate-limit.ts` retains a now-unreachable `role === 'PARITY_BEARER'` branch. Any web SSR request that does not mint a `CONSUMER_BEARER` principal (misconfigured env var in prod, fallback path, cold-start race) falls through to the `public:<cf-connecting-ip>` bucket. Under CGNAT or mobile-carrier NAT, dozens of real users share one IP and all hit the same 30-query/min anonymous ceiling. A single SSR fanout from a popular page can exhaust that bucket for all co-NATed users. Out of scope for this rebuild per R8/R9, but tracked here as a follow-up admin-cleanup ticket.

  <!-- dedup-key: section="r5" title="ratelimit dead branch leaves anonymous bucket holding web ssr" evidence="R5. Remove PARITY_BEARER from admin's auth keyring and from Doppler (dev + prd)." -->

- **Seeded fixtures may not predict prod behavior for whole-app rewrite** — R15, R16 (P2, adversarial, confidence 75)

  Fixture content authored by the team will systematically be shaped to what the new code expects — confirmation bias is structural, not accidental. Real production content has edge cases (truncated translations, missing optional fields, legacy entries with unusual shapes, large list responses, pagination boundaries) that no team-authored fixture catalogues exhaustively. The doc treats fixtures and prod as equivalent verification surfaces; they aren't. Consider committing to derive at least one fixture set from a snapshot of real content rather than hand-authored.

  <!-- dedup-key: section="r15 r16" title="seeded fixtures may not predict prod behavior for wholeapp rewrite" evidence="Local development uses fixture content seeded into local admin's Postgres. Every developer can render every web" -->

- **Freeze duration unbounded with no re-evaluation trigger** — R14 (P2, adversarial, confidence 75)

  The brainstorm never names how long "the duration" is, who agreed to the freeze, or what happens if a near-critical (but not critical-fix) request comes in week 2. Long-lived branches with parallel main fixes accumulate exactly the merge cost the freeze was meant to avoid. At minimum estimate the duration and name who owns the freeze decision; ideally name a calendar trigger that forces re-evaluation if the branch outlives the estimate.

  <!-- dedup-key: section="r14" title="freeze duration unbounded with no reevaluation trigger" evidence="New UI feature work pauses on main while the rebuild branch is live. Critical fixes still ship." -->
