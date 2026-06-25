---
title: "Mocked-shape-vs-real-contract testing discipline — mocks prove BRANCH SHAPE; real fixtures prove PRODUCTION CONTRACT"
date: 2026-05-06
last_updated: 2026-06-25
problem_type: best_practice
component: testing_framework
root_cause: inadequate_documentation
resolution_type: workflow_improvement
severity: high
module: cross-cutting
tags:
  - testing
  - mocks
  - typed-errors
  - regression-pin
  - integration-testing
  - meta-pattern
  - best-practice
  - structural-impedance
related:
  - "docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md"
  - "docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md"
  - "docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md"
  - "docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md"
  - "docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md"
  - "docs/solutions/best-practices/llm-comment-mass-edit-deterministic-verification-20260623.md"
---

# Mocked-shape-vs-real-contract testing discipline

A meta-pattern that names a recurring trap. If you've ever shipped
code where the unit tests were green and prod still broke at the
real boundary, this rule is the one you wish you'd written down.

## The rule

> **Mocked tests prove the BRANCH SHAPE works.
> Real-shape fixtures prove the PRODUCTION CONTRACT works.**

A mocked input that satisfies multiple branches at once gives you
zero signal about which branch is load-bearing. Deleting any of the
satisfied branches won't fail any test — yet one of them is the
branch production actually depends on.

The discipline:

1. **Every typed branch must have at least one test where ONLY that
   branch can match.** If the typed-name discriminator AND the regex
   backstop both match the mock, the test proves nothing about which
   branch is load-bearing.
2. **For boundary code (DB, S3, network, IPC), at least one test
   case must use the real producer's actual shape** — not a generic
   stand-in. A `new Error("NoSuchKey: ...")` that matches a regex is
   not a substitute for `Object.assign(new Error(...), { name: "NoSuchKey" })`
   which is the actual AWS SDK v3 throw.
3. **A real-system smoke gate is not optional for boundary
   classifiers, SQL function calls, and external-service wiring.**
   Mocked-shape tests catch the clause shape; only real fixtures
   catch the contract.

## The trap, in one snippet

```ts
// The classifier
function isArtifactMissing(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name
    if (name === "NoSuchKey" || name === "NotFound") return true // (1) typed-name
    const code = (error as { Code?: unknown }).Code
    if (code === "NoSuchKey" || code === "NotFound") return true // (2) legacy Code
  }
  const message = error instanceof Error ? error.message : String(error)
  return /not found|does not exist|ENOENT/i.test(message) // (3) regex backstop
}

// The mocked test
readArtifactSpy.mockRejectedValueOnce(
  Object.assign(new Error("The specified key does not exist."), {
    name: "NoSuchKey",
  }),
)
expect(error.code).toBe("artifact_missing") // ✅ passes
```

The test passes. Tier 1 (`name === "NoSuchKey"`) returns true. So
does Tier 3 (the regex matches `does not exist`). **Deleting Tier 1
entirely** does not fail this test — Tier 3 still catches it via
the message. Production, where Tier 1 is the load-bearing branch
because AWS reliably sets `name` but rewords the textual message
across SDK versions, silently breaks the next time the message
changes.

The fix:

```ts
// Add a case where ONLY Tier 1 can match
readArtifactSpy.mockRejectedValueOnce(
  Object.assign(new Error("Server returned HTTP 500"), {
    name: "NoSuchKey", // typed-name set; message DOES NOT match the regex
  }),
)
expect(error.code).toBe("artifact_missing")
// Now: deleting Tier 1 fails this test. The branch is load-bearing.
```

## Worked instances in this codebase

The same trap, twelve different surfaces:

| Surface                                                      | Doc                                                                                                                                                                        | Trap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AWS SDK error shape**                                      | [aws-s3-nosuchkey-classification-pattern-20260506.md](../runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md)                                               | Mock throws `new Error("NoSuchKey: ...")`. Regex matches. Typed-name branch never tested. SDK reword breaks prod, no test catches it. (PR1 of feat-119 hit this exact case during /ce:review and added the regex-incompatible-message cases.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **PG function resolution**                                   | [pgvector-bulk-insert-on-conflict-pattern-20260505.md](../database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md)                                            | Mocked SQL-shape test asserts `WHERE` clause structure. PG's actual function-resolution rules (jsonb vs json overload set, enum case sensitivity, NULL-pad behavior of multi-arg `unnest`) only fail at runtime against real Postgres. (feat-117 captured this lesson after the bulk-insert path passed mocked tests but errored on real PG.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **In-house typed errors with literal-union `code`**          | [parallel-workflow-error-robustness-20260420.md](parallel-workflow-error-robustness-20260420.md)                                                                           | Mock rejects with generic `new Error("artifact_missing: ...")`. The workflow's `instanceof TypedError && error.code === "..."` branching never fires (the regex-message check above it does). A real `TypedError` thrown from production has a different code path than the test exercises.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Infrastructure writes (Railway MCP staging)**              | [verify-infra-writes-via-independent-read-path-20260420.md](verify-infra-writes-via-independent-read-path-20260420.md)                                                     | The MCP `updateServiceTool` returns "applied" even when the change is staged-but-not-deployed. Verifying via the same MCP's `getServiceConfigTool` returns the same masked value either way. Only an independent read path (curl the runtime endpoint, check the deployed service's actual environment) proves the contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Cross-PR file-format contract literals**                   | [producer-consumer-report-file-contract-pattern-20260506.md](producer-consumer-report-file-contract-pattern-20260506.md)                                                   | feat-119 PR2's CLI filtered for `kind: "scene"` while PR1 emitted `kind: "scene-analysis"`. Test fixture used the WRONG literal (matching the buggy filter), making the test self-confirming. The discriminator branch was never tested against a real producer literal — green tests, broken operator workflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Verification-command coverage of dual-form DSLs**          | [graphql-callsite-inventory-dual-pattern-sweep-20260507.md](graphql-callsite-inventory-dual-pattern-sweep-20260507.md)                                                     | Single-pattern `rg "graphql\("` "verifies" the GraphQL callsite inventory for the typed-helper form (gql.tada) but silently drops the raw Apollo `` gql`...` `` form authored alongside it. Same shape as the regex-backstop trap: one verification path satisfies the inventory; the real production callsite in the other form is invisible. (Caught during /ce-doc-review on the Unit 1 plan; would have cascaded into Unit 2 building the wrong PUBLIC field set for `sceneRecommendations`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Producer-consumer round-trip with no real fixture**        | [bearer-as-passport-multi-csv-composition-20260518.md](../architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md) (PR #976 `import-from-env` deletion) | `importPartnerKeyFromPlaintext` (now deleted) wrote `sha256(opaqueLegacyToken)` into `PartnerApiKey.keyHash`. Mocked DB-write tests asserted the INSERT shape and passed. NO test exercised the verify-after-import round-trip — because `verifyPartnerToken` requires the `jfp_search_<keyId>_<random>` shape and legacy opaque tokens cannot parse. The two sides' contracts were STRUCTURALLY incompatible; only a real round-trip test (import-then-verify) would have surfaced it. Recovery: delete the broken migration path entirely — see "Recovery when contracts are structurally broken" below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Idempotence property test on state-machine canonicalizer** | [idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md](idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md) (forge#1049 `/ce:review`) | The `/watch` URL canonicalizer guards convergence with `canonicalize(canonicalize(x).pathname) === { kind: "canonical" }`. For `/series.html/ep.html/lang.html` (3-segment shape with `.html` on the bare-by-contract episode segment), NO rule's precondition matched — the malformed shape was its OWN fixed point. The property held vacuously while the production contract (episode segment MUST be bare) was silently violated. Same shape as the regex-backstop trap: self-referential properties prove BRANCH SHAPE / convergence; output-invariant properties prove PRODUCTION CONTRACT / validity. Recovery: add Rule 4.5 + an output-shape contract property test that inspects both `kind: "redirect"` and `kind: "canonical"` outputs against the contract invariant.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Typed model catalog vs live provider API**                 | [mastra-conversational-agent-memory-and-model-router-wiring.md](../integration-issues/mastra-conversational-agent-memory-and-model-router-wiring.md)                       | Mastra's generated `provider-types.generated.d.ts` lists model ids at package-build time, so membership makes a string compile but is NOT a guarantee the live provider serves it. `tsc` green proves BRANCH SHAPE (catalog membership); only a live call proves PRODUCTION CONTRACT. In the feat-198 smoke a catalog-listed model failed at runtime with an opaque provider error while a sibling worked — that specific failure was not root-caused from logs (could have been availability, rate limit, or transient), but the compile-time-catalog-vs-live-availability gap is the durable, structural lesson regardless.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Source-text route-isolation parser**                       | [mastra-studio-api-auth-guard.md](../integration-issues/mastra-studio-api-auth-guard.md) (feat-198 seeker test)                                                            | A string-unaware bracket-matching slice of the `apiRoutes` region truncates early on an unbalanced bracket inside a future route string literal, so the negative assertion ("region does not contain the agent symbol") can pass vacuously even when a custom route wires the agent — and the anti-vacuous guards (region non-empty, contains `registerApiRoute`) still pass. Fixed with a parser-independent backstop: the agent symbol must appear exactly twice in `index.ts` (import + registration), so any third reference fails the test regardless of the parser.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **LLM-agent comment-only mass edit**                         | [llm-comment-mass-edit-deterministic-verification-20260623.md](llm-comment-mass-edit-deterministic-verification-20260623.md) (forge#1337 comment-trim)                     | An LLM agent's self-reported residual count AND a naive comment scanner are both PROXIES that satisfice: a verify-agent reported 4 over-limit comments in `VideoPlayer.tsx` where a deterministic re-scan found 17, and raw-span scanning flagged 382 phantom violations vs 137 real (prose-count with `@`-tag/`/** */`-delimiter/`// -- heading --`-decorator exemptions). Only a deterministic comment-stripper proving code byte-identity (same strip over HEAD vs working, diff the outputs) + a prose re-scan prove the contract. NEW dimension beyond the other rows: LLM condensation also _fabricates_ specifics — it invented an HTTP `403` absent from the source, contradicting both the `queries.test.ts` regression guard and a sibling comment that said `401`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Runtime guard vs `.d.ts` optional type**                   | [2026-06-24-001-feat-seeker-mastra-route-plan.md](../../plans/2026-06-24-001-feat-seeker-mastra-route-plan.md) (feat-204, PR #1371)                                        | Mastra's `AgentMemoryOption` type marks `resource?` OPTIONAL, but the compiled runtime throws `AGENT_MEMORY_MISSING_RESOURCE_ID` when a memory-configured agent receives a `threadId` without a `resourceId`. `tsc` is green (BRANCH SHAPE: the type permits omission) AND the fake-agent unit tests are green (they inject a mock agent, so the real guard never runs) — yet production would throw. Only a real-`Agent` + real in-memory `Memory` smoke, stubbing ONLY the LLM/network (not the agent itself), exercises the guard and proves the PRODUCTION CONTRACT; the route's fix (always supply a constant default `resourceId`) is verifiable by nothing else. Distinct from the "typed model catalog" row above: there the type was permissive about a VALUE (catalog membership), here it is permissive about PRESENCE (an optional field) — and the NEW dimension is that the fake-agent test _displaced_ the very guard under test. The corollary: a "smoke" test that mocks the very object whose runtime behavior is under test proves nothing _about that object's own runtime contract_ (it still exercises the surrounding wiring, arg threading, and other branches) — stub the boundary, keep the unit-under-test real. |

These twelve are the same rule twelve times. If you find a thirteenth
instance, add it here — that's the META home.

## Why the rule keeps recurring

- **Defense-in-depth backstops are honest engineering.** Typed
  primary + regex fallback is a good design. The hazard is that the
  fallback eats the test signal of the primary.
- **Mocks are easy; real fixtures are expensive.** The path of
  least resistance is to throw `new Error("NoSuchKey")`. The
  discipline is to spend the extra 30 seconds writing
  `Object.assign(new Error(...), { name: "NoSuchKey" })`.
- **The trap is invisible in green tests.** Code review can catch
  it (test-shape doesn't match producer-shape) but it doesn't
  surface as a failed test — it surfaces as a future regression.
- **Prod boundaries change shape under you.** SDK upgrades,
  PG version bumps, infra-tool API drift. Mocked tests freeze the
  shape you assumed; real fixtures track the shape that actually
  ships.

## Prevention checklist (when adding a typed-discriminator branch)

1. **Identify each branch's "ONLY this branch matches" condition.**
   For Tier 1 (typed-name), that's a fixture where the message
   doesn't match the regex backstop. For Tier 2 (legacy `Code`),
   that's a fixture where neither `name` nor message-regex match.
2. **Write at least one test per branch using its
   only-this-branch-matches condition.** A regex-incompatible
   message paired with a typed-name. A typed-Code paired with both
   a non-AWS-shaped name and a regex-incompatible message.
3. **Use the real producer's actual shape in at least one test.**
   For AWS SDK v3, that's the literal class shape AWS throws, not a
   message-only stand-in. For Prisma, that's a real
   `Prisma.PrismaClientKnownRequestError` instance, not
   `new Error("P2002: ...")`.
4. **For SQL, infrastructure writes, and external-service wiring,
   add a real-system smoke gate.** Mocked tests stay green
   regardless; only real fixtures catch contract changes.
5. **When you fix a test that passed for the wrong reason,
   document the failure mode in the test comment.** Future
   maintainers tempted to "simplify" the test back to the
   message-only form will see the rationale.

## Why a META doc, not just cross-references

Without a META home the worked instances would cite each other in a
web — none of them the canonical home — and every new instance would
force another full set of bidirectional cross-references. This META
doc is the apex — new instances cite this doc, and this doc adds them
to the table above.

## Recovery when contracts are structurally broken

The worked instances above all describe traps where the
contract IS satisfiable — the test was just shaped wrong. There's a
distinct failure mode: **the producer and consumer have a structural
impedance mismatch and no real fixture can succeed**. The signature
is "you can write the migration path test green, but the integrate-
forward path test cannot exist."

Example (PR #976): `importPartnerKeyFromPlaintext` stored
`sha256(opaqueToken)` against a fabricated `keyId`. The verifier
required the token to MATCH `^jfp_search_<keyId>_<random>$`. There
was no `rawToken` value that could satisfy both the import path
(arbitrary legacy plaintext, no prefix structure) AND the verify
path (must parse to extract `keyId` for the DB lookup).

When mocked tests prove BRANCH SHAPE and the real-contract round-
trip is **impossible by construction**, the right move is NOT to
patch with a back-compat tagging column ("if `keyId === null`, do
full-table hash scan instead"). The right move is to **delete the
broken path entirely** and force operators onto a flow that respects
the verifier's contract (in this case: re-issue a fresh `jfp_search_*`
token via `partner-keys create` and have the partner rotate onto it).

### Recovery checklist when a mocked-shape test passes for an unreachable production path

1. **Write the integration test that would prove the round-trip
   works.** If you can't — because the producer's output and the
   consumer's input shapes are structurally incompatible — stop.
2. **Don't patch with a tag column / fallback branch / discriminator
   field.** Each of those compounds the test surface and adds prod
   code that exists only to serve a path that should not exist.
3. **Delete the broken path and the tests that mock it.** The mocked
   tests were proving a branch shape that maps to nothing real.
4. **Document the deletion in the same PR.** Update the runbook to
   describe the supported flow (in this case: rotate-onto-fresh-key).
   Add a regression-guard test that the deleted path is no longer
   reachable (e.g., `parseArgvToConfig(["import-from-env"])` throws
   "unknown subcommand"). The PR #976 commit `c1aa1e48` is the
   canonical example.

## Refresh trigger

If you find yourself writing a test where a single mocked input
satisfies multiple branches of a typed-discriminator chain, AND
deleting a "real" branch would not fail the test, that is the
signal. Either:

- Tighten the test (per the checklist above), or
- Add a new worked-instance row to the table above and tighten the
  test in your domain's specific way.

The discipline isn't "never use mocks." It's "every typed branch
gets at least one test that proves it's load-bearing."
