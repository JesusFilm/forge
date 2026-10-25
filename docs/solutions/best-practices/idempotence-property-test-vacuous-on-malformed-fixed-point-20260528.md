---
title: "Idempotence property tests pass vacuously on malformed fixed-point inputs — assert contract invariants on output shape, not transform reflexivity"
date: 2026-05-28
problem_type: best_practice
component: url_canonicalizer
root_cause: inadequate_test_property
resolution_type: workflow_improvement
severity: medium
module: apps/web/src/lib/url-canonicalize.ts
tags:
  - testing
  - property-testing
  - canonicalizer
  - contract-invariants
  - fixed-point
  - state-machine
  - watch-url-restructure
  - meta-pattern
  - best-practice
related:
  - "docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md"
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md"
  - "docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md"
  - "docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md"
---

# Idempotence property tests pass vacuously on malformed fixed-point inputs

A meta-pattern that names a recurring trap when designing rule-chain canonicalizers, normalizers, and any deterministic state machine guarded by an idempotence (`f(f(x)) === f(x)`) property test.

## Problem

In a multi-rule canonicalizer, the load-bearing safety net is often a property test asserting that re-applying the function reaches a fixed point: `canonicalize(canonicalize(x).pathname) === { kind: "canonical" }`. The test sweeps a fixture set of adversarial inputs.

If a malformed input is its OWN fixed point — none of the rules' preconditions match it, so the function returns "already canonical" — the property holds vacuously. The function did nothing; the second invocation also does nothing; reflexivity satisfied. The contract has been silently violated.

## Concrete instance (PR #1049, apps/web watch URL restructure)

The `/watch` URL canonicalizer had six rules with an idempotence property test asserting fixed-point convergence for the §5 production matrix + alias-table keys.

Production contract for the three-segment series-episode shape: `/{series}.html/{episode}/{lang}.html`. **The episode segment MUST be bare.**

Malformed input: `/series.html/ep.html/lang.html` (all three `.html`-suffixed).

- **Rule 3** (legacy 4-segment-shape rewrite) had precondition `!hasHtmlSuffix(segs[0])` → didn't fire on this input.
- **Rule 4** (per-segment `.html` append) only checked segs[0] and segs[2] for missing `.html` → didn't fire (both already have it).
- Result: canonicalize returned `{ kind: "canonical" }`. Contract silently violated.

The idempotence property held VACUOUSLY: `canonicalize(canonical) === canonical`. The malformed shape was its own fixed point. The property test passed while the contract was wrong.

## Root cause

`f(f(x)) === f(x)` is satisfied by the identity function on ANY input — including malformed inputs that no rule recognizes. Idempotence proves **convergence of the transform**; it says nothing about whether the converged point is a **CONTRACT-VALID** canonical form.

The trap is structurally identical to the mocked-shape-vs-real-contract discipline ([see meta home](docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)): self-referential properties prove BRANCH SHAPE; output-invariant properties prove PRODUCTION CONTRACT. Both are required; neither substitutes for the other.

## The fix

Added Rule 4.5 to the canonicalizer plus a contract property test asserting output shape.

**`apps/web/src/lib/url-canonicalize.ts`** — Rule 4.5 strips `.html` from the episode segment whenever a 3-segment shape carries it:

```ts
// Rule 4.5: enforce 3-segment episode-bare contract. In the canonical
// /{series}.html/{episode}/{lang}.html shape the middle segment must be
// bare. Strip .html from segment 1 if present so the malformed shape
// /series.html/ep.html/lang.html redirects to the canonical form.
{
  const segs = path.split("/").filter(Boolean)
  if (segs.length === 3 && hasHtmlSuffix(segs[1])) {
    const next = [segs[0], stripHtmlSuffix(segs[1]), segs[2]]
    const candidate = `/${next.join("/")}`
    if (candidate !== path) {
      path = candidate
      onlyTrailingSlashChanged = false
    }
  }
}
```

**`apps/web/src/lib/url-canonicalize.test.ts`** — new contract property test that inspects the OUTPUT SHAPE (whether `kind: "redirect"` or `kind: "canonical"`), not transform reflexivity:

```ts
it("property: every 3-seg canonical output has bare episode segment", () => {
  const inputs = [
    "/lumo-the-gospel-of-john.html/wedding-in-cana.html/english.html",
    "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    "/jesus.html/the-beginning/english.html",
    "/jesus.html/the-beginning.html/russian.html",
    "/jesus/the-beginning/english",
  ]
  for (const raw of inputs) {
    const result = canonical({ rawPathname: raw })
    const final = result.kind === "redirect" ? result.pathname : raw
    const segs = final.split("/").filter(Boolean)
    if (segs.length === 3) {
      expect(segs[1].endsWith(".html")).toBe(false)
    }
  }
})
```

Key shift: the property iterates over BOTH `kind: "redirect"` outputs (inspecting `.pathname`) AND `kind: "canonical"` outputs (inspecting the original input). A vacuous fixed point that violates the contract now fails the assertion exactly like a wrong redirect target would.

## General principle

**Idempotence property tests prove TRANSFORMS reach fixed points. They do NOT prove the fixed points are CONTRACT-VALID.**

Augment every canonicalize / normalize / state-machine reducer with output-shape contract assertions:

1. **Enumerate output invariants in plain English** before writing rules. E.g., "every 3-segment series shape has a bare episode in position 1", "every redirect Location is same-origin", "every normalized DB record has a non-null `id`".
2. **For each invariant, write a property test** that loops over a representative input set INCLUDING adversarial / malformed fixtures whose shape differs from the rules' preconditions. Inspect the OUTPUT, not the transform return value.
3. **Keep idempotence tests** — they prove convergence is well-formed — but recognize they're orthogonal to validity.

Property tests written from the rule author's POV ask "did my rules converge?" Property tests written from the consumer's POV ask "is the output valid?" Both are required.

## Prevention checklist

When designing a multi-rule canonicalize / normalize / transform pipeline:

- [ ] List the contract invariants the canonical output MUST satisfy, separately from "input transformations" the rules perform.
- [ ] Add a contract property test PER invariant. Loop over fixtures including: happy paths, already-canonical inputs, partially-malformed inputs, fully-malformed inputs whose shape differs from EVERY rule's precondition.
- [ ] Keep idempotence tests but stop billing them as "the safety net."
- [ ] Watch for rules whose precondition silently no-ops on shapes the contract considers invalid. Either tighten the precondition to reject explicitly OR add a downstream contract test that catches the leftover malformed shape.

## Test pattern template

```ts
// Representative fixtures — happy + adversarial + already-canonical + malformed
const FIXTURES = [
  "/jesus.html/english.html", // happy 2-seg
  "/jesus.html/the-beginning/english.html", // happy 3-seg
  "/Jesus.HTML/english.html", // case-malformed
  "/jesus.html/english.html/", // trailing-slash
  "/jesus.html/the-beginning.html/english.html", // 3-seg contract violation
  "/foo", // single-seg legacy
  "/foo/bar", // 2-seg legacy
  "/jesus.html/chinese-mandarin.html", // alias
] as const

// (1) Convergence — idempotence
describe("canonicalize convergence", () => {
  it.each(FIXTURES)("is idempotent for %s", (input) => {
    const first = canonical({ rawPathname: input })
    if (first.kind === "canonical") return
    const second = canonical({ rawPathname: first.pathname })
    expect(second).toEqual({ kind: "canonical" })
  })
})

// (2) Contract — validity (this is the new pattern)
describe("canonicalize contract", () => {
  it.each(FIXTURES)("3-seg output of %s has bare episode segment", (input) => {
    const result = canonical({ rawPathname: input })
    const final = result.kind === "redirect" ? result.pathname : input
    const segs = final.split("/").filter(Boolean)
    if (segs.length === 3) {
      expect(segs[1].endsWith(".html")).toBe(false)
    }
  })
})
```

The contract test inspects the output without re-running the function. It catches malformed fixed points even when every rule no-ops.

## Anti-patterns

- **Assuming idempotence ⇒ correctness.** `f(f(x)) === f(x)` is satisfied by `f = identity` for any malformed `x`.
- **Fixture sets containing only happy / already-canonical inputs.** If every fixture is its own fixed point, the property test passes without exercising any rule.
- **Rules whose precondition silently accepts malformed shapes as no-ops** (`if (segs.length === 3 && segs[0] looks right) { ... }` quietly skips bad-shape inputs).
- **Property tests written from the rule author's POV instead of the consumer's POV.** Author asks "did my rules converge?"; consumer asks "is the output valid?"

## Where this applies

- URL canonicalizers / normalizers — redirect chains, slug normalization, query-param stripping.
- JSON schema migrations / format converters — v1→v2 upgrades where idempotence on already-v2 inputs hides bugs in v1→v2 transitions.
- AST transformers / codemods — `transform(transform(node)) === transform(node)` doesn't catch malformed nodes the visitor doesn't recognize.
- Build pipelines with caching/skip logic — "already built" short-circuits can mask cached artifacts that satisfy the cache predicate but violate downstream contracts.
- Database ORM identity-map normalizers — `normalize(entity)` returning the same reference doesn't prove the entity satisfies foreign-key / constraint invariants.
- Config loaders — `loadConfig(loadConfig(c)) === loadConfig(c)` doesn't prove the loaded config validates.

**Heuristic:** if your code has BOTH "is this already in normal form?" AND "if not, transform it" branches, write contract tests for the output of BOTH branches, with adversarial inputs that exercise the predicate boundary.

## Provenance

- Caught during `/ce:review` of [forge#1049](https://github.com/JesusFilm/forge/pull/1049) — Phase 1 foundation modules for /watch URL restructure.
- P1 finding reported by the `architecture-strategist` review agent.
- Fixed by adding Rule 4.5 + contract property test ([commit 70186e87](https://github.com/JesusFilm/forge/pull/1049/commits/70186e87)).
- Todo: [todos/007-complete-p1-canonicalize-rule4-doesnt-strip-html-from-episode-segment.md](todos/007-complete-p1-canonicalize-rule4-doesnt-strip-html-from-episode-segment.md).

## Related learnings

- [Mocked-shape-vs-real-contract testing discipline](docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — META home. This learning is a new worked instance of the same trap; the META doc should add it to its enumeration.
- [Next.js route-shape migration cross-cutting contract drift](docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md) — the predecessor route-shape work this PR builds on.
- [Series page locale normalized to default on slug-form URLs](docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md) — sibling instance of "normalizer silently accepts shape it should have rejected".
- [Dead invariant checks from sibling port](docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md) — structurally identical: a guard that survives a port syntactically while losing semantic content.
- [Test-first regression snapshot for byte-identical-default invariants](docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md) — adjacent test-discipline pattern (real-shape fixture pinned BEFORE refactor lands).
