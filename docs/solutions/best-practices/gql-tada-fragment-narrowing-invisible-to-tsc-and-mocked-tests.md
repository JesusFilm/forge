---
title: "Narrowing a gql.tada fragment selection is invisible to tsc and mocked tests — pin the printed document"
date: 2026-08-29
category: best-practices
module: apps/web/src/lib/fragments
problem_type: best_practice
component: tooling
root_cause: inadequate_documentation
resolution_type: test_fix
severity: high
applies_when:
  - "Pruning or narrowing fields from a gql.tada query or fragment selection set that has no direct downstream reader"
  - "The pruned field appears at more than one selection point in the same document, so an asymmetric re-add is possible"
  - "The suite over that data layer mocks the GraphQL client at the query call boundary instead of inspecting the document it builds"
tags:
  - gql-tada
  - graphql-fragments
  - testing-discipline
  - mocked-tests
  - excess-property-check
  - regression-pin
  - over-fetching
  - admin-graphql
related_components:
  - apps/web
  - packages/admin-graphql
related:
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md"
  - "docs/solutions/logic-errors/gql-tada-fragment-anchor-cast-drift-same-fragment-multi-query-20260514.md"
  - "docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md"
---

# Narrowing a gql.tada fragment selection is invisible to tsc and mocked tests

## Context

PR #2108 removed the secondary paragraph from the `/watch` home hero overlay, then pruned the two fields that fed it — `description` and `snippet` — out of `apps/web`'s GraphQL selection.

The TypeScript half of that prune is well covered. Delete `WatchHomeCard.description` (`apps/web/src/lib/watch-home.ts:94`) and the compiler walks you to every reader. The GraphQL half is covered by nothing.

Put `snippet` back into `apps/web/src/lib/fragments/watch-home.ts` and admin starts returning it again — for every hero slide and every pooled carousel video, on a statically-rendered route under active LCP work — and `tsc --noEmit` is clean and the whole `apps/web` suite is green. Nothing downstream reads the field, so there is no type error to raise and no rendered output to change. Two independent reviewers surfaced this gap during the PR's review pass and the fix shipped in the same PR (per this session's review run; the PR's public comments record only unapplied residuals, so the headcount is not reconstructable from GitHub alone).

**Measured, on the tree as merged in PR #2108 (this session, re-adding `snippet` to one `locales` block):**

- `pnpm --filter @forge/web typecheck` (`tsc --noEmit`): **clean**.
- `pnpm --filter @forge/web test`: 206 test files, **3,464 tests**. The injection flips **exactly one** test from green to red — the new fragment test at `apps/web/src/lib/fragments/__tests__/watch-home.test.ts:28`.

### What the pruned bytes were worth

Per `docs/plans/2026-08-29-1256-fix-watch-home-hero-description-removal-plan.md:207`: rendering the hero through `WatchHomePage` with a production-shaped fixture measured **21,667 B → 20,903 B** of server-rendered HTML (**−764 B per rendered slide**) and **1,033 B → 480 B** of serialized hero-slide props (**−553 B per slide**, the payload that crosses the RSC boundary). That plan also flags the exact hazard this doc exists to close (line 209): *"The byte comparison is a point-in-time measurement, not a test. A later change could reintroduce payload weight on this path without any suite failing."*

## Guidance: three gates, three different failure modes

Pruning a gql.tada selection is not one job with one gate. It is three:

| Gate | Command | What it is the gate for | What it is blind to |
| --- | --- | --- | --- |
| **Regression** | `tsc --noEmit` | The TS-side prune: type fields, mappers, and *annotated* fixtures | The GraphQL document entirely. Un-annotated fixtures. |
| **Completeness** | `git grep` / ripgrep for the field name | Fixture and mock sites the compiler structurally cannot check | Anything spelled differently; anything outside the grep's path scope |
| **Wire** | a `print()`-ed document assertion in a test | The selection set actually sent to admin | Whether anything *reads* the field (that is gate 1's job) |

Skipping any one of them leaves a live failure mode. The rest of this doc is what each one does and does not do, with the measurements behind the claims.

### Gate 1 — `tsc --noEmit` never sees the GraphQL document

gql.tada types a document from its *text*. Adding a field widens the result type; it never narrows it. So a re-added field is, to the compiler, a strictly more capable result type that nobody happens to destructure. There is no error to emit.

Verified: with `snippet` re-added to the nested `children.child` `locales` block only (`apps/web/src/lib/fragments/watch-home.ts:74-79`), `npx tsc --noEmit` in `apps/web` exits 0.

This is not a gql.tada defect. It is the correct behavior of a supertype. It just means the compiler is structurally the wrong instrument for "does this query over-fetch."

### Gate 2 — TypeScript's excess-property check is narrower than it feels

The prune's *removal* direction does raise type errors — but only at fixture sites where a **fresh object literal** meets a **known target type**. Six fixture sites in `apps/web` carried `description`. Four errored; two were silent. Measured by re-injecting `description` at each site and running `tsc --noEmit`:

| Site | Declaration | tsc? |
| --- | --- | --- |
| `apps/web/src/lib/watch-home-carousel-sequence.test.ts:28` | `function video(id: string): WatchHomeTvCarouselVideoSlide` | **TS2353** |
| `apps/web/src/components/home/__tests__/useWatchHomeTvCarousel.test.ts:21` | `function slide(...): WatchHomeTvCarouselSlide` | **TS2353** |
| `apps/web/src/components/home/__tests__/WatchHomeHero.test.tsx:21-41` | `const fallbackSlide = { … } satisfies WatchHomeHeroSlide` | **TS2353** |
| `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx:186-188` | `function makeCarouselSlide(overrides: Partial<T> = {}): WatchHomeTvCarouselVideoSlide` | **TS2353** |
| `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx:136` | `function makeCard(overrides: Record<string, unknown> = {}) {` — **no return annotation** | silent |
| `apps/web/src/app/[locale]/[htmlLang]/page.test.tsx:186-198` | payload handed to `resolveWatchHomeMock.mockResolvedValue({ … })`, where the mock is a bare `vi.fn()` (`:12`) | silent |

Exact error text for the four that fire:

```
apps/web/src/lib/watch-home-carousel-sequence.test.ts(33,5): error TS2353: Object literal may only
specify known properties, and 'description' does not exist in type 'WatchHomeTvCarouselVideoSlide'.
```

The two silent ones are worth understanding, because both shapes are extremely common in this repo's test files:

1. **`makeCard()` has no return-type annotation.** Its return is inferred from the literal, so the extra key becomes part of the inferred type rather than an excess property. By the time the value reaches `cards: [makeCard(), makeCard({ id: "card-2" })]`, freshness is gone — excess-property checking applies only to fresh literals, never to values that crossed a function boundary. It is also spread at `:163` (`{ ...makeCard(), eyebrow: "Featured" }`), and spread properties are exempt too. Two independent reasons the check cannot fire. The `overrides: Record<string, unknown>` parameter type compounds it: override keys are unchecked as well.
2. **`vi.fn()` with no type argument** returns `Mock<Procedure>`; `mockResolvedValue` accepts anything. The mocked module boundary (`vi.mock("@/lib/watch-home", …)`) means the real `resolveWatchHome` return type never constrains the payload.

Note `satisfies T` **does** trigger the check (row 3) — it is a genuine alternative to a type annotation here, not a weaker one.

**The rule:** after `tsc` goes green on a field removal, `git grep` the field name across the app anyway. `tsc` is the regression gate; grep is the completeness gate. They are not substitutes.

### Gate 3 — a printed-document assertion is the only wire gate

The whole shipped fix, `apps/web/src/lib/fragments/__tests__/watch-home.test.ts` (31 lines):

```ts
import { print } from "graphql"
import { describe, expect, it } from "vitest"

import { watchHomeVideoFragment } from "@/lib/fragments/watch-home"

describe("WatchHomeVideo GraphQL selection", () => {
  it("keeps both locales blocks to the fields the home model actually reads", () => {
    const printed = print(watchHomeVideoFragment)

    // Two locales blocks: the parent video and the nested children.child video.
    // Both must stay narrowed together — a field re-added to only one still
    // ships on the wire.
    const localeBlocks = printed.match(
      /locales\([^)]*\)\s*\{[^}]*\}/g,
    ) as RegExpMatchArray | null

    expect(localeBlocks).not.toBeNull()
    expect(localeBlocks).toHaveLength(2)

    for (const block of localeBlocks ?? []) {
      expect(block).toMatch(/\btitle\b/)
      expect(block).toMatch(/\bimageAlt\b/)
      expect(block).not.toMatch(/\bdescription\b/)
      expect(block).not.toMatch(/\bsnippet\b/)
    }
  })
})
```

Three things are load-bearing and easy to drop:

- **`print()` from `graphql`, not source text.** `adminGraphql()` composes fragments; the printed document is what actually goes on the wire. Reading the template literal instead would miss anything a spread pulls in.
- **`.not.toBeNull()` + `.toHaveLength(2)` are anti-vacuity guards, not sanity checks.** The assertions live inside `for (const block of localeBlocks ?? [])`. If the regex ever stops matching — a formatting change, a renamed argument, one block collapsed into a fragment spread — the loop body runs zero times and *every negative assertion passes vacuously*. The count assertion is what makes that failure loud.
- **Positive assertions (`title`, `imageAlt`) alongside the negative ones.** A test that only asserts absence goes green if the block is emptied entirely.

#### Prior art in this repo

`apps/web/src/lib/fragments/__tests__/watch-video.test.ts` is the only pre-existing example in `apps/web` of asserting a field's **absence** from a printed selection — e.g. `expect(printed).not.toMatch(/\bdubs\s*\{/)` at `:33`, guarding the split shell/copy/dub-detail operations against re-fattening. The one sibling fragment test in the same directory (`watch-experience.test.ts`) walks the AST for *presence* of specific paths; that is a different technique for a different question.

`apps/mobile/src/lib/__tests__/watchHomeQueries.test.ts:34-57` is the closest cross-app analogue — a "lean payload guard" over mobile's `GET_WATCH_HOME_VIDEOS` that pins `not.toMatch(/\bdubs\b/)` and counts the two `locales(...)` selections at `:52-57`. It does not pin the field list inside those blocks, so mobile has gate 3 for the 9.5MB `dubs` trap but not for field-level creep.

### Falsify it by injecting into ONE block only

The same field list appears twice in `watch-home.ts` — the parent video's `locales` (`:25-30`) and the nested `children.child`'s `locales` (`:74-79`). Two copies of one list is the exact shape where a partial re-add happens.

**A symmetric injection is not a sufficient falsification.** Re-add `snippet` to *both* blocks and a test written with a non-global regex, or a lazy `[\s\S]*?` that stops at the first block, still goes red — while remaining blind to a re-add in the second block only. Symmetric injection cannot tell a two-block test apart from a one-block test.

So falsify asymmetrically. Add the field to the **nested child block only**, then run the fragment test:

```
FAIL apps/web/src/lib/fragments/__tests__/watch-home.test.ts
AssertionError: expected 'locales(locale: $locale, languageSlug…' not to match /\bsnippet\b/

Received:
"locales(locale: $locale, languageSlug: $languageSlug) {
        documentId: id
        languageSlug
        title
        snippet
        imageAlt
      }"
 ❯ apps/web/src/lib/fragments/__tests__/watch-home.test.ts:28:25
```

Confirmed in this session. In the same run, `apps/web/src/lib/__tests__/watch-home.test.ts` and `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` — the two suites that consume this fragment's output most directly — both stayed green (30 passing tests), and `tsc --noEmit` exited 0. Across the full 3,464-test suite, that one assertion is the only thing that moves.

## Why This Matters: the model test cannot see it

`apps/web/src/lib/__tests__/watch-home.test.ts` is the large suite over `resolveWatchHome` / `resolveWatchHomePreview`. It mocks the client at the function-call boundary (`:3-4`, `:30-33`):

```ts
const { queryMock, unstableCacheCalls } = vi.hoisted(() => ({ queryMock: vi.fn(), … }))

vi.mock("@/lib/admin-client", () => ({
  default: { query: queryMock },
}))
```

The production call site does pass the document — `query: getWatchHomeVideosOperation` at `apps/web/src/lib/watch-home.ts:872` and `:917` — so `queryMock.mock.calls[0][0].query` is right there. But every assertion in the suite reaches past it to the variables:

```ts
expect(queryMock.mock.calls[0][0].variables.languageSlug).toBe("russian")   // :553
expect(queryMock).toHaveBeenCalledWith(
  expect.objectContaining({
    variables: expect.objectContaining({ locale: "ru", languageSlug: "russian" }),
    fetchPolicy: "no-cache",
  }),
)                                                                          // :518-525
```

`expect.objectContaining` ignores unlisted keys by design, so the document is never inspected. This is not a bug in the suite — a model test *should* mock at that boundary. It just means "which fields do we request" is a question that suite was never built to answer, and adding a selection assertion there would tangle two concerns. A separate fragment-level test is the right shape.

### The DOM companion guard

Byte-level pinning is one half; the removed paragraph is the other. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx:273-288` pins overlay structure rather than text absence:

```ts
const copyBlock = activeTitle?.parentElement
expect(Array.from(copyBlock?.children ?? []).map((el) => el.tagName)).toEqual(["P", "P"])
expect(copyBlock?.textContent).toBe("FeaturedJesus")
const overlayRoot = copyBlock?.parentElement
expect(Array.from(overlayRoot?.children ?? []).map((el) => el.tagName)).toEqual(["DIV", "DIV"])
```

Both levels are needed: the inner one pins eyebrow + title as the copy block's only children, the outer one pins that the copy block's only sibling is the action wrapper — otherwise a paragraph re-added as a sibling of the action slips past. Note what this replaced: the deleted line was `expect(container.textContent).toContain("The story of Jesus")` (`:386` pre-prune), and its naive inverse (`not.toContain(...)`) would pass vacuously against any fixture that no longer supplies the string.

A third guard pins the animation table the paragraph's removal shortened — `:912-929` asserts `delaysFor("watch-home-copy-enter")` equals `["430ms", "500ms", "570ms"]` and the exit counterpart `["0ms", "35ms", "70ms"]`, matching the three-entry `enterDelays` / `exitDelays` at `apps/web/src/components/home/WatchHomeTvCarousel.tsx:459-460`. The delay array length is a second, independent encoding of "there are three overlay items"; letting it drift back to four is how a re-added paragraph gets its animation slot back.

## When to Apply: do NOT propagate this prune to mobile or TV

`apps/mobile/src/lib/queries.ts:492` declares its own `watchHomeVideoFragment`, whose header comment describes it as *"Web's WatchHomeVideo fragment MINUS `variants: dubs`."* It still selects `description` and `snippet` in both `locales` blocks (`:511-512`, `:534-535`), as does TV's at `apps/tv/src/lib/watchHome/homeQueries.ts:25-32` and its nested child block.

That is correct, not drift. Both apps still render the copy: `apps/mobile/src/lib/watchHome/model.ts:212` and `apps/tv/src/lib/watchHome/model.ts:260` both compute `description: locale?.snippet ?? locale?.description ?? null`, and mobile threads it into the carousel overlay (`apps/mobile/src/lib/watchHome/carouselSequence.ts`, at the insert-to-slide and queue-build sites). Only `apps/web` dropped the paragraph.

Two consequences worth carrying forward: the mobile comment's "web's fragment MINUS dubs" framing is now understated (it is also minus `description`/`snippet`), and a future agent doing a repo-wide sweep for these fields will find three live selections where only one was meant to shrink. Check for a reader before pruning a sibling app.

## Examples: recipe for pruning a gql.tada selection

1. **Delete the reader first, in its own commit.** PR #2108 split the visual change from the selection prune into separate commits so the prune could be reverted alone if an unexpected reader turned up. (The branch commits were squashed at merge, so those SHAs no longer resolve on `main`.)
2. **Prune the TS surface and let `tsc --noEmit` walk you through the readers.** Type fields, mapper outputs, annotated fixtures.
3. **`git grep` the field name across the app.** Assume the compiler missed the untyped helpers and the bare `vi.fn()` payloads, because it did. Every hit needs a decision.
4. **Prune the fragment, and add or extend a `print()`-based selection test in the same PR.** Put it in `apps/web/src/lib/fragments/__tests__/`, next to the fragment, not in the model suite.
5. **Enumerate every selection point of the field.** One field list duplicated at N points needs the test to iterate all N, with a count assertion so a zero-match regex cannot pass vacuously.
6. **Falsify asymmetrically.** Inject the field into exactly one selection point, watch the test go red, revert. A symmetric injection does not discriminate a two-block test from a one-block test.
7. **If bytes were the justification, say so in the doc and in the test comment.** The measurement is point-in-time; the test is the only durable artifact.

## Related

- `docs/plans/2026-08-29-1256-fix-watch-home-hero-description-removal-plan.md` — the PR #2108 plan; §"Result" (`:204-209`) holds the byte measurement and explicitly flags that it is not CI-enforced.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META home for "mocked tests prove branch shape, real fixtures prove production contract." This is the same family: a test that mocks at the call boundary cannot see the argument it never asserts on. The asymmetric-injection falsification is this doc's instance of that META's "falsify it once" rule.
- `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md` — the sibling completeness-gate learning: grep the whole blast radius rather than trusting a named feature area.
- `docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md` — the same "grep for the pre-existing shape, not the PR's stated scope" discipline, applied to Prisma visibility predicates.
- `apps/web/src/lib/fragments/__tests__/watch-video.test.ts` — the pre-existing worked example of selection pinning in this repo.
- `apps/mobile/src/lib/__tests__/watchHomeQueries.test.ts:34-57` — the mobile analogue, guarding the 9.5MB `dubs` payload trap.
