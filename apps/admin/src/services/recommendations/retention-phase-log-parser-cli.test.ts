import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  createRetentionPhaseRecorder,
  formatRetentionPhaseFailureLog,
} from "./retention-phase-diagnostics"

const event = JSON.stringify({
  message: formatRetentionPhaseFailureLog({
    ...createRetentionPhaseRecorder().diagnostic(
      "scheduled",
      { phase: new Error("private-error") },
      { outcome: "succeeded", elapsedMs: 1 },
    ),
    suppressedPriorMinute: 0,
  }),
})

function run(input: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("scripts/parse-recommendation-retention-phase-logs.ts"),
    ],
    { cwd: resolve("."), input, encoding: "utf8", maxBuffer: 1024 * 1024 },
  )
  expect(result.status).toBe(0)
  expect(result.stderr).not.toContain("private-error")
  expect(result.stdout).not.toContain("private-error")
  return result
}

describe("bounded retention provider-log parser command", () => {
  it("flushes a version two diagnostic through the actual manual CLI exit path", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "retention-cli-diag-"))
    const preload = resolve(directory, "mock-job.cjs")
    // Replace only the DB/job imports. Run the real CLI, flushing, process.exit
    // and strict parser; no database or cleanup process is launched by this test.
    const jobSource = `
      import { createRequire } from 'node:module';
      const require=createRequire(import.meta.url);
      export async function runManualRecommendationRetentionOnce() {
        const {createRetentionDecisionObservation}=require(${JSON.stringify(resolve("src/services/recommendations/retention-operation-diagnostics.ts"))});
        const {createRetentionPhaseRecorder,formatRetentionPhaseFailureLog}=require(${JSON.stringify(resolve("src/services/recommendations/retention-phase-diagnostics.ts"))});
        const observer=createRetentionDecisionObservation('manual-cli');
        observer.record('select');observer.record('selected',100);observer.record('update');
        const event={...createRetentionPhaseRecorder().diagnostic('stored-expiry-only',{phase:new Error('private-error')},{outcome:'succeeded',elapsedMs:1},observer.finish(false)),suppressedPriorMinute:0};
        console.error(formatRetentionPhaseFailureLog(event));
        throw new Error('private-error');
      }
    `
    writeFileSync(
      preload,
      `
      require('node:module').registerHooks({load(url,context,nextLoad) {
        if(url.endsWith('/db/client.ts')) return {format:'module',source:'export const prisma={$disconnect:async()=>{}}',shortCircuit:true};
        if(url.endsWith('/retention/job.ts')) return {format:'module',source:${JSON.stringify(jobSource)},shortCircuit:true};
        return nextLoad(url,context);
      }});
    `,
    )
    try {
      const child = spawnSync(
        process.execPath,
        [
          "--require",
          preload,
          "--import",
          "tsx",
          resolve("src/scripts/run-recommendation-retention-once.ts"),
          "--expired-only",
        ],
        {
          cwd: resolve("."),
          encoding: "utf8",
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        },
      )
      expect(child.status, child.stderr).toBe(1)
      expect(child.stdout).toBe("")
      expect(child.stderr).toContain("Manual retention failed;")
      expect(child.stderr).not.toContain("private-error")
      expect(child.stderr).toContain(
        "event=recommendation_retention_phase_failure",
      )
      const parsed = run(child.stderr)
      expect(JSON.parse(parsed.stdout)).toMatchObject({
        version: 2,
        decisionOperation: {
          boundary: "update",
          executionContext: "manual-cli",
          scope: "executing-process-wide-decision-operation",
          gcAttribution: "unmeasured",
        },
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("discards an oversized complete line and still accepts a later valid event", () => {
    const result = run(`${"private-oversized".repeat(1200)}\n${event}\n`)
    expect(result.stdout.trim().split("\n")).toHaveLength(1)
    expect(result.stderr).toContain("inspected=2 validated=1 oversized=1")
    expect(result.stderr).toContain("capped=false")
    expect(result.stdout + result.stderr).not.toContain("private-oversized")
  })

  it("keeps a preceding valid event and discards an unfinished line", () => {
    const result = run(`${event}\nprivate-unterminated`)
    expect(result.stdout.trim().split("\n")).toHaveLength(1)
    expect(result.stderr).toContain("inspected=1 validated=1")
    expect(result.stderr).toContain("unfinished=true")
    expect(result.stdout + result.stderr).not.toContain("private-unterminated")
  })

  it("bounds an oversized unfinished line and total input before parsing", () => {
    const result = run("private-huge".repeat(200_000))
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(
      "unfinished=true capped=true cap_reason=total_bytes",
    )
    expect(result.stdout + result.stderr).not.toContain("private-huge")
  })

  it("reports line and event caps without accepting later events", () => {
    const lines = run(`${"ignored\n".repeat(999)}${event}\n${event}\n`)
    expect(lines.stdout.trim().split("\n")).toHaveLength(1)
    expect(lines.stderr).toContain("inspected=1000 validated=1")
    expect(lines.stderr).toContain("cap_reason=lines")

    const events = run(`${event}\n`.repeat(101))
    expect(events.stdout.trim().split("\n")).toHaveLength(100)
    expect(events.stderr).toContain("inspected=100 validated=100")
    expect(events.stderr).toContain("cap_reason=events")
  })
})
