---
title: "Mocked-shape-vs-real-contract testing discipline — mocks prove BRANCH SHAPE; real fixtures prove PRODUCTION CONTRACT"
date: 2026-05-06
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
related:
  - "docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md"
  - "docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md"
  - "docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md"
  - "docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md"
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

The same trap, five different surfaces:

| Surface                                             | Doc                                                                                                                             | Trap                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AWS SDK error shape**                             | [aws-s3-nosuchkey-classification-pattern-20260506.md](../runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md)    | Mock throws `new Error("NoSuchKey: ...")`. Regex matches. Typed-name branch never tested. SDK reword breaks prod, no test catches it. (PR1 of feat-119 hit this exact case during /ce:review and added the regex-incompatible-message cases.)                                                                                                 |
| **PG function resolution**                          | [pgvector-bulk-insert-on-conflict-pattern-20260505.md](../database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md) | Mocked SQL-shape test asserts `WHERE` clause structure. PG's actual function-resolution rules (jsonb vs json overload set, enum case sensitivity, NULL-pad behavior of multi-arg `unnest`) only fail at runtime against real Postgres. (feat-117 captured this lesson after the bulk-insert path passed mocked tests but errored on real PG.) |
| **In-house typed errors with literal-union `code`** | [parallel-workflow-error-robustness-20260420.md](parallel-workflow-error-robustness-20260420.md)                                | Mock rejects with generic `new Error("artifact_missing: ...")`. The workflow's `instanceof TypedError && error.code === "..."` branching never fires (the regex-message check above it does). A real `TypedError` thrown from production has a different code path than the test exercises.                                                   |
| **Infrastructure writes (Railway MCP staging)**     | [verify-infra-writes-via-independent-read-path-20260420.md](verify-infra-writes-via-independent-read-path-20260420.md)          | The MCP `updateServiceTool` returns "applied" even when the change is staged-but-not-deployed. Verifying via the same MCP's `getServiceConfigTool` returns the same masked value either way. Only an independent read path (curl the runtime endpoint, check the deployed service's actual environment) proves the contract.                  |
| **Cross-PR file-format contract literals**          | [producer-consumer-report-file-contract-pattern-20260506.md](producer-consumer-report-file-contract-pattern-20260506.md)        | feat-119 PR2's CLI filtered for `kind: "scene"` while PR1 emitted `kind: "scene-analysis"`. Test fixture used the WRONG literal (matching the buggy filter), making the test self-confirming. The discriminator branch was never tested against a real producer literal — green tests, broken operator workflow.                              |

These five are the same rule five times. If you find a sixth
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

The four worked instances cite each other in a triangle. None of
them is the canonical home. Adding a fifth instance forces a fifth
set of bidirectional cross-references. This META doc is the apex —
new instances cite this doc, and this doc adds them to the table
above.

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
