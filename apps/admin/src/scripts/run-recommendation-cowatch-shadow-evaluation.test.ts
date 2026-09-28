import { describe, expect, it, vi } from "vitest"
import { RecommendationInputError } from "../services/recommendations/errors"
import {
  cowatchShadowEvaluationErrorMessage,
  parseCowatchShadowEvaluationArguments,
  runCowatchShadowEvaluationCli,
} from "./run-recommendation-cowatch-shadow-evaluation"

const NOW = new Date("2026-09-29T12:00:00.000Z")
const EVALUATION_ID = "11111111-1111-4111-8111-111111111111"
const ARGS = [
  "--execute",
  "--evaluation-id",
  EVALUATION_ID,
  "--window-start",
  "2026-09-28T11:59:00.000Z",
  "--window-end",
  "2026-09-29T11:59:00.000Z",
  "--sample-size",
  "100",
  "--minimum-runs",
  "30",
]

function withValue(key: string, value: string) {
  const args = [...ARGS]
  args[args.indexOf(key) + 1] = value
  return args
}

describe("co-watch shadow evaluation CLI", () => {
  it("omits private context from unexpected runtime failures", () => {
    const error = new Error("database postgres://private-host/identity-context")
    expect(cowatchShadowEvaluationErrorMessage(error)).toBe(
      "Shadow evaluation dispatch failed; inspect private runtime diagnostics before retrying the recorded tuple.",
    )
    expect(
      cowatchShadowEvaluationErrorMessage(
        new RecommendationInputError("Required: --execute"),
      ),
    ).toBe("Required: --execute")
  })
  it("retains the explicit retry tuple while the current clock advances", () => {
    const tuple = parseCowatchShadowEvaluationArguments(ARGS, NOW)
    expect(tuple).toEqual({
      evaluationId: EVALUATION_ID,
      windowStart: new Date("2026-09-28T11:59:00.000Z"),
      windowEnd: new Date("2026-09-29T11:59:00.000Z"),
      requestedSampleSize: 100,
      minimumRuns: 30,
    })
    expect(
      parseCowatchShadowEvaluationArguments(
        ARGS,
        new Date("2026-09-29T12:10:00.000Z"),
      ),
    ).toEqual(tuple)
  })

  it.each([
    ["missing execute", ARGS.slice(1)],
    ["missing tuple", ["--execute"]],
    ["missing value", [...ARGS.slice(0, -1)]],
    ["duplicate execute", [...ARGS, "--execute"]],
    ["duplicate same value", [...ARGS, "--sample-size", "100"]],
    ["conflicting value", [...ARGS, "--sample-size", "200"]],
    ["unknown option", [...ARGS, "--unknown", "value"]],
    ["unexpected positional argument", [...ARGS, "value"]],
    ["invalid UUID", withValue("--evaluation-id", "not-a-uuid")],
    [
      "timestamp without timezone",
      withValue("--window-end", "2026-09-29T11:59:00"),
    ],
    [
      "invalid calendar date",
      withValue("--window-end", "2026-09-31T11:59:00Z"),
    ],
    [
      "submillisecond timestamp",
      withValue("--window-end", "2026-09-29T11:59:00.0001Z"),
    ],
    ["reversed window", withValue("--window-start", "2026-09-29T12:00:00Z")],
    ["open window", withValue("--window-end", "2026-09-29T12:01:01Z")],
    ["expired window", withValue("--window-start", "2026-08-30T11:59:00Z")],
    ["oversized sample", withValue("--sample-size", "10001")],
    ["fractional sample", withValue("--sample-size", "100.5")],
    ["zero minimum runs", withValue("--minimum-runs", "0")],
    ["minimum runs above sample", withValue("--minimum-runs", "101")],
    ["exponential integer", withValue("--sample-size", "1e2")],
  ] satisfies [string, string[]][])(
    "rejects %s before loading the runtime",
    async (_name, args) => {
      const loadRuntime = vi.fn()
      const write = vi.fn()
      await expect(
        runCowatchShadowEvaluationCli(args, {
          now: () => NOW,
          loadRuntime,
          write,
        }),
      ).rejects.toBeInstanceOf(RecommendationInputError)
      expect(loadRuntime).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    },
  )

  it("prints the safe retry tuple before a failed dispatch and disconnects", async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error("dispatch failed"))
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const write = vi.fn()
    const loadRuntime = vi.fn().mockResolvedValue({ dispatch, disconnect })

    await expect(
      runCowatchShadowEvaluationCli(ARGS, {
        now: () => NOW,
        write,
        loadRuntime,
      }),
    ).rejects.toThrow("dispatch failed")
    expect(write).toHaveBeenCalledOnce()
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({
      status: "dispatch_intent",
      evaluationId: EVALUATION_ID,
      windowStart: "2026-09-28T11:59:00.000Z",
      windowEnd: "2026-09-29T11:59:00.000Z",
      requestedSampleSize: 100,
      minimumRuns: 30,
    })
    expect(write).toHaveBeenCalledBefore(loadRuntime)
    expect(write).toHaveBeenCalledBefore(dispatch)
    expect(dispatch).toHaveBeenCalledWith({
      ...parseCowatchShadowEvaluationArguments(ARGS, NOW),
      actorId: "cowatch-shadow-cli",
      now: NOW,
    })
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it("passes the same tuple on retry and prints the existing workflow result", async () => {
    const result = {
      status: "already_dispatched",
      evaluationId: EVALUATION_ID,
      generation: 1,
      created: false,
      dispatch: { queued: true, ledgerRunId: "ledger-1", runId: "runtime-1" },
    }
    const dispatch = vi.fn().mockResolvedValue(result)
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const write = vi.fn()
    const loadRuntime = vi.fn().mockResolvedValue({ dispatch, disconnect })
    const retryNow = new Date("2026-09-29T12:10:00.000Z")

    for (const now of [NOW, retryNow]) {
      await expect(
        runCowatchShadowEvaluationCli(ARGS, {
          now: () => now,
          write,
          loadRuntime,
        }),
      ).resolves.toEqual(result)
    }
    const tuple = parseCowatchShadowEvaluationArguments(ARGS, NOW)
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      ...tuple,
      actorId: "cowatch-shadow-cli",
      now: NOW,
    })
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      ...tuple,
      actorId: "cowatch-shadow-cli",
      now: retryNow,
    })
    expect(JSON.parse(write.mock.calls[1][0])).toEqual(result)
    expect(JSON.parse(write.mock.calls[3][0])).toEqual(result)
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
