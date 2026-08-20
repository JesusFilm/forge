import { describe, expect, it, vi } from "vitest"

import type { DatadogTriageConfig } from "../../config/env"
import type {
  TriageAnalysis,
  TriageAnalyzer,
} from "../../services/datadog-triage/analyze"
import type { DatadogIssue } from "../../services/datadog-triage/datadog-client"
import type { TriageLinearActionClient } from "../../services/datadog-triage/linear-dispatcher"
import type {
  DatadogTriageRepository,
  DueTriageAction,
} from "../../services/datadog-triage/repository"
import type {
  SpikeBaseline,
  TriageActionDraft,
} from "../../services/datadog-triage/schema"

import {
  DatadogMobileTriageInputSchema,
  datadogMobileTriageWorkflow,
  executeDatadogTriage,
  type DatadogSourceClient,
} from "./datadog-mobile-triage"

const NOW = new Date("2026-08-18T11:00:00.000Z")

const READY_CONFIG: DatadogTriageConfig = {
  enabled: true,
  model: "openai/gpt-5.4-mini",
  modelApiKeyPresent: true,
  databaseUrl: "postgresql://localhost:5432/test",
  site: "datadoghq.com",
  apiKey: "dd-api-key",
  applicationKey: "dd-app-key",
  services: ["forge-mobile"],
  serviceProfiles: {
    "forge-mobile": {
      surfacePrefix: "[Mobile]",
      releaseSessionFilter: true,
      spikeSource: "rum",
    },
  },
  serviceProfilesInvalid: false,
  maxCandidatesPerRun: 200,
  maxTicketsPerDay: 5,
  timeoutMs: 15_000,
  judgeTimeoutMs: 60_000,
  maxResponseBytes: 4_194_304,
  overlapMs: 300_000,
  ingestionLagMs: 180_000,
  baselineLookbackMs: 604_800_000,
  confidenceThreshold: 0.7,
  actionabilityThreshold: 0.6,
  minOccurrences: 3,
  regressionMultiplier: 3,
  monitorCooldownMs: 21_600_000,
  spikeMultiplier: 3,
  releaseVersionPattern: "^\\d+\\.\\d+(?:\\.\\d+)?(?:[-+][0-9A-Za-z.-]+)?$",
  devSessionMarkers: ["127.0.0.1", "dev=true"],
  linear: {
    apiKey: "lin_api_key",
    apiUrl: "https://api.linear.app/graphql",
    teamId: "team-fge",
    projectId: "project-mobile-triage",
    bugLabelId: "label-bug",
  },
}

const ANALYSIS: TriageAnalysis = {
  worthInvestigating: true,
  classification: "crash",
  confidence: 0.9,
  actionability: 0.8,
  severity: "P2",
  suspectedArea: "video playback",
  summary: "The player throws on resume.",
}

function issue(overrides: Partial<DatadogIssue> = {}): DatadogIssue {
  return {
    issueId: "ISSUE-1",
    service: "forge-mobile",
    state: "FOR_REVIEW",
    errorType: "TypeError",
    errorMessage: "Cannot read property 'id' of undefined",
    platform: "REACT_NATIVE",
    isCrash: true,
    firstSeen: "2026-08-18T10:07:00.000Z",
    lastSeen: "2026-08-18T10:55:00.000Z",
    firstSeenVersion: "1.4.2",
    lastSeenVersion: "1.4.2",
    totalCount: 12,
    ...overrides,
  }
}

type RepositoryStub = DatadogTriageRepository & { calls: string[] }

type OutboxRow = {
  draft: TriageActionDraft
  state: "pending" | "processing" | "created" | "deduplicated" | "terminal"
  attempts: number
}

/**
 * A faithful-enough in-memory outbox. A stub that always claimed nothing would
 * make the end-to-end case pass for the wrong reason: the second dispatch could
 * never reach Linear, so "a fresh ticket does not wait an hour" would be
 * unprovable here. The real budget SQL is proven by the repository smoke; this
 * models only enough of it to keep the orchestration honest.
 */
function repository(
  overrides: Partial<DatadogTriageRepository> & {
    seeded?: string[]
    preloaded?: DueTriageAction[]
    spikeBaselines?: SpikeBaseline[]
  } = {},
): RepositoryStub {
  const calls: string[] = []
  const outbox = new Map<string, OutboxRow>()
  for (const action of overrides.preloaded ?? []) {
    outbox.set(action.idempotencyKey, {
      draft: action.draft,
      state: "pending",
      attempts: action.attempts,
    })
  }
  const record =
    <T>(name: string, value: T) =>
    async () => {
      calls.push(name)
      return value
    }
  const countDispatched = () =>
    [...outbox.values()].filter(
      (row) => row.state === "created" || row.state === "deduplicated",
    ).length

  return {
    calls,
    claimRun: vi.fn(record("claimRun", { claimed: true as const })),
    renewRunLease: vi.fn(record("renewRunLease", undefined)),
    finalizeRun: vi.fn(record("finalizeRun", undefined)),
    getCursors: vi.fn(record("getCursors", [])),
    commitCursors: vi.fn(record("commitCursors", undefined)),
    getSeededServices: vi.fn(
      record("getSeededServices", overrides.seeded ?? ["forge-mobile"]),
    ),
    seedServiceBaselines: vi.fn(record("seedServiceBaselines", undefined)),
    getSeenIssues: vi.fn(record("getSeenIssues", [])),
    commitSeenIssues: vi.fn(record("commitSeenIssues", undefined)),
    getMonitorStates: vi.fn(record("getMonitorStates", [])),
    commitMonitorStates: vi.fn(record("commitMonitorStates", undefined)),
    getSpikeBaselines: vi.fn(
      record("getSpikeBaselines", overrides.spikeBaselines ?? []),
    ),
    commitSpikeBaselines: vi.fn(record("commitSpikeBaselines", undefined)),
    enqueueAction: vi.fn(async (draft: TriageActionDraft) => {
      calls.push("enqueueAction")
      if (outbox.has(draft.idempotencyKey)) return false
      outbox.set(draft.idempotencyKey, { draft, state: "pending", attempts: 0 })
      return true
    }),
    claimDueActions: vi.fn(
      async (input: { dailyLimit: number; claimLimit: number }) => {
        calls.push("claimDueActions")
        const budget = Math.max(0, input.dailyLimit - countDispatched())
        const claimed: DueTriageAction[] = []
        for (const [key, row] of outbox) {
          if (claimed.length >= Math.min(input.claimLimit, budget)) break
          if (row.state !== "pending") continue
          row.state = "processing"
          row.attempts += 1
          claimed.push({
            idempotencyKey: key,
            draft: row.draft,
            attempts: row.attempts,
          })
        }
        return claimed
      },
    ),
    countDueActions: vi.fn(async () => {
      calls.push("countDueActions")
      return [...outbox.values()].filter((row) => row.state === "pending")
        .length
    }),
    markActionCreated: vi.fn(async (input: { idempotencyKey: string }) => {
      calls.push("markActionCreated")
      const row = outbox.get(input.idempotencyKey)
      if (row) row.state = "created"
    }),
    markActionDeduplicated: vi.fn(async (input: { idempotencyKey: string }) => {
      calls.push("markActionDeduplicated")
      const row = outbox.get(input.idempotencyKey)
      if (row) row.state = "deduplicated"
    }),
    markActionMutationAttempted: vi.fn(
      record("markActionMutationAttempted", undefined),
    ),
    markActionRetryable: vi.fn(
      async (input: { idempotencyKey: string; terminal: boolean }) => {
        calls.push("markActionRetryable")
        const row = outbox.get(input.idempotencyKey)
        if (row) row.state = input.terminal ? "terminal" : "pending"
      },
    ),
    ...overrides,
  } as unknown as RepositoryStub
}

function datadog(
  overrides: Partial<DatadogSourceClient> = {},
): DatadogSourceClient {
  return {
    searchIssues: vi.fn(async () => ({
      ok: true as const,
      value: { issues: [], unparsedRows: 0 },
    })),
    listMonitors: vi.fn(async () => ({
      ok: true as const,
      value: { monitors: [], unparsedRows: 0 },
    })),
    aggregateLogs: vi.fn(async () => ({
      ok: true as const,
      value: { buckets: [], partial: false },
    })),
    aggregateRumEvents: vi.fn(async () => ({
      ok: true as const,
      value: { buckets: [], partial: false },
    })),
    ...overrides,
  } as unknown as DatadogSourceClient
}

function linear(
  overrides: Partial<TriageLinearActionClient> = {},
): TriageLinearActionClient {
  return {
    findIssueByMarker: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
    createIssue: vi.fn(async () => ({
      ok: true as const,
      value: { id: "issue-1", url: "https://linear.app/forge/issue/FGE-1" },
    })),
    ...overrides,
  } as unknown as TriageLinearActionClient
}

function analyzer(analysis: TriageAnalysis = ANALYSIS): TriageAnalyzer {
  return { generate: vi.fn(async () => ({ object: analysis }) as never) }
}

function run(input: {
  config?: Partial<DatadogTriageConfig>
  repository?: RepositoryStub
  datadog?: DatadogSourceClient
  linear?: TriageLinearActionClient
  analyzer?: TriageAnalyzer
}) {
  return executeDatadogTriage(
    {},
    {
      config: { ...READY_CONFIG, ...(input.config ?? {}) },
      repository: input.repository ?? repository(),
      datadog: input.datadog ?? datadog(),
      linear: input.linear ?? linear(),
      analyzer: input.analyzer ?? analyzer(),
      now: () => NOW,
      randomId: () => "lease-a",
    },
  )
}

describe("datadogMobileTriageWorkflow registration", () => {
  it("runs hourly on the hour in UTC", () => {
    const schedules = (
      datadogMobileTriageWorkflow as typeof datadogMobileTriageWorkflow & {
        getScheduleConfigs: () => Array<{
          cron: string
          timezone?: string
          inputData?: unknown
        }>
      }
    ).getScheduleConfigs()

    expect(schedules).toHaveLength(1)
    expect(schedules[0]).toMatchObject({ cron: "0 * * * *", timezone: "UTC" })
    expect(schedules[0]).not.toHaveProperty("id")
    expect(schedules[0]).not.toHaveProperty("inputData")
  })

  it("accepts an empty scheduled payload", () => {
    expect(DatadogMobileTriageInputSchema.parse({})).toEqual({})
  })

  it("refuses an unexpected input key", () => {
    expect(() =>
      DatadogMobileTriageInputSchema.parse({ dryRun: true }),
    ).toThrow()
  })
})

describe("executeDatadogTriage readiness (R12)", () => {
  it("exits without touching Datadog, Linear, or Postgres when the flag is off", async () => {
    const repo = repository()
    const dd = datadog()
    const lin = linear()

    const report = await run({
      config: { enabled: false },
      repository: repo,
      datadog: dd,
      linear: lin,
    })

    expect(report.status).toBe("disabled")
    expect(report.errors).toContain("feature_disabled")
    expect(repo.calls).toEqual([])
    expect(dd.searchIssues).not.toHaveBeenCalled()
    expect(lin.createIssue).not.toHaveBeenCalled()
  })

  // The model credential is as load-bearing as the Datadog and Linear ones:
  // without it the sweep would pass readiness, spend Datadog quota hourly,
  // fail EVERY judgment, and file nothing — reported `partial`, with the
  // runbook's liveness query green because only the fetch half succeeded.
  it("exits disabled when the judgment model has no credential", async () => {
    const repo = repository()
    const dd = datadog()

    const report = await run({
      config: { modelApiKeyPresent: false },
      repository: repo,
      datadog: dd,
    })

    expect(report.status).toBe("disabled")
    expect(report.errors).toContain("model_api_key_missing")
    expect(repo.calls).toEqual([])
    expect(dd.searchIssues).not.toHaveBeenCalled()
  })

  it("exits disabled when credentials are missing even with the flag on", async () => {
    const report = await run({ config: { apiKey: undefined } })

    expect(report.status).toBe("disabled")
    expect(report.errors).toContain("datadog_api_key_missing")
  })

  it("reports already_running rather than sweeping twice", async () => {
    const repo = repository({
      claimRun: vi.fn(async () => ({
        claimed: false as const,
        status: "running",
      })),
    } as never)
    const dd = datadog()

    const report = await run({ repository: repo, datadog: dd })

    expect(report.status).toBe("already_running")
    expect(dd.searchIssues).not.toHaveBeenCalled()
  })
})

describe("executeDatadogTriage sweep", () => {
  it("Covers AE1: a quiet hour still drains the outbox and spends no judgment", async () => {
    const repo = repository()
    const judge = analyzer()

    const report = await run({ repository: repo, analyzer: judge })

    expect(repo.claimDueActions).toHaveBeenCalled()
    expect(judge.generate).not.toHaveBeenCalled()
    expect(report.status).toBe("complete")
    expect(report.counters.candidates).toBe(0)
  })

  it("drains the outbox BEFORE reading Datadog", async () => {
    const repo = repository()
    const dd = datadog()

    await run({ repository: repo, datadog: dd })

    expect(repo.calls.indexOf("claimDueActions")).toBeLessThan(
      repo.calls.indexOf("commitCursors"),
    )
    expect(repo.calls.indexOf("claimDueActions")).toBeLessThan(
      repo.calls.indexOf("getSeenIssues") === -1
        ? Number.MAX_SAFE_INTEGER
        : repo.calls.indexOf("getSeenIssues"),
    )
  })

  it("Covers AE2: one new signal flows fetch to detect to judge to enqueue to dispatch", async () => {
    const repo = repository()
    const lin = linear()

    const report = await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
      } as never),
      linear: lin,
    })

    expect(report.counters.candidates).toBe(1)
    expect(report.counters.judged).toBe(1)
    expect(report.counters.actionsEnqueued).toBe(1)
    const draft = vi.mocked(repo.enqueueAction).mock
      .calls[0]?.[0] as TriageActionDraft
    expect(draft.title).toBe(
      "[Mobile] [P2] TypeError: Cannot read property 'id' of undefined",
    )
    expect(lin.createIssue).toHaveBeenCalled()
    expect(report.issueUrls).toContain("https://linear.app/forge/issue/FGE-1")
  })

  it("dispatches again after enqueueing so a fresh ticket does not wait an hour", async () => {
    const repo = repository()

    await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
      } as never),
    })

    // The first drain runs before detection, so it cannot see this run's own
    // enqueue. What proves AE2's latency bound is a claim AFTER the enqueue
    // that reaches a create in the same run.
    const enqueuedAt = repo.calls.indexOf("enqueueAction")
    const claimsAfterEnqueue = repo.calls
      .slice(enqueuedAt)
      .filter((call) => call === "claimDueActions")
    expect(enqueuedAt).toBeGreaterThanOrEqual(0)
    expect(claimsAfterEnqueue.length).toBeGreaterThan(0)
    expect(repo.calls.indexOf("markActionCreated")).toBeGreaterThan(enqueuedAt)
  })

  it("Covers AE4: an over-budget finding is enqueued and left queued, never dropped", async () => {
    const spent: DueTriageAction[] = Array.from({ length: 5 }, (_, index) => ({
      idempotencyKey: `datadog-triage:issue:SPENT-${index}:0`,
      draft: {
        idempotencyKey: `datadog-triage:issue:SPENT-${index}:0`,
        service: "forge-mobile",
        signalKind: "issue" as const,
        signalId: `SPENT-${index}`,
        epoch: 0,
        title: `[Mobile] [P3] Earlier finding ${index}`,
        description: "body",
      },
      attempts: 0,
    }))
    const repo = repository({ preloaded: spent })

    const report = await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue({ issueId: "SIXTH" })], unparsedRows: 0 },
        })),
      } as never),
    })

    expect(report.counters.actionsCreated).toBe(5)
    expect(report.counters.actionsEnqueued).toBe(1)
    expect(report.counters.actionsDeferred).toBe(1)
  })

  it("Covers AE5: a service's first covered run seeds baselines and files nothing", async () => {
    const repo = repository({ seeded: [] })

    const report = await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: {
            issues: [issue(), issue({ issueId: "ISSUE-2" })],
            unparsedRows: 0,
          },
        })),
      } as never),
    })

    expect(report.counters.candidates).toBe(0)
    expect(report.counters.servicesSeeded).toBe(1)
    expect(repo.enqueueAction).not.toHaveBeenCalled()
    expect(vi.mocked(repo.seedServiceBaselines).mock.calls[0]?.[0]).toEqual([
      "forge-mobile",
    ])
    expect(vi.mocked(repo.commitSeenIssues).mock.calls[0]?.[0]).toHaveLength(2)
  })

  it("Covers KTD3: a failed monitors fetch leaves its state alone while issues still flow", async () => {
    const repo = repository()

    const report = await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
        listMonitors: vi.fn(async () => ({
          ok: false as const,
          reason: "rate_limited" as const,
          retryable: true,
          ambiguous: false as const,
        })),
      } as never),
    })

    expect(report.status).toBe("partial")
    expect(report.counters.candidates).toBe(1)
    expect(report.sources).toContainEqual({
      source: "monitor:forge-mobile",
      status: "failed",
      reason: "rate_limited",
    })
    expect(vi.mocked(repo.commitMonitorStates).mock.calls[0]?.[0]).toEqual([])
    const cursors = vi.mocked(repo.commitCursors).mock.calls[0]?.[0] ?? []
    expect(cursors.map((cursor) => cursor.source)).toEqual([
      "issue:forge-mobile",
      "spike:forge-mobile",
    ])
  })

  it("does not mark a service seeded when one of its sources failed", async () => {
    const repo = repository({ seeded: [] })

    await run({
      repository: repo,
      datadog: datadog({
        listMonitors: vi.fn(async () => ({
          ok: false as const,
          reason: "network_error" as const,
          retryable: true,
          ambiguous: false as const,
        })),
      } as never),
    })

    expect(vi.mocked(repo.seedServiceBaselines).mock.calls[0]?.[0]).toEqual([])
  })

  it("commits state and cursors only after the enqueue is durable", async () => {
    const repo = repository()

    await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
      } as never),
    })

    expect(repo.calls.indexOf("enqueueAction")).toBeLessThan(
      repo.calls.indexOf("commitSeenIssues"),
    )
    expect(repo.calls.indexOf("commitSeenIssues")).toBeLessThan(
      repo.calls.indexOf("commitCursors"),
    )
    expect(repo.calls.indexOf("commitCursors")).toBeLessThan(
      repo.calls.indexOf("finalizeRun"),
    )
  })

  it("pins each committed seen-issue row to the outbox row that justifies it", async () => {
    const repo = repository()

    await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
      } as never),
    })

    // Assert the CONTENTS, not just that the call happened: with an empty
    // array this call is always made, so a bare toHaveBeenCalled() cannot tell
    // a correct pin from nothing being committed at all.
    const committed = vi.mocked(repo.commitSeenIssues).mock.calls[0]?.[0] ?? []
    expect(committed).toEqual([
      expect.objectContaining({
        issueId: "ISSUE-1",
        requiredActionKey: "datadog-triage:issue:ISSUE-1:0",
      }),
    ])
  })

  it("commits a suppressed candidate's state with no outbox pin", async () => {
    // Judged and rejected: the row still commits so the signal is not
    // re-judged next hour, but it has no action row to be pinned to.
    const repo = repository()

    await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
      } as never),
      analyzer: analyzer({ ...ANALYSIS, worthInvestigating: false }),
    })

    const committed = vi.mocked(repo.commitSeenIssues).mock.calls[0]?.[0] ?? []
    expect(committed).toEqual([
      expect.objectContaining({
        issueId: "ISSUE-1",
        requiredActionKey: undefined,
      }),
    ])
  })

  it("commits no state at all for a candidate this run could not judge", async () => {
    const repo = repository()

    await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
      } as never),
      analyzer: {
        generate: vi.fn(async () => {
          throw new Error("provider down")
        }),
      },
    })

    expect(vi.mocked(repo.commitSeenIssues).mock.calls[0]?.[0]).toEqual([])
  })

  it("leaves the cursor unmoved when a state commit refuses", async () => {
    const repo = repository({
      commitSeenIssues: vi.fn(async () => {
        throw new Error("write ordering violated")
      }),
    } as never)

    const report = await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
      } as never),
    })

    expect(report.status).toBe("failed")
    expect(repo.commitCursors).not.toHaveBeenCalled()
  })

  it("withholds a suppressed judgment's ticket but still records the state", async () => {
    const repo = repository()

    const report = await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
      } as never),
      analyzer: analyzer({ ...ANALYSIS, worthInvestigating: false }),
    })

    expect(report.counters.suppressed).toBe(1)
    expect(repo.enqueueAction).not.toHaveBeenCalled()
  })

  it("withholds state for a signal whose judgment failed, so next hour retries it", async () => {
    const repo = repository()

    const report = await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: {
            issues: [issue({ totalCount: 4 })],
            unparsedRows: 0,
          },
        })),
      } as never),
      analyzer: {
        generate: vi.fn(async () => {
          throw new Error("provider down")
        }),
      },
    })

    expect(report.counters.judgeFailures).toBe(1)
    expect(report.errors).toContain("judge:agent_error")
    const cursors = vi.mocked(repo.commitCursors).mock.calls[0]?.[0] ?? []
    const issueCursor = cursors.find(
      (cursor) => cursor.source === "issue:forge-mobile",
    )
    // Held at the unjudged signal's own timestamp, not the window end.
    expect(issueCursor?.cursorAt.toISOString()).toBe("2026-08-18T10:55:00.000Z")
  })

  it("holds the cursor at the earliest capped-out signal", async () => {
    const repo = repository()

    await run({
      config: { maxCandidatesPerRun: 1 },
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: {
            issues: [
              issue({ issueId: "LATER", lastSeen: "2026-08-18T10:50:00.000Z" }),
              issue({
                issueId: "EARLIER",
                lastSeen: "2026-08-18T10:20:00.000Z",
              }),
            ],
            unparsedRows: 0,
          },
        })),
      } as never),
    })

    const cursors = vi.mocked(repo.commitCursors).mock.calls[0]?.[0] ?? []
    const issueCursor = cursors.find(
      (cursor) => cursor.source === "issue:forge-mobile",
    )
    expect(issueCursor?.cursorAt.toISOString()).toBe("2026-08-18T10:50:00.000Z")
  })

  it("marks a partial aggregate as partial and skips its baseline", async () => {
    const repo = repository()

    const report = await run({
      repository: repo,
      datadog: datadog({
        aggregateRumEvents: vi.fn(async () => ({
          ok: true as const,
          value: { buckets: [{ key: "total", count: 40 }], partial: true },
        })),
      } as never),
    })

    expect(report.status).toBe("partial")
    expect(report.sources).toContainEqual({
      source: "spike:forge-mobile",
      status: "partial",
      reason: "aggregate_timeout",
    })
    expect(vi.mocked(repo.commitSpikeBaselines).mock.calls[0]?.[0]).toEqual([])
  })

  it("uses the RUM aggregate for a mobile-shaped service and logs otherwise", async () => {
    const mobile = datadog()
    await run({ datadog: mobile })
    expect(mobile.aggregateRumEvents).toHaveBeenCalled()
    expect(mobile.aggregateLogs).not.toHaveBeenCalled()

    const admin = datadog()
    await run({
      config: {
        services: ["forge-admin"],
        serviceProfiles: {
          "forge-admin": {
            surfacePrefix: "[Admin]",
            releaseSessionFilter: false,
            spikeSource: "logs",
          },
        },
      },
      datadog: admin,
    })
    expect(admin.aggregateLogs).toHaveBeenCalled()
    expect(admin.aggregateRumEvents).not.toHaveBeenCalled()
  })

  it("Covers AE6: only configured services are read at all", async () => {
    const dd = datadog()

    await run({ datadog: dd })

    expect(vi.mocked(dd.searchIssues).mock.calls).toHaveLength(1)
    expect(vi.mocked(dd.searchIssues).mock.calls[0]?.[0]?.service).toBe(
      "forge-mobile",
    )
  })

  it("reports unparsed rows rather than letting envelope drift look like a quiet hour", async () => {
    const report = await run({
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [], unparsedRows: 7 },
        })),
      } as never),
    })

    expect(report.status).toBe("partial")
    expect(report.errors).toContain("datadog:issue:forge-mobile:unparsed_rows")
  })

  // The storm this guards: run 1 reads a WIDE baseline window and truncates,
  // so it must not seed. If it still advances the cursor, run 2 resolves a
  // ~1h window instead of the baseline lookback, seeds off that one hour, and
  // run 3 tickets every standing error the hour happened to miss (F3/AE5).
  it.each([
    ["a truncated page", { issues: [], unparsedRows: 0, truncated: true }],
    ["unparsed rows", { issues: [], unparsedRows: 7, truncated: false }],
  ])(
    "holds the issue cursor when %s leaves an unseeded service unseedable",
    async (_, value) => {
      const repo = repository({ seeded: [] })
      const report = await run({
        repository: repo,
        datadog: datadog({
          searchIssues: vi.fn(async () => ({ ok: true as const, value })),
        } as never),
      })

      const cursors = vi.mocked(repo.commitCursors).mock.calls[0]?.[0] ?? []
      expect(
        cursors.find((cursor) => cursor.source === "issue:forge-mobile"),
      ).toBeUndefined()
      expect(repo.seedServiceBaselines).not.toHaveBeenCalledWith(
        ["forge-mobile"],
        expect.anything(),
      )
      expect(report.errors).toContain(
        "datadog:issue:forge-mobile:baseline_read_incomplete",
      )
    },
  )

  it("advances the issue cursor on an incomplete read once seeded", async () => {
    // Past seeding the standing set is recorded, so an incomplete page costs
    // coverage for one hour, not a false baseline — holding here would stall
    // the source permanently on a service that always fills its page.
    const repo = repository({ seeded: ["forge-mobile"] })
    await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [], unparsedRows: 0, truncated: true },
        })),
      } as never),
    })

    const cursors = vi.mocked(repo.commitCursors).mock.calls[0]?.[0] ?? []
    expect(
      cursors.find((cursor) => cursor.source === "issue:forge-mobile"),
    ).toBeDefined()
  })

  // A terminalized dispatch still commits the signal's detection state, so the
  // signal is never re-detected and the ticket is never filed. Reporting the
  // run `complete` is what makes that permanent and invisible: the runbook's
  // liveness query reads fetch health, which stays green.
  it("reports a run partial when a dispatch terminalizes", async () => {
    const report = await run({
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [issue()], unparsedRows: 0 },
        })),
      } as never),
      linear: linear({
        findIssueByMarker: vi.fn(async () => ({
          ok: false as const,
          reason: "auth_failed" as const,
          retryable: false,
          ambiguous: false,
        })),
      } as never),
    })

    expect(report.counters.failures).toBeGreaterThan(0)
    expect(report.status).toBe("partial")
    expect(report.partialReason).toBe("dispatch_failed")
  })

  it("does not stamp liveness for a read that parsed nothing", async () => {
    // `last_success_at` is the only liveness signal the runbook has. A renamed
    // Datadog field returns HTTP 200 with zero usable rows, so stamping it
    // green is what made that class of outage invisible.
    const repo = repository({ seeded: ["forge-mobile"] })
    await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: { issues: [], unparsedRows: 7, truncated: false },
        })),
      } as never),
    })

    const cursors = vi.mocked(repo.commitCursors).mock.calls[0]?.[0] ?? []
    expect(
      cursors.find((cursor) => cursor.source === "issue:forge-mobile")
        ?.succeeded,
    ).toBe(false)
  })
  // Review finding: only the ISSUE pin arm was ever asserted, so deleting
  // pins.monitors.set / pins.spikes.set failed no test.
  it("pins a monitor candidate's action key onto its state commit", async () => {
    const repo = repository()
    await run({
      repository: repo,
      datadog: datadog({
        listMonitors: vi.fn(async () => ({
          ok: true as const,
          value: {
            monitors: [
              {
                monitorId: "42",
                name: "Mobile crash rate",
                overallState: "Alert",
                overallStateModified: new Date(
                  NOW.getTime() - 5 * 60_000,
                ).toISOString(),
                tags: ["service:forge-mobile"],
              },
            ],
            unparsedRows: 0,
          },
        })),
      } as never),
    })

    const committed = vi.mocked(repo.commitMonitorStates).mock.calls[0]?.[0]
    expect(committed?.[0]?.requiredActionKey).toBeDefined()
    expect(committed?.[0]?.lastTicketedAt).toBeTruthy()
  })

  it("pins a spike candidate's action key onto its baseline commit", async () => {
    const repo = repository({
      spikeBaselines: [
        {
          service: "forge-mobile",
          spikeClass: "error_rate",
          baselineRate: 1,
          observations: 24,
          epoch: 0,
          lastTicketedAt: null,
        },
      ],
    })
    await run({
      repository: repo,
      datadog: datadog({
        aggregateRumEvents: vi.fn(async () => ({
          ok: true as const,
          value: {
            buckets: [{ key: "error_rate", count: 400 }],
            partial: false,
          },
        })),
      } as never),
    })

    const committed = vi.mocked(repo.commitSpikeBaselines).mock.calls[0]?.[0]
    expect(committed?.[0]?.requiredActionKey).toBeDefined()
    expect(committed?.[0]?.lastTicketedAt).toBeTruthy()
  })

  // Review finding: this fired only when EVERY candidate failed, so a
  // deterministic per-candidate failure repeated hourly under `complete`.
  it("reports partial when only SOME candidates fail to draft", async () => {
    const repo = repository()
    let call = 0
    vi.mocked(repo.enqueueAction).mockImplementation(async () => {
      call += 1
      if (call === 1) throw new Error("boom")
      return true
    })

    const report = await run({
      repository: repo,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: {
            issues: [issue(), issue({ issueId: "ISSUE-2" })],
            unparsedRows: 0,
          },
        })),
      } as never),
    })

    expect(report.counters.judgeFailures).toBe(1)
    expect(report.counters.judgeFailures).toBeLessThan(report.counters.judged)
    expect(report.status).toBe("partial")
    expect(report.partialReason).toBe("judgment_partial")
  })

  it("stops judging after repeated back-to-back draft failures", async () => {
    // A dependency outage should not buy a model call for every remaining
    // candidate before hitting the same wall.
    const repo = repository()
    vi.mocked(repo.enqueueAction).mockRejectedValue(new Error("db down"))
    const analyzer = {
      generate: vi.fn(async () => ({ object: ANALYSIS }) as never),
    }

    const report = await run({
      repository: repo,
      analyzer: analyzer as never,
      datadog: datadog({
        searchIssues: vi.fn(async () => ({
          ok: true as const,
          value: {
            issues: Array.from({ length: 12 }, (_, i) =>
              issue({ issueId: `ISSUE-${i}` }),
            ),
            unparsedRows: 0,
          },
        })),
      } as never),
    })

    expect(analyzer.generate.mock.calls.length).toBeLessThanOrEqual(3)
    expect(report.partialReason).toBe("draft_systemic_failure")
    expect(report.errors).toContain("draft:systemic_failure")
  })

  it("does not stamp monitor liveness for a read that parsed nothing", async () => {
    const repo = repository({ seeded: ["forge-mobile"] })
    await run({
      repository: repo,
      datadog: datadog({
        listMonitors: vi.fn(async () => ({
          ok: true as const,
          value: { monitors: [], unparsedRows: 4 },
        })),
      } as never),
    })

    const cursors = vi.mocked(repo.commitCursors).mock.calls[0]?.[0] ?? []
    expect(
      cursors.find((c) => c.source === "monitor:forge-mobile")?.succeeded,
    ).toBe(false)
  })

  it("unparsed monitor rows block the service from seeding", async () => {
    const repo = repository({ seeded: [] })
    await run({
      repository: repo,
      datadog: datadog({
        listMonitors: vi.fn(async () => ({
          ok: true as const,
          value: { monitors: [], unparsedRows: 4 },
        })),
      } as never),
    })

    expect(repo.seedServiceBaselines).not.toHaveBeenCalledWith(
      ["forge-mobile"],
      expect.anything(),
    )
  })
  // Verification finding: mutating either withhold filter to `() => true` left
  // the whole suite green -- nothing asserted the WITHHELD arm of either one.
  it("does not commit a withheld spike's advanced epoch", async () => {
    const repo = repository({
      spikeBaselines: [
        {
          service: "forge-mobile",
          spikeClass: "error_rate",
          baselineRate: 1,
          observations: 24,
          epoch: 0,
          lastTicketedAt: null,
        },
      ],
    })
    // Judgment fails, so the candidate is withheld and its state must NOT
    // commit -- otherwise the next run cannot re-derive the same ticket.
    const analyzer = { generate: vi.fn(async () => ({ object: {} }) as never) }

    await run({
      repository: repo,
      analyzer: analyzer as never,
      datadog: datadog({
        aggregateRumEvents: vi.fn(async () => ({
          ok: true as const,
          value: {
            buckets: [{ key: "error_rate", count: 400 }],
            partial: false,
          },
        })),
      } as never),
    })

    const committed = vi.mocked(repo.commitSpikeBaselines).mock.calls[0]?.[0]
    expect(committed?.some((u) => u.spikeClass === "error_rate")).toBe(false)
  })

  it("does not commit a withheld monitor's state", async () => {
    const repo = repository()
    const analyzer = { generate: vi.fn(async () => ({ object: {} }) as never) }

    await run({
      repository: repo,
      analyzer: analyzer as never,
      datadog: datadog({
        listMonitors: vi.fn(async () => ({
          ok: true as const,
          value: {
            monitors: [
              {
                monitorId: "42",
                name: "Mobile crash rate",
                overallState: "Alert",
                overallStateModified: new Date(
                  NOW.getTime() - 5 * 60_000,
                ).toISOString(),
                tags: ["service:forge-mobile"],
              },
            ],
            unparsedRows: 0,
          },
        })),
      } as never),
    })

    const committed = vi.mocked(repo.commitMonitorStates).mock.calls[0]?.[0]
    expect(committed?.some((u) => u.monitorId === "42")).toBe(false)
  })

  it("gives the dispatcher a clock that advances within one run", async () => {
    // Verification finding: reverting both call sites to the run's frozen
    // clock left the suite green, because every other test injects `now`.
    // This one deliberately omits it so the production path is the one tested.
    const seen: number[] = []
    const repo = repository()
    vi.mocked(repo.claimDueActions).mockImplementation(async (input) => {
      seen.push((input as { now: Date }).now.getTime())
      return []
    })

    vi.useFakeTimers()
    try {
      vi.setSystemTime(NOW)
      const promise = executeDatadogTriage(
        {},
        {
          config: READY_CONFIG,
          repository: repo,
          datadog: datadog({
            searchIssues: vi.fn(async () => {
              vi.advanceTimersByTime(90_000)
              return {
                ok: true as const,
                value: { issues: [issue()], unparsedRows: 0 },
              }
            }),
          } as never),
          linear: linear(),
          analyzer: analyzer(),
          randomId: () => "lease-a",
        },
      )
      await promise
    } finally {
      vi.useRealTimers()
    }

    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seen).size).toBeGreaterThan(1)
  })
})
