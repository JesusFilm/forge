import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import {
  parseCowatchRebuildArguments,
  cowatchRebuildFailureReceipt,
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
const admissionDirectory = mkdtempSync(
  join(tmpdir(), "forge-cowatch-admission-"),
)
afterAll(() => rmSync(admissionDirectory, { recursive: true, force: true }))

function validAdmission() {
  return {
    version: "cowatch-publication-admission-v1",
    expectedGeneration: "a".repeat(64),
    sourceWindow: {
      version: "episode-event-window-v1",
      windowStart: ARGS[1],
      windowEnd: ARGS[3],
      evaluationAsOf: ARGS[5],
    },
    limits: {
      rawSourceCount: 7,
      sourceCount: 6,
      attemptedPairCount: 3,
      contributionCount: 3,
      edgeCount: 1,
      publicationRowCount: 11,
      graphRowJsonBytes: {
        sources: { maximum: 100, total: 600 },
        contributions: { maximum: 100, total: 300 },
        edges: { maximum: 100, total: 100 },
      },
    },
  }
}

describe("finite co-watch rebuild CLI", () => {
  it("retains bounded failure classifications without private diagnostics", () => {
    const secret = "postgresql://private-user:private-password@private-host/db"
    expect(
      cowatchRebuildFailureReceipt({
        code: "P2010",
        message: secret,
        meta: { code: "57014", message: `SQL and credentials: ${secret}` },
      }),
    ).toEqual({
      status: "failed",
      category: "database_timeout",
      code: "57014",
      diagnosticsRedacted: true,
    })
    expect(
      cowatchRebuildFailureReceipt({
        cause: { code: "SELF_SIGNED_CERT_IN_CHAIN", message: secret },
      }),
    ).toMatchObject({
      category: "database_tls",
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    })
    expect(cowatchRebuildFailureReceipt(new Error(secret))).toEqual({
      status: "failed",
      category: "unknown",
      code: null,
      diagnosticsRedacted: true,
    })
    expect(
      cowatchRebuildFailureReceipt({ code: "P1001", message: secret }),
    ).toMatchObject({ category: "database_connection", code: "P1001" })
    expect(
      cowatchRebuildFailureReceipt({
        code: "P1011",
        cause: new Error("The server does not support SSL connections"),
      }),
    ).toMatchObject({ category: "database_tls_unavailable", code: "P1011" })
  })

  it("does not evaluate hostile getters or follow cyclic diagnostics indefinitely", () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.cause = cyclic
    Object.defineProperty(cyclic, "code", {
      get() {
        throw new Error("private error accessor")
      },
    })
    expect(cowatchRebuildFailureReceipt(cyclic)).toMatchObject({
      category: "unknown",
      code: null,
    })
    expect(
      cowatchRebuildFailureReceipt(
        new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error("private prototype")
            },
            getOwnPropertyDescriptor() {
              throw new Error("private descriptor")
            },
          },
        ),
      ),
    ).toMatchObject({ category: "unknown", code: null })
  })

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
    [...ARGS, "--admission-file", "admission.json"],
    [...ARGS, "--execute", "--admission-file"],
    [...ARGS, "--execute", "--admission-file", "a", "--admission-file", "b"],
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

  it("passes an exact validated admission to publication and emits a refusal unchanged", async () => {
    const admission = validAdmission()
    const path = join(admissionDirectory, "valid.json")
    writeFileSync(path, JSON.stringify(admission), { mode: 0o600 })
    const refusal = {
      status: "admission_refused",
      publishedAt: null,
      decisionReason: "publication_admission_generation_changed",
    }
    const runtime = {
      preflight: vi.fn(),
      publish: vi.fn().mockResolvedValue(refusal),
      disconnect: vi.fn(),
    }
    const write = vi.fn()
    await expect(
      runCowatchRebuildCli([...ARGS, "--execute", "--admission-file", path], {
        now: () => NOW,
        loadRuntime: async () => runtime,
        write,
      }),
    ).resolves.toEqual(refusal)
    expect(runtime.publish).toHaveBeenCalledWith(
      NOW,
      parseCowatchRebuildArguments(ARGS, NOW).sourceWindow,
      admission,
    )
    expect(runtime.preflight).not.toHaveBeenCalled()
    expect(runtime.disconnect).toHaveBeenCalledOnce()
    expect(JSON.parse(write.mock.calls[0][0])).toEqual(refusal)
  })

  it.each([
    "malformed",
    "oversized",
    "unknown_root",
    "unknown_limit",
    "unknown_width",
    "wrong_version",
    "wrong_generation",
    "wrong_scope",
    "raw_overflow",
    "pair_overflow",
    "negative",
    "fractional",
    "unsafe_width",
    "missing_width",
  ])(
    "rejects %s admission before loading the database runtime",
    async (kind) => {
      const admission = validAdmission()
      let value: unknown = admission
      if (kind === "unknown_root") value = { ...admission, execute: true }
      if (kind === "unknown_limit")
        value = { ...admission, limits: { ...admission.limits, maxRows: 1 } }
      if (kind === "unknown_width")
        Object.assign(admission.limits.graphRowJsonBytes.sources, { extra: 1 })
      if (kind === "wrong_version") admission.version = "unsupported"
      if (kind === "wrong_generation")
        admission.expectedGeneration = "private-data"
      if (kind === "wrong_scope")
        admission.sourceWindow.windowStart = "2026-09-23T00:00:00.000Z"
      if (kind === "raw_overflow") admission.limits.rawSourceCount = 50_001
      if (kind === "pair_overflow")
        admission.limits.attemptedPairCount = 250_001
      if (kind === "negative") admission.limits.sourceCount = -1
      if (kind === "fractional") admission.limits.edgeCount = 1.5
      if (kind === "unsafe_width")
        admission.limits.graphRowJsonBytes.sources.total =
          Number.MAX_SAFE_INTEGER + 1
      if (kind === "missing_width")
        value = {
          ...admission,
          limits: { ...admission.limits, graphRowJsonBytes: null },
        }
      const path = join(admissionDirectory, `${kind}.json`)
      writeFileSync(
        path,
        kind === "malformed"
          ? "private invalid JSON"
          : kind === "oversized"
            ? " ".repeat(16_385)
            : JSON.stringify(value),
      )
      const loadRuntime = vi.fn()
      await expect(
        runCowatchRebuildCli([...ARGS, "--execute", "--admission-file", path], {
          now: () => NOW,
          loadRuntime,
        }),
      ).rejects.toThrow("Invalid publication admission file")
      expect(loadRuntime).not.toHaveBeenCalled()
    },
  )

  it("refuses missing and non-regular admission files before loading the runtime", async () => {
    for (const path of [
      join(admissionDirectory, "absent"),
      admissionDirectory,
    ]) {
      const loadRuntime = vi.fn()
      await expect(
        runCowatchRebuildCli([...ARGS, "--execute", "--admission-file", path], {
          now: () => NOW,
          loadRuntime,
        }),
      ).rejects.toThrow(/publication admission file/)
      expect(loadRuntime).not.toHaveBeenCalled()
    }
  })
})
