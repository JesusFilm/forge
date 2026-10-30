---
title: "A defect that is correct except for speed clears every gate — back the seam with a whole-source allowlist guard"
date: 2026-09-12
category: best-practices
module: apps/web
problem_type: best_practice
component: testing_framework
root_cause: missing_tooling
resolution_type: tooling_addition
severity: high
applies_when:
  - A defect class differs from correct code only on a non-functional axis (latency, element shape, render boundary) so no correctness gate can see it
  - A framework lint rule nominally covers the class but fails open on computed values
  - Converting one surface to a required construct and needing the unconverted siblings to stay accounted for
  - Adding any guard whose scope is "every file" rather than "the files with a test"
  - Reviewing a diff that adds an eslint `ignores` entry or any other uncounted exemption list
tags:
  - testing
  - guard-test
  - whole-source-scan
  - allowlist
  - next-link
  - performance
  - falsification
  - apps-web
related:
  - "docs/solutions/best-practices/next-link-props-unobservable-three-vacuous-test-traps.md"
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/best-practices/order-sensitive-registry-config-structural-enforcement.md"
  - "docs/solutions/best-practices/nextjs-hmr-reload-breaks-stateful-browser-verification.md"
---

# A defect that is correct except for speed clears every gate

A raw `<a href>` to an in-app path is **correct in every way a gate can
measure**. It type-checks, it renders the right URL, an `href` assertion
passes, `next build` emits it, and a user who clicks it lands on the right
page. It is only slow. Every automated gate the repo owns measures
correctness, so all of them were green while the defect was live on
production.

The durable answer is not a better unit test — it is a gate whose **scope is
the file set rather than the test set**: a whole-source scan with a
counted, reasoned allowlist and a companion test that fails when an
allowlist entry outlives its debt.

## Context

[PR #2244](https://github.com/JesusFilm/forge/pull/2244) (merged 2026-09-10)
converted the Watch video cards from a raw `<a>` to `next/link`
(`apps/web/src/components/sections/MediaCollection.tsx:769-785`). Measured on
production, same destination, pointer already over the card so prefetch was
armed: **2,284 ms click-to-paint before, 56 ms after** (1,359 ms with a cold
prefetch). Only ~15 KB crossed the wire in the slow case — the cost was the
browser tearing down the document and re-executing ~3 MB of already-cached
JavaScript.

Before the conversion, with the defect live:

| Gate                                                | Result                             |
| --------------------------------------------------- | ---------------------------------- |
| `tsc --noEmit`                                      | green — a raw anchor is well-typed |
| ESLint (incl. `eslint-config-next/core-web-vitals`) | green                              |
| `next build`                                        | green                              |
| ~3,950 unit tests                                   | green                              |

The ESLint line is the one worth dwelling on, because the framework ships a
rule for exactly this defect and it was **already enabled at `error`**:

```
$ node -e "…require('eslint-config-next/core-web-vitals')…"
next              @next/next/no-html-link-for-pages "warn"
next/core-web-vitals  @next/next/no-html-link-for-pages "error"
```

It is inert here by construction. Reading the shipped rule
(`node_modules/.pnpm/@next+eslint-plugin-next@16.2.2/node_modules/@next/eslint-plugin-next/dist/rules/no-html-link-for-pages.js`):

```js
const href = node.attributes.find((attr) => attr.name.name === "href")
if (!href || (href.value && href.value.type !== "Literal")) {
  return // <- a computed href={...} is skipped entirely
}
```

Every Watch card href is computed. The rule **fails open on the exact shape
the real code uses**, then matches only string literals against a route regex
derived from the app directory. A rule enabled at `error` and a rule that
does not exist are indistinguishable from the outside; the only way to know
which you have is to read it or falsify it.

That is the generalisable trap. "We have a lint rule for that" is a claim
about a rule's _name_, not its _predicate_.

## Guidance

When a defect class is invisible to every gate you own, add a test whose
subject is the source tree. Six parts, each load-bearing.

The shipped instance is
`apps/web/src/__tests__/no-raw-internal-navigation-anchors.test.ts` (206
lines, runs in 17 ms). It is committed on `t3code/fix-link-click-delay` and
pending a follow-up PR — PR #2244 shipped the conversion, not the guard.

### 1. Scope the scan to the file set, not the test set

```ts
// :104-118 — every non-test .tsx under apps/web/src
function collectComponentFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue
      collectComponentFiles(full, out)
      continue
    }
    if (!entry.name.endsWith(".tsx")) continue
    if (entry.name.includes(".test.") || entry.name.includes(".stories."))
      continue
    out.push(relativePath(APP_ROOT, full))
  }
  return out
}
```

This is the whole point. A per-component assertion protects the component
someone already converted **and wrote a test for**. A file-set scan protects
the 168 non-test `.tsx` files in `apps/web/src` including the ones that do not
exist yet.

### 2. Classify by an enumerated list of _shapes that are not the defect_, and fail closed on everything else

```ts
// :86-99
function isNonNavigating(attrs: string): boolean {
  if (/\btarget=/.test(attrs)) return true // leaves the app by definition
  if (/\bdownload\b/.test(attrs)) return true // a file transfer, not a route
  const href = literalHref(attrs)
  if (href == null) return false // computed — cannot prove it is safe
  if (/^(https?:|mailto:|tel:)/i.test(href)) return true // another origin
  if (href.startsWith("#")) return true // same document
  return false
}
```

Note the inversion against the ESLint rule: a computed href is **a finding**,
not a skip. The scanner cannot prove a computed value is safe, so it demands
that a human write down why. That single line is the difference between a
gate that would have caught PR #2244's defect and one that did not.

Enumerate the exemptions as _shapes_ and comment each with why it is not the
defect. An exemption whose justification is not written down becomes a hole
nobody can audit.

### 3. Allowlist by file with a `count` and a prose `reason` — a debt ledger, not a blessing

```ts
// :41-72
const KNOWN_RAW_NAVIGATION_ANCHORS: Record<
  string,
  { count: number; reason: string }
> = {
  "components/home/WatchHomeFooter.tsx": {
    count: 2,
    reason:
      "Not in-app navigation. Both hrefs are computed but every value is an absolute https://www.jesusfilm.org/... URL …. Listed only because the guard cannot prove a computed href is absolute.",
  },
  "components/sections/MediaCollection.tsx": {
    count: 1,
    reason:
      "Rail CTA. Its destination is admin-authored, so converting it needs the destination classifier applied and an external-vs-internal split …",
  },
  // CTASection, PromoBanner, VideoHero, Text — 1 each
}
```

The `count` is what makes the entry a ledger rather than a blanket pardon: a
**new** raw anchor added to an already-listed file still fails. Without it,
one legitimate exemption permanently disarms the guard for that whole file —
which is precisely the failure mode of the repo's existing
`no-restricted-imports` guardrail at `apps/web/eslint.config.mjs:24-41`,
whose three-file `ignores:` list has no counts and therefore cannot tell a
grandfathered `video.js` import from a new one.

The `reason` is what makes the entry reviewable. "What has to be true for this
line to be deleted" is the thing that decays, and prose is the only place to
put it.

### 4. A second test that fails when an entry outlives its debt

```ts
// :190-205
it("has no stale allowlist entry", () => {
  const stale = Object.entries(KNOWN_RAW_NAVIGATION_ANCHORS)
    .filter(([file, { count }]) => (counts.get(file) ?? 0) < count)
    .map(
      ([file, { count }]) =>
        `${file} — allowlisted ${count}, found ${counts.get(file) ?? 0}. Lower the count or delete the entry.`,
    )
  expect(stale).toEqual([])
})
```

Ratchets are silently reversible in one direction. Convert a listed file to
`next/link`, forget to delete its entry, and the allowlist starts permitting a
future regression in a file that had already paid off its debt — with the
primary test green, because `found <= allowed` is its passing condition. The
stale check is not optional polish; it is the half that keeps the ratchet from
running backwards.

### 5. Put the remediation in the failure message

```ts
// :178-182
;`\nRaw <a href> to an in-app path re-executes the whole JS bundle on click.\n` +
  `Use next/link instead (pass a base-path-RELATIVE href — Link adds /watch itself).\n\n` +
  unexpected.join("\n\n")
```

The reader of this failure is someone who has never heard of the defect and
whose code _works_. A bare `expected [1] to equal []` invites the wrong fix —
adding an allowlist entry. Name the cost, name the construct, and name the one
gotcha that trips the correct fix (here: hand-prefixing the base path renders
`/watch/watch/...`).

### 6. Falsify three ways before believing it

A guard that has never been red is a guard you have not tested. Three
sabotages, one per mechanism:

1. **Revert a converted call site** — proves it catches regressions.
2. **Add a raw anchor to an unlisted file** — proves it catches new debt.
3. **Convert an allowlisted file without removing its entry** — proves the
   stale check fires.

Run 2 catches a case run 1 cannot, because a ratchet's two failure modes are
"the fixed thing broke" and "a new thing appeared." Run 3 catches neither.

## Why This Matters

The trigger for this pattern is a defect class where **the difference between
right and wrong lies on an axis no gate measures**:

| Axis         | Example                                               | Why gates are blind                  |
| ------------ | ----------------------------------------------------- | ------------------------------------ |
| **Latency**  | raw `<a>` instead of `next/link`; an unbatched loop   | both produce the correct output      |
| **Shape**    | a `<div onClick>` where a `<button>` belongs          | both render and both fire            |
| **Boundary** | a `"use client"` on a component that should be server | both work; one ships more JS         |
| **Sourcing** | an env read at a call site instead of the shared seam | both resolve to the same value today |

Each gate's coverage is defined by its own predicate, not by your intent:

- **tsc** covers types. A slow correct value has the same type as a fast one.
- **ESLint** covers AST patterns it was taught — and, as shown above, often
  fails open on the dynamic shape real code uses.
- **the build** covers compilability.
- **unit tests** cover the components someone chose to write a test for, and
  a mocked `next/link` renders a plain `<a>`, so even those tests cannot
  discriminate (see the sibling doc below).

A whole-source scan is the only gate whose coverage is _the file set_. That is
the property being bought, and it is why the pattern survives refactors that
move the code around: nothing about the guard is keyed on a file path except
the debt ledger, which is designed to shrink.

The cost of not having it is not one bug. PR #2244's 2,284 ms was on the
primary interaction of `/watch`, and nothing prevented the next card, rail, or
tile from being written the same way — the pattern was in the codebase as
prior art, so every new surface copied it.

**Prior art in this repo, and what is new.** The whole-source source-text
backstop already appears once, in feat-283's lane-admission guard
(`mocked-shape-vs-real-contract-discipline-20260506.md:139`): `index.ts` must
contain **no** `getServiceKeys`/`getEnabled` token at all. That shape works
when the correct count is zero and forever will be. This pattern is its
counterpart for the far more common case where the correct count is **not yet
zero**: a counted, reasoned ledger plus a staleness check, so the guard can be
adopted on day one against a codebase that still violates it, and tightens
itself as the debt is paid.

## When to Apply

- **A defect class whose only symptom is non-functional.** Ask which gate
  goes red. If the honest answer is "none, it just works," you need a scan.
- **Before trusting any framework lint rule by name.** Read its predicate, or
  falsify it against the real shape in your codebase. `no-html-link-for-pages`
  at `error` caught nothing here.
- **Immediately after a conversion PR.** The map of what did _and did not_
  convert is only fresh once. Every file left behind becomes a ledger entry
  with a real reason; a month later the reasons are reconstructed guesses.
  (Same principle as the removal-recipe rule for phase-scoped scaffolding —
  write the follow-up while the map is fresh.)
- **Any time you reach for an eslint `ignores` entry.** An uncounted
  exemption list disarms the rule for the whole file. If you cannot add a
  count there, the guard belongs in a test where you can.
- **When the class recurs across apps.** Running this exact classifier across
  the monorepo today finds 2 findings in 2 files in `apps/admin/src` and 4 in
  2 files in `apps/chat/src` — the pattern is portable, and those are the next
  two places to install it.

Do **not** reach for it when a type or an enabled-and-verified lint rule can
express the invariant. A source-text scan is a regex over code: cheaper than
an AST rule to write, weaker to evade, and it needs the falsification
discipline above to stay honest.

## Examples

### Falsification 2, run against the current tree

Adding one raw anchor to `CTASection.tsx` — a file that already carries a
`count: 1` entry:

```
Raw <a href> to an in-app path re-executes the whole JS bundle on click.
Use next/link instead (pass a base-path-RELATIVE href — Link adds /watch itself).

components/sections/CTASection.tsx — 2 raw navigation anchors, only 1 accounted for.
      Known debt: Authored buttonLink; same conversion as the MediaCollection CTA.
      line 17: <a href="/jesus.html">
      line 55: <a href={buttonLink} rel="noopener noreferrer" className={buttonClass}>
: expected [ Array(1) ] to deeply equal []

 ✓ in-app navigation goes through next/link > has no stale allowlist entry 4ms
```

Both halves of the design show up in that output: the count did its job (an
allowlisted file still failed), and the message names both the debt that _was_
accounted for and the fix.

### The regex has to tolerate the real formatting

```ts
// :75
const ANCHOR_TAG = /<a\s([^>]*?)\/?>/gs
```

Every anchor in `apps/web` is multi-line JSX — `grep -c '<a '` returns **0**
for all six allowlisted files. A naive single-line pattern yields a guard that
passes on an empty finding set, which reads exactly like a guard that passes
because the code is clean. When a scan reports zero, confirm that is because
it found nothing rather than because it matched nothing: falsification 2 is
the cheap way to tell the difference.

## Related

- [next-link-props-unobservable-three-vacuous-test-traps.md](next-link-props-unobservable-three-vacuous-test-traps.md)
  — **the direct complement, same incident.** Its Trap 3 covers the
  component-suite half: a mocked `next/link` renders a plain `<a>`, so the
  fix is a `data-prefetch` marker asserted positionally. That protects a
  component that has a suite. This doc protects the file set. Division of
  labour: marker pins for the branches you deliberately mixed, the scan for
  everything nobody has looked at. Neither subsumes the other — the scan
  cannot tell a `Link` with `prefetch={false}` from one without, and the
  marker pin cannot see a file with no test.
- [mocked-shape-vs-real-contract-discipline-20260506.md](mocked-shape-vs-real-contract-discipline-20260506.md)
  — line 139 holds the feat-283 whole-source seam-token backstop, the
  zero-count ancestor of this ledger. Also the home of the "which guard goes
  red if this is reverted" question this pattern answers structurally.
- [order-sensitive-registry-config-structural-enforcement.md](order-sensitive-registry-config-structural-enforcement.md)
  — the same "enforce structurally, never by comment" conclusion reached from
  an ordering invariant rather than a latency one.
- [nextjs-hmr-reload-breaks-stateful-browser-verification.md](nextjs-hmr-reload-breaks-stateful-browser-verification.md)
  — the browser-side companion: the 2,284 ms / 56 ms numbers here are
  production measurements, and prefetch is hard-disabled in `next dev`, so a
  dev-server session could not have produced them.
- [PR #2244](https://github.com/JesusFilm/forge/pull/2244) — the conversion,
  merged 2026-09-10. The squash rewrote the branch SHAs, so cite the PR.
- Guard: `apps/web/src/__tests__/no-raw-internal-navigation-anchors.test.ts` —
  committed on `t3code/fix-link-click-delay`, not yet merged.
- Plan: `docs/plans/2026-09-09-1733-fix-watch-client-side-navigation-plan.md`
