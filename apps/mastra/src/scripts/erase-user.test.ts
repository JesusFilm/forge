import { describe, expect, it, vi } from "vitest"

import type {
  AiChatErasureResult,
  LangfuseErasureCounts,
  LangfuseErasureOutcome,
} from "../mastra/ai-chat-erasure"
import { SEEKER_DEFAULT_RESOURCE_ID } from "../mastra/ai-chat-thread-ownership"

import {
  eraseUserTargetIdentity,
  exitCodeFor,
  parseEraseUserArgs,
  runEraseUserCli,
  type EraseUserDeps,
} from "./erase-user"

const DATABASE_URL = "postgresql://forge:secret@db.prod.internal:5432/mastra"
const OTHER_DATABASE_URL =
  "postgresql://forge:secret@localhost:5432/forge_throwaway"
const LANGFUSE_BASE_URL = "https://cloud.langfuse.com"

function completed(
  overrides: Partial<Extract<AiChatErasureResult, { kind: "completed" }>> = {},
): AiChatErasureResult {
  return {
    kind: "completed",
    mode: "preview",
    postgres: { kind: "counted", threadCount: 2 },
    langfuse: { kind: "skipped_unconfigured" },
    ...overrides,
  }
}

/** Count block for Langfuse outcome fixtures — zeros unless a test overrides. */
function lfCounts(
  overrides: Partial<LangfuseErasureCounts> = {},
): LangfuseErasureCounts {
  return {
    listedObservations: 0,
    uniqueTraces: 0,
    mismatchedRowsSkipped: 0,
    missingTraceIdRows: 0,
    deleteRequests: 0,
    tracesSubmitted: 0,
    ...overrides,
  }
}

const langfuseSubmitted = (stillVisibleTraces = 0): LangfuseErasureOutcome => ({
  kind: "submitted",
  requery: { ok: true, stillVisibleTraces },
  ...lfCounts({ uniqueTraces: 3, deleteRequests: 1, tracesSubmitted: 3 }),
})

function harness(
  result: AiChatErasureResult = completed(),
  overrides: Partial<EraseUserDeps> = {},
): {
  deps: EraseUserDeps
  lines: string[]
  preview: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
} {
  const lines: string[] = []
  const preview = vi.fn(async () => result)
  const execute = vi.fn(async () => result)
  return {
    lines,
    preview,
    execute,
    deps: {
      preview,
      execute,
      databaseUrl: DATABASE_URL,
      langfuseBaseUrl: LANGFUSE_BASE_URL,
      stdout: (line) => lines.push(line),
      ...overrides,
    },
  }
}

const RESOURCE = "user:abc"

const identity = (resourceId = RESOURCE) =>
  eraseUserTargetIdentity({
    databaseUrl: DATABASE_URL,
    langfuseBaseUrl: LANGFUSE_BASE_URL,
    resourceId,
  })

describe("erase-user — argument parsing", () => {
  it("reads the house --name=value idiom", () => {
    const args = parseEraseUserArgs([
      "--resource=user:abc",
      "--execute",
      "--confirm-database=deadbeefdeadbeef",
    ])
    expect(args).toEqual({
      resource: "user:abc",
      execute: true,
      confirmDatabase: "deadbeefdeadbeef",
      rejectedFlags: [],
    })
  })

  it("ignores the bare `--` pnpm forwards into argv", () => {
    // `pnpm --filter @forge/mastra erase-user -- --resource=…` passes the
    // separator through verbatim; treating it as a mistyped flag would refuse
    // the runbook's own documented invocation.
    const args = parseEraseUserArgs(["--", "--resource=user:abc"])
    expect(args.rejectedFlags).toEqual([])
    expect(args.resource).toBe("user:abc")
  })

  it("rejects a misspelled flag name rather than ignoring it", () => {
    const args = parseEraseUserArgs([
      "--resource=user:abc",
      "--confirm-databse=oops",
    ])
    expect(args.rejectedFlags).toEqual(["--confirm-databse=oops"])
  })

  it("rejects a boolean flag given a value — it would silently mean 'preview'", () => {
    // `--execute=true` reads to a human as "execute" but does not match
    // `argv.includes("--execute")`. Ignoring it downgrades a destructive run to
    // a preview with no signal at all.
    const args = parseEraseUserArgs(["--resource=user:abc", "--execute=true"])
    expect(args.rejectedFlags).toEqual(["--execute=true"])
    expect(args.execute).toBe(false)
  })

  it("rejects a valued flag given no value", () => {
    const args = parseEraseUserArgs(["--resource"])
    expect(args.rejectedFlags).toEqual(["--resource"])
    expect(args.resource).toBeUndefined()
  })

  it("rejects a REPEATED flag — the first value would silently win", () => {
    // A recalled-and-edited shell line is the realistic source, and `flag()`
    // returns the FIRST match: the operator reads `user:def` on their screen
    // while `user:abc` is what gets erased.
    const args = parseEraseUserArgs([
      "--resource=user:abc",
      "--resource=user:def",
    ])
    expect(args.rejectedFlags).toEqual(["--resource=user:def"])
  })
})

describe("erase-user — target identity hash (KTD3)", () => {
  it("redacts credentials out of the printable identity", () => {
    const target = identity()
    expect(target.postgresRedacted).not.toContain("secret")
    expect(target.postgresRedacted).toContain("db.prod.internal")
    expect(target.langfuseHost).toBe("cloud.langfuse.com")
  })

  it("redacts a credential-bearing query parameter, whatever its spelling", () => {
    // The `event=target` line is the one place a connection string reaches an
    // operator's terminal and shell history, and driver-specific spellings
    // (`pwd`, `sslpassword`) are not covered by an obvious four-word pattern.
    const target = eraseUserTargetIdentity({
      databaseUrl:
        "postgresql://forge@db.prod.internal:5432/mastra?sslmode=require&pwd=hunter2&sslpassword=hunter3",
      langfuseBaseUrl: LANGFUSE_BASE_URL,
      resourceId: RESOURCE,
    })
    expect(target.postgresRedacted).not.toContain("hunter2")
    expect(target.postgresRedacted).not.toContain("hunter3")
    // A non-credential param is preserved — the redaction is targeted, not a
    // blanket strip that would hide which target the operator is pointed at.
    expect(target.postgresRedacted).toContain("sslmode=require")
  })

  it("is stable across credential rotation on the same target", () => {
    const a = eraseUserTargetIdentity({
      databaseUrl: "postgresql://forge:old@db.prod.internal:5432/mastra",
      langfuseBaseUrl: LANGFUSE_BASE_URL,
      resourceId: RESOURCE,
    })
    const b = eraseUserTargetIdentity({
      databaseUrl: "postgresql://forge:new@db.prod.internal:5432/mastra",
      langfuseBaseUrl: LANGFUSE_BASE_URL,
      resourceId: RESOURCE,
    })
    expect(a.hash).toBe(b.hash)
  })

  it("changes when the Postgres target changes", () => {
    const other = eraseUserTargetIdentity({
      databaseUrl: OTHER_DATABASE_URL,
      langfuseBaseUrl: LANGFUSE_BASE_URL,
      resourceId: RESOURCE,
    })
    expect(other.hash).not.toBe(identity().hash)
  })

  it("changes when the Langfuse host changes — the always-production store", () => {
    const other = eraseUserTargetIdentity({
      databaseUrl: DATABASE_URL,
      langfuseBaseUrl: "https://us.cloud.langfuse.com",
      resourceId: RESOURCE,
    })
    expect(other.hash).not.toBe(identity().hash)
  })

  it("distinguishes an unconfigured Langfuse target from a configured one", () => {
    const unconfigured = eraseUserTargetIdentity({
      databaseUrl: DATABASE_URL,
      resourceId: RESOURCE,
    })
    expect(unconfigured.langfuseHost).toBe("unconfigured")
    expect(unconfigured.hash).not.toBe(identity().hash)
  })

  it("changes when the SUBJECT changes, even on identical stores", () => {
    // Without this component the token attests to the destination only: a hash
    // minted while previewing one person authorizes erasing another.
    expect(identity("user:abd").hash).not.toBe(identity("user:abc").hash)
  })

  it("keeps the subject key out of the printable token and identity", () => {
    const target = identity("user:sensitive-sub-9001")
    expect(target.hash).not.toContain("sensitive-sub-9001")
    expect(target.postgresRedacted).not.toContain("sensitive-sub-9001")
  })
})

describe("erase-user — preview path (AE2)", () => {
  it("runs the preview, deletes nothing, exits 0", async () => {
    const { deps, lines, preview, execute } = harness()

    const code = await runEraseUserCli(["--resource=user:abc"], deps)

    expect(code).toBe(0)
    expect(preview).toHaveBeenCalledWith({ resourceId: "user:abc" })
    expect(execute).not.toHaveBeenCalled()
    const output = lines.join("\n")
    expect(output).toContain(
      "event=preview_report postgres=counted threads=2 langfuse=skipped_unconfigured",
    )
    expect(output).toContain(`confirm_database=${identity().hash}`)
    expect(output).toContain(
      "event=langfuse_half_unavailable reason=skipped_unconfigured fallback=langfuse_console_bulk_delete",
    )
  })

  it("never prints the resource key or a credential", async () => {
    const { deps, lines } = harness()

    await runEraseUserCli(["--resource=user:sensitive-sub-9001"], deps)

    const output = lines.join("\n")
    expect(output).not.toContain("sensitive-sub-9001")
    expect(output).not.toContain("secret")
  })
})

describe("erase-user — confirm gate (KTD3)", () => {
  it("refuses --execute with no --confirm-database, before any store is reached", async () => {
    const { deps, lines, preview, execute } = harness()

    const code = await runEraseUserCli(
      ["--resource=user:abc", "--execute"],
      deps,
    )

    expect(code).toBe(1)
    // The erasure module is the ONLY thing that acquires a store client, so an
    // uncalled seam is the observable proof nothing was constructed.
    expect(execute).not.toHaveBeenCalled()
    expect(preview).not.toHaveBeenCalled()
    expect(lines.join("\n")).toContain(
      "event=refused reason=confirm_database_missing",
    )
  })

  it("refuses a mismatched hash before any store is reached", async () => {
    const { deps, lines, preview, execute } = harness()

    const code = await runEraseUserCli(
      [
        "--resource=user:abc",
        "--execute",
        "--confirm-database=0000000000000000",
      ],
      deps,
    )

    expect(code).toBe(1)
    expect(execute).not.toHaveBeenCalled()
    expect(preview).not.toHaveBeenCalled()
    expect(lines.join("\n")).toContain(
      "event=refused reason=confirm_database_mismatch",
    )
  })

  it("refuses a hash minted against a DIFFERENT Langfuse target", async () => {
    // The hash the operator holds was minted while Langfuse pointed elsewhere.
    // Postgres is unchanged, so a Postgres-only hash would have authorized this
    // run against a different (always-production) trace project.
    const staleHash = eraseUserTargetIdentity({
      databaseUrl: DATABASE_URL,
      langfuseBaseUrl: "https://us.cloud.langfuse.com",
      resourceId: RESOURCE,
    }).hash
    const { deps, lines, execute } = harness()

    const code = await runEraseUserCli(
      ["--resource=user:abc", "--execute", `--confirm-database=${staleHash}`],
      deps,
    )

    expect(code).toBe(1)
    expect(execute).not.toHaveBeenCalled()
    expect(lines.join("\n")).toContain(
      "event=refused reason=confirm_database_mismatch",
    )
  })

  it("refuses a hash minted against a DIFFERENT database", async () => {
    const throwawayHash = eraseUserTargetIdentity({
      databaseUrl: OTHER_DATABASE_URL,
      langfuseBaseUrl: LANGFUSE_BASE_URL,
      resourceId: RESOURCE,
    }).hash
    const { deps, execute } = harness()

    const code = await runEraseUserCli(
      [
        "--resource=user:abc",
        "--execute",
        `--confirm-database=${throwawayHash}`,
      ],
      deps,
    )

    expect(code).toBe(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it("never echoes the token on an execute run — not even on refusal", async () => {
    // Otherwise the subject pin is worth one keystroke, not a forced preview:
    // a refusal that prints the token for the arguments just supplied lets the
    // very next paste succeed against a subject nobody ever previewed.
    const { deps, lines } = harness()

    await runEraseUserCli(
      [
        "--resource=user:def",
        "--execute",
        `--confirm-database=${identity().hash}`,
      ],
      deps,
    )

    const output = lines.join("\n")
    expect(output).toContain("event=refused reason=confirm_database_mismatch")
    expect(output).not.toContain(identity("user:def").hash)
    expect(output).not.toContain("confirm_database=")
  })

  it("emits the token on the preview path, which is the only way to obtain it", async () => {
    const { deps, lines } = harness()

    await runEraseUserCli(["--resource=user:abc"], deps)

    expect(lines.join("\n")).toContain(`confirm_database=${identity().hash}`)
  })

  it("refuses a hash minted for a DIFFERENT subject on the same stores", async () => {
    // The wrong-subject path the two store components cannot see: same
    // databases, different person. An operator who previewed `user:abc` and
    // then edited only the resource argument must not get through.
    const otherSubjectHash = identity("user:abc").hash
    const { deps, lines, execute } = harness()

    const code = await runEraseUserCli(
      [
        "--resource=user:def",
        "--execute",
        `--confirm-database=${otherSubjectHash}`,
      ],
      deps,
    )

    expect(code).toBe(1)
    expect(execute).not.toHaveBeenCalled()
    expect(lines.join("\n")).toContain(
      "event=refused reason=confirm_database_mismatch",
    )
  })

  it("runs execute with the matching hash and re-reports execute-time counts", async () => {
    const { deps, lines, execute, preview } = harness(
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 7 },
      }),
    )

    const code = await runEraseUserCli(
      [
        "--resource=user:abc",
        "--execute",
        `--confirm-database=${identity().hash}`,
      ],
      deps,
    )

    expect(execute).toHaveBeenCalledWith({ resourceId: "user:abc" })
    expect(preview).not.toHaveBeenCalled()
    // Labelled distinctly from a preview line so drift is visible, not hidden.
    expect(lines.join("\n")).toContain(
      "event=execute_report postgres=erased threads_deleted=7",
    )
    // The fixture's Langfuse half is trio-absent (`skipped_unconfigured`), so
    // traces may still exist: incomplete-but-rerun-safe, never exit 0 (AE5).
    expect(code).toBe(2)
  })
})

describe("erase-user — refusals and faults", () => {
  it("exits 1 on the shared fallback resource (AE8)", async () => {
    const { deps, lines } = harness({
      kind: "refused",
      reason: "shared_fallback_resource",
    })

    const code = await runEraseUserCli(
      [`--resource=${SEEKER_DEFAULT_RESOURCE_ID}`],
      deps,
    )

    expect(code).toBe(1)
    expect(lines.join("\n")).toContain(
      "event=refused reason=shared_fallback_resource",
    )
  })

  it("exits 1 with a classified reason and no fallback connection when DATABASE_URL is absent", async () => {
    const { deps, lines, preview, execute } = harness(completed(), {
      databaseUrl: undefined,
    })

    const code = await runEraseUserCli(["--resource=user:abc"], deps)

    expect(code).toBe(1)
    expect(lines.join("\n")).toContain(
      "event=refused reason=database_url_missing",
    )
    expect(preview).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    // Nothing resembling the localhost fallback is ever printed or targeted.
    expect(lines.join("\n")).not.toContain("localhost")
  })

  it("exits 1 when --resource is missing", async () => {
    const { deps, lines, preview } = harness()

    const code = await runEraseUserCli(["--execute"], deps)

    expect(code).toBe(1)
    expect(preview).not.toHaveBeenCalled()
    expect(lines.join("\n")).toContain("event=refused reason=resource_required")
  })

  it.each([
    ["a mistyped flag name", ["--confirm-databse=whatever"]],
    ["a boolean flag given a value", ["--execute=true"]],
    ["a repeated flag", ["--resource=user:def"]],
  ])("exits 1 on %s rather than silently dropping it", async (_l, extra) => {
    const { deps, lines, execute, preview } = harness()

    const code = await runEraseUserCli(["--resource=user:abc", ...extra], deps)

    expect(code).toBe(1)
    expect(execute).not.toHaveBeenCalled()
    expect(preview).not.toHaveBeenCalled()
    expect(lines.join("\n")).toContain("event=refused reason=invalid_flags")
    // Counts only — an argv value can carry the subject's key.
    expect(lines.join("\n")).not.toContain("user:def")
  })

  it("exits 1 on an unparseable DATABASE_URL without echoing it", async () => {
    const { deps, lines, preview } = harness(completed(), {
      databaseUrl: "not-a-url-with-a-secret-inside",
    })

    const code = await runEraseUserCli(["--resource=user:abc"], deps)

    expect(code).toBe(1)
    expect(preview).not.toHaveBeenCalled()
    const output = lines.join("\n")
    expect(output).toContain("event=refused reason=target_url_invalid")
    // The branch exists so a parse error cannot leak the credential-bearing
    // string; assert the string itself never reaches the output.
    expect(output).not.toContain("not-a-url-with-a-secret-inside")
  })

  it("exits 1 on a probe fault, and never reports it as a zero count", async () => {
    const { deps, lines } = harness(
      completed({ postgres: { kind: "unreachable" } }),
    )

    const code = await runEraseUserCli(["--resource=user:abc"], deps)

    expect(code).toBe(1)
    const output = lines.join("\n")
    expect(output).toContain("postgres=unreachable")
    expect(output).not.toContain("no_data")
  })
})

describe("erase-user — exit-code map (KTD5)", () => {
  it("exits 0 on a clean no-data preview with a distinct enum line", async () => {
    const { deps, lines } = harness(
      completed({ postgres: { kind: "no_data" } }),
    )

    const code = await runEraseUserCli(["--resource=user:abc"], deps)

    expect(code).toBe(0)
    expect(lines.join("\n")).toContain("event=no_data_for_key store=postgres")
  })

  it("exits 2 with rerun guidance on a store-partial result", async () => {
    const { deps, lines } = harness(
      completed({
        mode: "execute",
        postgres: {
          kind: "failed",
          stage: "delete",
          reason: "store_error",
          threadsDeleted: 3,
        },
      }),
    )

    const code = await runEraseUserCli(
      [
        "--resource=user:abc",
        "--execute",
        `--confirm-database=${identity().hash}`,
      ],
      deps,
    )

    expect(code).toBe(2)
    const output = lines.join("\n")
    // Exit-2 reports name the per-store state AND that rerun is safe.
    expect(output).toContain(
      "postgres=failed stage=delete reason=store_error threads_deleted=3",
    )
    expect(output).toContain(
      "event=exit code=2 rerun_safe=1 note=exact_key_deletes_are_idempotent",
    )
  })

  it.each([
    [
      "refusal",
      { kind: "refused", reason: "blank_resource_id" } as AiChatErasureResult,
      1,
    ],
    ["probe fault", completed({ postgres: { kind: "unreachable" } }), 1],
    [
      "Langfuse egress-pin refusal (KTD11: fault, never incomplete)",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: { kind: "egress_refused" },
      }),
      1,
    ],
    [
      "unreadable-userId listing refusal (R7)",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: {
          kind: "refused_unreadable_user_ids",
          missingUserIdRows: 2,
          ...lfCounts(),
        },
      }),
      1,
    ],
    [
      "unaddressable-rows listing refusal (matching rows without trace ids)",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: {
          kind: "refused_unaddressable_rows",
          ...lfCounts({ listedObservations: 2, missingTraceIdRows: 2 }),
        },
      }),
      1,
    ],
    [
      "Postgres list failure",
      completed({
        postgres: {
          kind: "failed",
          stage: "list",
          reason: "store_error",
          threadsDeleted: 0,
        },
      }),
      2,
    ],
    ["clean preview (trio absent — claims nothing)", completed(), 0],
    [
      "clean preview with a Langfuse trace count",
      completed({
        langfuse: {
          kind: "counted",
          ...lfCounts({ listedObservations: 3, uniqueTraces: 3 }),
        },
      }),
      0,
    ],
    [
      "preview whose Langfuse listing was rate-limited",
      completed({
        langfuse: {
          kind: "rate_limited",
          stage: "list",
          retryAfterSeconds: 30,
          ...lfCounts(),
        },
      }),
      2,
    ],
    [
      "full-submission execute, requery already clean",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: langfuseSubmitted(0),
      }),
      0,
    ],
    [
      "full-submission execute, not yet converged (R15 non-failure)",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: langfuseSubmitted(3),
      }),
      0,
    ],
    [
      "full-submission execute whose requery itself failed",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: {
          kind: "submitted",
          requery: { ok: false, reason: "network_error" },
          ...lfCounts({
            uniqueTraces: 1,
            deleteRequests: 1,
            tracesSubmitted: 1,
          }),
        },
      }),
      0,
    ],
    [
      "no data in BOTH stores on execute (AE7)",
      completed({
        mode: "execute",
        postgres: { kind: "no_data" },
        langfuse: { kind: "no_data", ...lfCounts() },
      }),
      0,
    ],
    [
      "execute with the Langfuse trio absent (state unknowable, AE5)",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
      }),
      2,
    ],
    [
      "execute over a key with no Postgres data but the trio absent",
      completed({ mode: "execute", postgres: { kind: "no_data" } }),
      2,
    ],
    [
      "delete-stage quota hit (AE3)",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: {
          kind: "quota_exhausted",
          remainingTraces: 600,
          impliedDaysToComplete: 2,
          ...lfCounts({ uniqueTraces: 600, deleteRequests: 1 }),
        },
      }),
      2,
    ],
    [
      "delete-request cap hit",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: {
          kind: "cap_exceeded",
          cap: "delete_requests",
          remainingTraces: 20,
          ...lfCounts({
            uniqueTraces: 520,
            deleteRequests: 10,
            tracesSubmitted: 500,
          }),
        },
      }),
      2,
    ],
    [
      "classified Langfuse failure after the Postgres half",
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: {
          kind: "failed",
          stage: "delete",
          reason: "auth_failed",
          status: 401,
          ...lfCounts({ uniqueTraces: 1, deleteRequests: 1 }),
        },
      }),
      2,
    ],
  ])("maps %s to exit %i", (_label, result, expected) => {
    expect(exitCodeFor(result as AiChatErasureResult)).toBe(expected)
  })
})

describe("erase-user — Langfuse report wiring (R5/AE3/AE4/AE7)", () => {
  const executeArgs = [
    "--resource=user:abc",
    "--execute",
    `--confirm-database=${identity().hash}`,
  ]

  it("prints the quota outcome with remaining count and implied-days horizon (AE3/F2)", async () => {
    const { deps, lines } = harness(
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 2 },
        langfuse: {
          kind: "quota_exhausted",
          remainingTraces: 600,
          impliedDaysToComplete: 2,
          ...lfCounts({ uniqueTraces: 600, deleteRequests: 1 }),
        },
      }),
    )

    const code = await runEraseUserCli(executeArgs, deps)

    expect(code).toBe(2)
    const output = lines.join("\n")
    expect(output).toContain("langfuse=quota_exhausted")
    expect(output).toContain("remaining_traces=600")
    expect(output).toContain("implied_days_to_complete=2")
    expect(output).toContain("guidance=daily_delete_quota_rerun_tomorrow")
    expect(output).toContain(
      "event=exit code=2 rerun_safe=1 note=exact_key_deletes_are_idempotent",
    )
  })

  it("prints retry-shortly with seconds on a list-stage 429 — and NEVER the daily-quota wording", async () => {
    const { deps, lines } = harness(
      completed({
        langfuse: {
          kind: "rate_limited",
          stage: "list",
          retryAfterSeconds: 30,
          ...lfCounts(),
        },
      }),
    )

    const code = await runEraseUserCli(["--resource=user:abc"], deps)

    expect(code).toBe(2)
    const output = lines.join("\n")
    expect(output).toContain("langfuse=rate_limited stage=list")
    expect(output).toContain("retry_after_s=30")
    expect(output).toContain("guidance=retry_shortly")
    // A read-bucket throttle must not steer the operator at the delete quota.
    expect(output).not.toContain("quota")
    expect(output).not.toContain("tomorrow")
  })

  it("names BOTH per-store states with the rerun-safe note on a partial run", async () => {
    const { deps, lines } = harness(
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 4 },
        langfuse: {
          kind: "failed",
          stage: "list",
          reason: "auth_failed",
          status: 401,
          ...lfCounts(),
        },
      }),
    )

    const code = await runEraseUserCli(executeArgs, deps)

    expect(code).toBe(2)
    const output = lines.join("\n")
    expect(output).toContain("postgres=erased threads_deleted=4")
    expect(output).toContain(
      "langfuse=failed stage=list reason=auth_failed status=401",
    )
    expect(output).toContain(
      "event=exit code=2 rerun_safe=1 note=exact_key_deletes_are_idempotent",
    )
  })

  it("reports the both-stores no-data case as one distinct line (AE7)", async () => {
    const { deps, lines } = harness(
      completed({
        mode: "execute",
        postgres: { kind: "no_data" },
        langfuse: { kind: "no_data", ...lfCounts() },
      }),
    )

    const code = await runEraseUserCli(executeArgs, deps)

    expect(code).toBe(0)
    const output = lines.join("\n")
    expect(output).toContain("event=no_data_for_key stores=postgres+langfuse")
    expect(output).not.toContain("event=no_data_for_key store=postgres\n")
  })

  it("exits 1 on an egress-pin refusal and never renders it as a zero count", async () => {
    const { deps, lines } = harness(
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: { kind: "egress_refused" },
      }),
    )

    const code = await runEraseUserCli(executeArgs, deps)

    expect(code).toBe(1)
    const output = lines.join("\n")
    expect(output).toContain("langfuse=egress_refused")
    expect(output).not.toContain("no_data")
  })

  it("exits 1 on an unaddressable-rows refusal, naming the count and zero deletes", async () => {
    // Matching rows without readable trace ids: a hard fault to escalate —
    // no rerun fixes it, so the report must never read as incomplete-rerun.
    const { deps, lines } = harness(
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: {
          kind: "refused_unaddressable_rows",
          ...lfCounts({ listedObservations: 3, missingTraceIdRows: 3 }),
        },
      }),
    )

    const code = await runEraseUserCli(executeArgs, deps)

    expect(code).toBe(1)
    const output = lines.join("\n")
    expect(output).toContain(
      "langfuse=refused_unaddressable_rows missing_trace_id_rows=3",
    )
    expect(output).not.toContain("rerun_safe=1")
  })

  it("prints settle-first guidance on a delete-request cap hit, rerun guidance on a page-cap hit", async () => {
    const capOutcome = (cap: "delete_requests" | "list_pages") =>
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: {
          kind: "cap_exceeded",
          cap,
          ...lfCounts({ uniqueTraces: 520, deleteRequests: 10 }),
        },
      })
    const deleteCap = harness(capOutcome("delete_requests"))
    await runEraseUserCli(executeArgs, deleteCap.deps)
    expect(deleteCap.lines.join("\n")).toContain(
      "guidance=rerun_after_async_deletion_settles wait_minutes=15",
    )
    const pageCap = harness(capOutcome("list_pages"))
    await runEraseUserCli(executeArgs, pageCap.deps)
    expect(pageCap.lines.join("\n")).toContain("guidance=rerun_to_continue")
  })

  it("reports submitted-not-converged as a clean exit with the still-visible count (AE4)", async () => {
    const { deps, lines } = harness(
      completed({
        mode: "execute",
        postgres: { kind: "erased", threadsDeleted: 1 },
        langfuse: langfuseSubmitted(3),
      }),
    )

    const code = await runEraseUserCli(executeArgs, deps)

    expect(code).toBe(0)
    const output = lines.join("\n")
    expect(output).toContain("langfuse=submitted")
    expect(output).toContain("still_visible=3")
    expect(output).toContain("verify_via_later_preview")
  })
})
