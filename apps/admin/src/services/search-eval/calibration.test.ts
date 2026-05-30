import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CALIBRATION_PASS_THRESHOLD,
  CalibrationLoadError,
  loadCalibrationCases,
  runCalibration,
} from "./calibration"
import type { Judge, JudgeVerdictResult } from "./judge"
import type { CalibrationCase, SearchResult, Verdict } from "./types"

const sampleResult: SearchResult = {
  type: "video",
  id: "v_1",
  slug: "easter",
  title: "Easter",
  imageUrl: null,
  snippet: "About Easter",
  startSeconds: 0,
  playbackId: null,
  score: 0.5,
  label: null,
  durationSeconds: null,
  childCount: null,
}

function makeCase(
  id: string,
  expected: Verdict,
  overrides: Partial<CalibrationCase> = {},
): CalibrationCase {
  return {
    id,
    query: "easter",
    locale: "en",
    expected,
    rationale: "test",
    listA: [sampleResult],
    listB: [{ ...sampleResult, id: "v_2" }],
    ...overrides,
  }
}

function judgeStub(
  responses: Verdict[] | ((c: CalibrationCase) => Verdict),
): Judge {
  let i = 0
  const judgePair = vi.fn(async (input: { query: string }) => {
    let verdict: Verdict
    if (typeof responses === "function") {
      // Find the case whose query matches; fall back to first.
      verdict = responses({ query: input.query } as unknown as CalibrationCase)
    } else {
      verdict = responses[i++] ?? "tie"
    }
    return {
      verdict,
      rationale: "stub",
      tokens: { input: 10, output: 5 },
      attempts: 1,
      model: "stub-model",
    } satisfies JudgeVerdictResult
  })
  return { model: "stub-model", judgePair }
}

const muteLogger = { warn: vi.fn(), info: vi.fn() }

describe("loadCalibrationCases", () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "calibration-test-"))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it("loads valid cases from a file", async () => {
    const file = path.join(tmp, "calibration.json")
    await writeFile(
      file,
      JSON.stringify({
        cases: [makeCase("c1", "tie")],
      }),
    )
    const out = await loadCalibrationCases({ filePath: file })
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe("c1")
  })

  it("throws on missing file", async () => {
    await expect(
      loadCalibrationCases({ filePath: path.join(tmp, "absent.json") }),
    ).rejects.toBeInstanceOf(CalibrationLoadError)
  })

  it("throws on invalid JSON", async () => {
    const file = path.join(tmp, "bad.json")
    await writeFile(file, "not json {")
    await expect(
      loadCalibrationCases({ filePath: file }),
    ).rejects.toMatchObject({ code: "invalid_json" })
  })

  it("throws on schema mismatch", async () => {
    const file = path.join(tmp, "wrong.json")
    await writeFile(
      file,
      JSON.stringify({ cases: [{ id: "c1" /* missing fields */ }] }),
    )
    await expect(
      loadCalibrationCases({ filePath: file }),
    ).rejects.toMatchObject({ code: "validation" })
  })

  it("rejects an unknown verdict in expected", async () => {
    const file = path.join(tmp, "bad.json")
    await writeFile(
      file,
      JSON.stringify({
        cases: [{ ...makeCase("c1", "tie"), expected: "DEFINITELY-A" }],
      }),
    )
    await expect(
      loadCalibrationCases({ filePath: file }),
    ).rejects.toMatchObject({ code: "validation" })
  })
})

describe("runCalibration", () => {
  it("returns passed=true when all cases match", async () => {
    const cases = [
      makeCase("c1", "tie"),
      makeCase("c2", "clearly-A-better"),
      makeCase("c3", "both-irrelevant"),
    ]
    const judge = judgeStub(["tie", "clearly-A-better", "both-irrelevant"])

    const report = await runCalibration(judge, {
      cases,
      logger: muteLogger,
    })
    expect(report.passed).toBe(true)
    expect(report.matched).toBe(3)
    expect(report.total).toBe(3)
    expect(report.cases.every((c) => c.pass)).toBe(true)
  })

  it("passes at exactly 80% match", async () => {
    // 8 cases, 8 expected verdicts → 80% pass = passed
    const cases = Array.from({ length: 10 }, (_, i) => makeCase(`c${i}`, "tie"))
    // 8 ties, 2 wrong
    const judge = judgeStub([
      "tie",
      "tie",
      "tie",
      "tie",
      "tie",
      "tie",
      "tie",
      "tie",
      "clearly-A-better",
      "clearly-A-better",
    ])

    const report = await runCalibration(judge, {
      cases,
      logger: muteLogger,
    })
    expect(report.matched).toBe(8)
    expect(report.passed).toBe(true)
    expect(report.matched / report.total).toBeGreaterThanOrEqual(
      CALIBRATION_PASS_THRESHOLD,
    )
  })

  it("fails below 80%", async () => {
    const cases = Array.from({ length: 10 }, (_, i) => makeCase(`c${i}`, "tie"))
    // 6 correct, 4 wrong → 60%
    const judge = judgeStub([
      "tie",
      "tie",
      "tie",
      "tie",
      "tie",
      "tie",
      "clearly-A-better",
      "clearly-A-better",
      "clearly-A-better",
      "clearly-A-better",
    ])

    const report = await runCalibration(judge, {
      cases,
      logger: muteLogger,
    })
    expect(report.matched).toBe(6)
    expect(report.passed).toBe(false)
  })

  it("emits structured failure log on fail", async () => {
    const log = { warn: vi.fn(), info: vi.fn() }
    const cases = [
      makeCase("c1", "tie"),
      makeCase("c2", "tie"),
      makeCase("c3", "tie"),
    ]
    const judge = judgeStub([
      "clearly-A-better",
      "clearly-A-better",
      "clearly-A-better",
    ])

    await runCalibration(judge, { cases, logger: log })

    const failureLine = log.warn.mock.calls.find((c) =>
      String(c[0]).includes("event=judge_calibration_failure"),
    )
    expect(failureLine).toBeDefined()
  })

  it("emits structured pass log on pass", async () => {
    const log = { warn: vi.fn(), info: vi.fn() }
    const judge = judgeStub(["tie"])

    await runCalibration(judge, {
      cases: [makeCase("c1", "tie")],
      logger: log,
    })

    const passLine = log.info.mock.calls.find((c) =>
      String(c[0]).includes("event=judge_calibration_pass"),
    )
    expect(passLine).toBeDefined()
  })

  it("treats judge errors as case failures (does not abort)", async () => {
    const log = { warn: vi.fn(), info: vi.fn() }
    const judgePair = vi.fn().mockRejectedValue(new Error("openrouter-down"))
    const judge: Judge = { model: "stub", judgePair }

    const report = await runCalibration(judge, {
      cases: [makeCase("c1", "tie")],
      logger: log,
    })

    expect(report.cases[0]?.pass).toBe(false)
    expect(judgePair).toHaveBeenCalledTimes(1)
  })

  it("returns passed=true with empty case list (with warning)", async () => {
    const log = { warn: vi.fn(), info: vi.fn() }
    const judge = judgeStub([])

    const report = await runCalibration(judge, {
      cases: [],
      logger: log,
    })

    expect(report.passed).toBe(true)
    expect(report.total).toBe(0)
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("event=judge_calibration_skipped"),
    )
  })
})
