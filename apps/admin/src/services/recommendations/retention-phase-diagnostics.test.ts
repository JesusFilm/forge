import { Prisma } from "@prisma/client"
import { describe, expect, it } from "vitest"
import {
  boundedRetentionMilliseconds,
  createRetentionDiagnosticLogLimiter,
  createRetentionPhaseRecorder,
  formatRetentionPhaseFailureLog,
  normalizedRetentionError,
  parseRetentionPhaseFailureLog,
  type RetentionPhaseTiming,
} from "./retention-phase-diagnostics"

function timing(ordinal: number): RetentionPhaseTiming {
  return {
    label: "delete_request_roots",
    ordinal,
    stage: "complete",
    remainingBudgetMs: 4_000,
    admittedBudgetMs: 3_900,
    acquisitionMs: 2,
    advisoryLockMs: 3,
    configurationMs: 1,
    operationMs: 200,
    counterUpdateMs: 4,
    commitAcknowledgementMs: 5,
    incompleteStageElapsedMs: null,
    totalMs: 215,
  }
}

describe("retention phase diagnostics", () => {
  it("bounds timing and keeps only four completed predecessors plus a failed phase", () => {
    const recorder = createRetentionPhaseRecorder()
    for (let ordinal = 1; ordinal <= 8; ordinal++)
      recorder.completed({
        ...timing(ordinal),
        totalMs: ordinal === 2 ? 900 : 215,
      })
    recorder.failed({
      ...timing(9),
      label: "sensitive-user-value" as RetentionPhaseTiming["label"],
      stage: "raw-sql-value" as RetentionPhaseTiming["stage"],
      operationMs: Infinity,
      remainingBudgetMs: 90_000,
      incompleteStageElapsedMs: 0,
    })
    recorder.completed(timing(10), true)
    const diagnostic = recorder.diagnostic(
      "scheduled",
      { phase: new Error("secret") },
      { outcome: "succeeded", elapsedMs: 1.4 },
    )
    expect(diagnostic.precedingCompleted.map(({ ordinal }) => ordinal)).toEqual(
      [5, 6, 7, 8],
    )
    expect(diagnostic.failed).toMatchObject([
      {
        label: "unknown",
        stage: "unavailable",
        remainingBudgetMs: 90_000,
        operationMs: null,
        incompleteStageElapsedMs: 0,
      },
    ])
    expect(diagnostic.slowestCompleted).toMatchObject({
      ordinal: 2,
      totalMs: 900,
    })
    expect(diagnostic.terminal?.ordinal).toBe(10)
    expect(diagnostic.fallbackLedger).toEqual({
      outcome: "succeeded",
      elapsedMs: 1,
    })
    expect(JSON.stringify(diagnostic)).not.toMatch(/secret|sensitive|raw-sql/)
  })

  it("round-trips the post-configuration admission stage", () => {
    const recorder = createRetentionPhaseRecorder()
    recorder.failed({
      ...timing(1),
      stage: "post_configuration_admission",
      operationMs: null,
    })
    const diagnostic = recorder.diagnostic(
      "stored-expiry-only",
      { phase: new Error("terminal failure after yield") },
      { outcome: "succeeded", elapsedMs: 1 },
    )
    const parsed = parseRetentionPhaseFailureLog(
      formatRetentionPhaseFailureLog({
        ...diagnostic,
        suppressedPriorMinute: 0,
      }),
    )
    expect(parsed?.failed).toMatchObject([
      { stage: "post_configuration_admission", operationMs: null },
    ])
  })

  it("never serializes arbitrary error text, codes or metadata", () => {
    const error = new Prisma.PrismaClientKnownRequestError("private request", {
      code: "P2028",
      clientVersion: "6.19.3",
      meta: { code: "57014", payload: "private payload" },
    })
    expect(normalizedRetentionError(error)).toEqual({
      class: "PrismaClientKnownRequestError",
      prismaCode: "P2028",
      sqlstate: "57014",
    })
    const malicious = Object.assign(new Error("private request"), {
      code: "PRIVATE_CODE",
      meta: { code: "private-state", payload: "private payload" },
    })
    expect(normalizedRetentionError(malicious)).toEqual({
      class: "Error",
      prismaCode: null,
      sqlstate: null,
    })
    expect(JSON.stringify(normalizedRetentionError(malicious))).not.toMatch(
      /PRIVATE|private/,
    )
  })

  it("marks unavailable and invalid durations instead of turning them into zeros", () => {
    expect(boundedRetentionMilliseconds(NaN)).toBeNull()
    expect(boundedRetentionMilliseconds(-1)).toBeNull()
    expect(boundedRetentionMilliseconds(Infinity)).toBeNull()
    expect(boundedRetentionMilliseconds(0)).toBe(0)
    expect(boundedRetentionMilliseconds(60_000)).toBe(60_000)
  })

  it("keeps phase, terminal and fallback error classes separately", () => {
    const diagnostic = createRetentionPhaseRecorder().diagnostic(
      "scheduled",
      {
        phase: new Prisma.PrismaClientKnownRequestError("secret phase", {
          code: "P2028",
          clientVersion: "6.19.3",
        }),
        terminal: new Error("secret terminal"),
        fallbackLedger: Object.assign(new Error("secret fallback"), {
          code: "08006",
        }),
      },
      { outcome: "failed", elapsedMs: 50 },
    )
    expect(diagnostic.errors).toEqual({
      phase: {
        class: "PrismaClientKnownRequestError",
        prismaCode: "P2028",
        sqlstate: null,
      },
      terminal: { class: "Error", prismaCode: null, sqlstate: null },
      fallbackLedger: { class: "Error", prismaCode: null, sqlstate: "08006" },
    })
    expect(JSON.stringify(diagnostic)).not.toContain("secret")
  })

  it("caps failure log volume and reports prior-minute suppression", () => {
    const limiter = createRetentionDiagnosticLogLimiter(2)
    expect(limiter.allow(60_000)).toEqual({
      emit: true,
      suppressedPriorMinute: 0,
    })
    expect(limiter.allow(60_001).emit).toBe(true)
    expect(limiter.allow(60_002).emit).toBe(false)
    expect(limiter.allow(60_003).emit).toBe(false)
    expect(limiter.allow(120_000)).toEqual({
      emit: true,
      suppressedPriorMinute: 2,
    })
  })

  it("formats a single-line provider-friendly envelope and parses only the bounded schema", () => {
    const recorder = createRetentionPhaseRecorder()
    recorder.failed(timing(1))
    const diagnostic = {
      ...recorder.diagnostic(
        "scheduled",
        { phase: new Error("private viewer and SQL") },
        { outcome: "succeeded", elapsedMs: 17 },
      ),
      suppressedPriorMinute: 2,
    }
    const line = formatRetentionPhaseFailureLog(diagnostic)
    expect(line).toMatch(
      /^\[recommendations\] event=recommendation_retention_phase_failure payload=\{/,
    )
    expect(line).not.toMatch(/\n|private viewer|SQL/)
    expect(parseRetentionPhaseFailureLog(line)).toEqual(diagnostic)
    expect(parseRetentionPhaseFailureLog(JSON.stringify(diagnostic))).toBeNull()
    expect(
      parseRetentionPhaseFailureLog(JSON.stringify(diagnostic), {
        allowLegacyJson: true,
      }),
    ).toEqual(diagnostic)
    expect(
      parseRetentionPhaseFailureLog(
        line.replace(
          '"suppressedPriorMinute":2',
          '"requestId":"private","suppressedPriorMinute":2',
        ),
      ),
    ).toBeNull()
    expect(
      parseRetentionPhaseFailureLog(
        line.replace('"label":"delete_request_roots"', '"label":"private"'),
      ),
    ).toBeNull()
    for (const malformedOutcome of [["succeeded"], { toString: null }, 1]) {
      const malformed = {
        ...diagnostic,
        fallbackLedger: {
          ...diagnostic.fallbackLedger,
          outcome: malformedOutcome,
        },
      }
      const malformedLine =
        line.slice(0, line.indexOf("payload=") + "payload=".length) +
        JSON.stringify(malformed)
      expect(() => parseRetentionPhaseFailureLog(malformedLine)).not.toThrow()
      expect(parseRetentionPhaseFailureLog(malformedLine)).toBeNull()
    }
  })
})
