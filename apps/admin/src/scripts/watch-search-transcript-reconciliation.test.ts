import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  parseArgs,
  resolveReportOutPath,
  writeReportToPath,
} from "./watch-search-transcript-reconciliation"

const fixedNow = new Date("2026-10-22T00:00:00.000Z")

describe("watch-search-transcript-reconciliation CLI", () => {
  it("defaults to dry-run with a timestamped report path", () => {
    const args = parseArgs([], fixedNow)
    expect(args.execute).toBe(false)
    expect(args.reportOutPath).toBe(
      resolve(
        process.cwd(),
        ".tmp/watch-search-transcript-reconciliation/2026-10-22T00-00-00-000Z.json",
      ),
    )
  })

  it("parses --execute and an explicit --report-out path", () => {
    const args = parseArgs(["--execute", "--report-out=out/report.json"])
    expect(args.execute).toBe(true)
    expect(args.reportOutPath).toBe(resolve(process.cwd(), "out/report.json"))
  })

  it("keeps an absolute --report-out path unresolved", () => {
    expect(resolveReportOutPath("/tmp/report.json")).toBe("/tmp/report.json")
  })

  describe("writeReportToPath", () => {
    let dir: string

    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true })
    })

    it("writes the report as formatted JSON, creating parent directories", async () => {
      dir = await mkdtemp(join(tmpdir(), "watch-search-reconciliation-"))
      const path = join(dir, "nested", "report.json")

      const result = await writeReportToPath(path, { ok: true, count: 1 })

      expect(result).toEqual({ ok: true })
      const contents = await readFile(path, "utf8")
      expect(JSON.parse(contents)).toEqual({ ok: true, count: 1 })
    })
  })
})
