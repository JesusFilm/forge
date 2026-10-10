---
title: "Don't code-fix transient artifacts of in-flight data migrations"
date: "2026-05-20"
category: "best-practices"
module: "apps/web"
problem_type: "best_practice"
component: "development_workflow"
severity: "medium"
applies_when:
  - "A user-visible bug is caused by transient data (orphan record, in-flight migration) rather than a code defect"
  - "The owning team is actively migrating the underlying data and has a cleanup plan"
  - "The proposed fix relies on heuristics that detect transient data shapes"
  - "Code review surfaces P0/P1 collateral disproportionate to the fix's benefit"
  - "Removing the workaround later requires watching for an external event most teams forget"
resolution_type: workflow_improvement
root_cause: incomplete_setup
tags:
  - data-migration
  - transient-state
  - revert
  - workaround-cost
  - root-cause-analysis
  - admin-migration
  - nextjs
---

# Don't code-fix transient artifacts of in-flight data migrations

## Context

During the `qa/web-polish-pass` branch work on JesusFilm Forge, `/watch/jesus/` rendered a thin VideoHero-only Experience landing page instead of the expected full Video details page (the "Jesus" feature film — a COLLECTION with 61 child chapters). A stale "thin" Experience at the slug `jesus` was winning the Experience-first routing precedence in `apps/web/src/app/[slug]/[locale]/page.tsx`. The precedence itself is correct — the `/watch/easter` landing depends on it to win over a slug-colliding COLLECTION Video — so the routing logic wasn't the bug.

The fix looked straightforward: detect single-`VideoHeroBlock` Experiences, fall through to the video resolver, emit a `?type=experience` opt-in from Experience search cards, and read `searchParams.type` to bypass the defer when set. ~20 LOC across two files. It landed on the branch and passed visual verification.

A multi-agent code review (`/ce-code-review`) then surfaced the collateral cost: a **P0** (all 11 page-routing tests broken because the `renderPage` helper didn't pass the new `searchParams` Promise — pre-commit hook runs lint-staged but not vitest, so the broken state landed), two **P1 findings** (`await searchParams` defeats Next.js Full Route Cache so `revalidate = 60` becomes inert; `generateMetadata` didn't read the opt-in so OG tags diverged from the rendered page), and a **5-item P2 cluster** (locale redirect strips the query param; `demoResultHref` diverged from `defaultHrefBuilder`; type narrower than Next's `string | string[] | undefined`; magic string `"VideoHeroBlock"` inlined; `__typename` cast widened a discriminated union). The agent applied the fixer-pass corrections and added 5 new tests. All green.

After that substantial effort, the user identified the actual root cause:

> "It is very likely that the reason why there are two different objects, one being an experience and the other being a video object that both share the same slug, is because of an incomplete data migration. Inevitably, in the coming days, the incomplete Jesus experience would likely be removed. Given this, please revert the change that we did to hack-fix the issue with the JESUS film object rendering an incorrect page"

The orphan Experience is a known in-flight artifact of the admin data-layer migration (`feat/web-admin-data-layer-flip`). The data team will remove it within days. The agent ran `git reset --hard 4dcdef5c` and the branch returned to the polish-pass commit only — no routing heuristic, no fixer-pass corrections, no permanent ISR concession. `/watch/jesus/` reverts to the broken thin-hero state for a few days until the data team clears the orphan.

## Guidance

**Before writing a code workaround for a user-visible bug, ask: is the cause transient data or a real code defect?**

If the underlying data is actively being migrated or cleaned up, the cost-benefit calculation inverts. The workaround introduces permanent code surface for a problem that will disappear on its own.

### Decision triggers — stop and ask before coding

Stop and ask "is this a data problem or a code problem?" when you observe any of these:

1. **The owning team is actively migrating the underlying data.** Forge's web-admin migration is mid-flight; admin's Experience content is still being populated (see `docs/solutions/workflow-issues/parity-harness-prod-gate-defects-20260514.md` for the prod-gate defects that produce these orphans).
2. **The fix relies on heuristics that detect transient data shapes.** Thin-hero detection on `__typename === "VideoHeroBlock"` encodes knowledge of a private admin block shape that will drift with schema changes.
3. **Code review surfaces collateral disproportionate to the fix's benefit.** A few-day data-inconsistency window is a different cost class than a P0 test regression + permanent ISR loss.
4. **Removing the workaround later requires watching for an external event.** Most teams forget to revert workarounds after migrations complete. The watchpoint ("remove once admin clears orphan Experiences") is the kind of TODO that lives in code comments for years.
5. **The routing or architectural constraint the fix touches is load-bearing for other features.** The Experience-first precedence is intentional; any heuristic layered on top would interact with future Experience slugs in non-obvious ways.

### Upstream surface, don't patch downstream

When the root cause is admin data, surface it upstream rather than patching downstream. Forge's convention is that Urim doesn't edit `apps/admin` directly even on shared PRs — admin findings get surfaced for handoff. The same principle applies to data: flag the orphan to the data team for cleanup; don't write routing heuristics in `apps/web` to paper over it.

### The right answer when the cause is transient

1. Identify and document the transient artifact (slug collision, orphan record, stale relationship).
2. File or note the cleanup task with the owning team.
3. Communicate the user-visible impact and expected resolution timeline.
4. Revert any code workaround that has already landed.

```bash
# The revert IS the answer — drop the routing commit and all fixer-pass corrections.
git reset --hard <commit-before-workaround>
```

## Why This Matters

**Cost of writing the workaround** — even when the fix itself looks small, the collateral compounds quickly:

- Heuristics that detect transient data shapes (e.g., `__typename === "VideoHeroBlock"` and a length-1 count) drift silently as schemas evolve.
- `await searchParams` in a Next.js 15+ Server Component opts the entire route out of Full Route Cache. `export const revalidate = 60` becomes inert. This is a permanent ISR architectural concession for a temporary data problem. See `docs/solutions/web/nextjs-headers-defeats-route-cache.md` for the same trap with `headers()` — well-documented prior art the reverted fix would have re-created.
- Tests pin behavior to a transient data state. Future maintainers inherit tests that fail if the heuristic is ever removed, even after the migration is long complete.
- Code review finds the collateral you didn't see: in this case 1×P0 + 2×P1 + 5×P2, plus a fixer pass adding 5 new tests. That is a real engineering cost spent defending a workaround that should not exist.

**Cost of NOT removing it later** — the hidden long-term tax:

- The watchpoint ("remove once migration completes") lives in a code comment. Nobody owns it. The migration completes. The workaround stays. Months later a new maintainer encounters the `"VideoHeroBlock"` thin-hero branch and has no idea why it exists.
- The permanent ISR loss means the route is slower in production forever, not just during the migration window.
- The routing branch interacts with future Experience slugs in ways the original author did not consider — because the original author was thinking about a data state that no longer exists.

The asymmetry is stark: the cost of "wait for the migration" is a few days of one slug rendering incorrectly. The cost of the workaround, compounded over the lifetime of the codebase, is higher.

## When to Apply

**Apply this guidance (don't fix in code) when:**

- The root cause is confirmed to be transient data (orphan records, in-flight migrations, stale relationships that will be cleaned up).
- The team responsible for the data has acknowledged the artifact and has a cleanup plan with a near-term timeline.
- The user-visible impact is limited in scope (one slug, one route, one component) and severity is not blocking the core user journey.
- The proposed fix requires heuristics that encode private data shapes — shapes that don't belong in application routing logic.

**Do NOT apply this guidance (write the workaround) when:**

- The migration timeline is uncertain or indefinite. If "it'll be cleaned up" has no owner and no deadline, treat the data state as permanent.
- User impact is severe — blocking the primary user journey, causing data loss, or creating incorrect output users will act on (wrong payment amounts, wrong access control).
- The workaround is genuinely data-shape-agnostic and carries no architectural cost (a `null` guard, not a `__typename` heuristic).
- The fix is a temporary feature flag or env-var opt-in that can be flipped off in one line and carries no test surface.

## Examples

### The Jesus routing episode

**Situation:** `/watch/jesus/` rendered a thin Experience landing instead of the full Video page. Cause: a stale orphan Experience at slug `jesus` won routing precedence. The admin data layer was being actively populated during the web-admin data-layer migration.

**Before — workaround path:**

```tsx
// apps/web/src/app/[slug]/[locale]/page.tsx
// Thin-hero defer: if an Experience has only one VideoHeroBlock, fall
// through to video. Added to handle orphan Experiences from the
// in-flight admin data migration.
// TODO: remove once admin clears stale Experiences.
//       (← the watchpoint nobody will execute)
const isThinHeroOnly =
  blocks.length === 1 && blocks[0]?.__typename === "VideoHeroBlock"

if (blocks.length && (!isThinHeroOnly || wantsExperience)) {
  return <main>{/* render experience */}</main>
}
// fall through to video resolver
```

```tsx
// apps/web/src/components/search/VideoCard.tsx
// Emit ?type=experience so search-card links bypass the thin-hero defer.
const defaultHrefBuilder = (result: SearchResult): Route => {
  const base = `/${result.slug}/en`
  return (
    result.type === "experience" ? `${base}?type=experience` : base
  ) as Route
}
```

Code-review findings against this approach:

| #   | Severity | Issue                                                                                                                                                                                                              |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | P0       | All 11 routing tests crash — `renderPage` helper omits `searchParams`                                                                                                                                              |
| 2   | P1       | `await searchParams` defeats Full Route Cache; `revalidate = 60` inert                                                                                                                                             |
| 3   | P1       | `generateMetadata` doesn't read opt-in; OG title/description diverge from rendered page                                                                                                                            |
| 4-8 | P2       | Locale redirect strips `?type=experience`; `demoResultHref` parallel implementation diverges; `searchParams` type misses `string[]`; magic string `"VideoHeroBlock"`; `__typename` cast widens discriminated union |

Each finding is fixable. Together they constitute substantial collateral for a transient problem.

**After — revert is the answer:**

```bash
# Drop the routing commit and the entire fixer pass.
git reset --hard 4dcdef5c

# Surface the orphan Experience to the data team for cleanup.
# File a note: "slug 'jesus' has a stale Experience that wins routing
# precedence over the Jesus COLLECTION Video. Admin data team to remove."
```

Result: `/watch/jesus/` reverts to the thin-hero state for a few days until the data team clears the orphan Experience. No permanent routing heuristics. No ISR loss. No tests pinning behavior to a transient data shape. When the orphan disappears, the Experience-first precedence misses, the video resolver fires, and the Jesus video page renders correctly — same end state the workaround was reaching for, without the code surface.

### Contrast — when the workaround IS right

The same monorepo has documented cases where a workaround was correctly applied during an in-flight migration:

- **`docs/solutions/database-issues/prisma-video-relation-inverted-back-references-20260514.md`** — Documents a `Video.parents`/`.children` label inversion that's latent during the admin migration. A defensive code-side workaround (`dedupeByDocumentId` + self-ref filter) suppresses the symptom while the schema fix waits for its own branch. The workaround is justified there because (a) removing it has a known trigger (the schema fix lands) and (b) the workaround itself is data-shape-agnostic, not a heuristic on transient data.

The distinguishing factors: a clear data-shape-agnostic defensive guard (null check, dedupe) is fundamentally different from a heuristic that pattern-matches transient data (single-block detection). The first survives the cleanup; the second becomes dead code begging to be removed.

## Related

- `docs/solutions/database-issues/prisma-video-relation-inverted-back-references-20260514.md` — closest sibling: an in-flight migration latent-bug where a workaround WAS justified because it's data-shape-agnostic
- `docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md` — companion: "default to the destination side; empty prod tables are not a hard data/runtime reason to build on the source"
- `docs/solutions/workflow-issues/parity-harness-prod-gate-defects-20260514.md` — upstream context: the prod-gate defects that allow orphan Experiences to exist mid-migration
- `docs/solutions/web/nextjs-headers-defeats-route-cache.md` — the ISR trap the reverted fix would have re-created with `await searchParams`
- `docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md` — defines the Experience-first slug precedence resolver involved in the scenario
