import { describe, expect, it, vi } from "vitest"
import {
  parseCowatchRebuildArguments,
  runCowatchRebuildCli,
} from "./rebuild-recommendation-cowatch-shadow"
import type { CowatchPublication } from "../services/recommendations/cowatch/projection.service"

const NOW = new Date("2026-09-29T12:00:00.000Z")
const ARGS = [
  "--window-start",
  "2026-09-22T00:00:00.000Z",
  "--window-end",
  "2026-09-29T00:00:00.000Z",
  "--evaluation-as-of",
  "2026-09-29T12:00:00.000Z",
]

describe("finite co-watch rebuild CLI", () => {
  it("keeps the exact requested scope and defaults to read-only preflight", async () => {
    const { sourceWindow } = parseCowatchRebuildArguments(ARGS, NOW)
    const receipt: Omit<CowatchPublication, "status"> & { status: "ready" } = {
      status: "ready",
      generation: "a".repeat(64),
      rawSourceCount: 7,
      rawSourceCountIsLowerBound: false,
      sourceCount: 6,
      attemptedPairCount: 3,
      contributionCount: 3,
      edgeCount: 1,
      publicationRowCount: 11,
      sourceWindow,
      publishedAt: null,
      terminalDecision: "no_promotion",
      decisionReason: "complete_bounded_population_preflight",
    }
    const runtime = {
      preflight: vi.fn().mockResolvedValue(receipt),
      publish: vi.fn().mockResolvedValue({ ...receipt, status: "published" }),
      disconnect: vi.fn(),
    }
    const write = vi.fn()
    await runCowatchRebuildCli(ARGS, {
      now: () => NOW,
      loadRuntime: async () => runtime,
      write,
    })
    expect(runtime.preflight).toHaveBeenCalledWith(NOW, sourceWindow)
    expect(runtime.publish).not.toHaveBeenCalled()
    expect(runtime.disconnect).toHaveBeenCalledOnce()
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({
      status: "ready",
      publishedAt: null,
      sourceWindow: { windowStart: ARGS[1], windowEnd: ARGS[3] },
    })
    await runCowatchRebuildCli([...ARGS, "--execute"], {
      now: () => NOW,
      loadRuntime: async () => runtime,
      write,
    })
    expect(runtime.publish).toHaveBeenCalledWith(NOW, sourceWindow)
  })

  it.each([
    [],
    ["--execute"],
    [...ARGS, "--execute", "--execute"],
    [...ARGS, "--window-end", ARGS[3]],
    [...ARGS, "--surprise"],
    ARGS.slice(0, -1),
    ["--window-start", "2026-09-22", ...ARGS.slice(2)],
    ["--window-start", "2026-09-22T00:00:00.0001Z", ...ARGS.slice(2)],
    ["--window-start", ARGS[3], ...ARGS.slice(2)],
    ["--window-start", "2026-01-01T00:00:00.000Z", ...ARGS.slice(2)],
    [...ARGS.slice(0, -1), "2026-09-30T00:00:00.000Z"],
    [...ARGS.slice(0, -1), "2026-09-28T00:00:00.000Z"],
  ])(
    "rejects invalid or incomplete scope before opening the database: %j",
    async (...args) => {
      const loadRuntime = vi.fn()
      await expect(
        runCowatchRebuildCli(args, { now: () => NOW, loadRuntime }),
      ).rejects.toThrow()
      expect(loadRuntime).not.toHaveBeenCalled()
    },
  )

  it("allows explicit windows longer than the seven-day first-production proposal", () => {
    expect(
      parseCowatchRebuildArguments(
        ["--window-start", "2026-09-01T00:00:00.000Z", ...ARGS.slice(2)],
        NOW,
      ).sourceWindow.windowStart.toISOString(),
    ).toBe("2026-09-01T00:00:00.000Z")
  })

  it("disconnects after a database error without emitting a successful receipt", async () => {
    const runtime = {
      preflight: vi.fn().mockRejectedValue(new Error("fixture failure")),
      publish: vi.fn(),
      disconnect: vi.fn(),
    }
    const write = vi.fn()
    await expect(
      runCowatchRebuildCli(ARGS, {
        now: () => NOW,
        loadRuntime: async () => runtime,
        write,
      }),
    ).rejects.toThrow("fixture failure")
    expect(runtime.disconnect).toHaveBeenCalledOnce()
    expect(write).not.toHaveBeenCalled()
  })
})
