// Promise-ownership guard for the Watch catch-all route (FGE-158 / feat-685).
//
// Vitest intercepts `unhandledRejection` inside its workers, so an orphaned
// rejection cannot be observed there. Each case runs the REAL
// `[...rest]/page.tsx` in a plain Node child (tsx, with synthetic stubs for the
// network-bound dependencies in ./catch-all-route-rejection/) and reads Node's
// own `unhandledRejection` events from the child's report.
//
// Scope: the route function's promise ownership only. Not Next, ISR, the proxy,
// or any real Admin / LaunchDarkly call.
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const harness = join(here, "catch-all-route-rejection")

function runChild(scenario) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      join(harness, "hooks.mjs"),
      join(harness, "child.tsx"),
      scenario,
    ],
    { cwd: join(here, ".."), encoding: "utf8", timeout: 30_000 },
  )
  // Fail loudly on harness problems so they are not mistaken for a regression.
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`child exited ${result.status}\n${result.stderr}`)
  }
  const line = result.stdout.trim().split("\n").at(-1) ?? ""
  try {
    return JSON.parse(line)
  } catch {
    throw new Error(
      `child printed no JSON report\n${result.stdout}\n${result.stderr}`,
    )
  }
}

describe("catch-all route promise ownership (plain Node child)", () => {
  it("does not leave a translator rejection unhandled while client messages load, and still surfaces it", () => {
    const report = runChild("translator-rejects-during-client-hold")
    expect(report.unhandled).toEqual([])
    expect(report.error).toBe("synthetic translator failure")
  })

  it("does not leave a late translator rejection unhandled after the client-message load failed", () => {
    const report = runChild("client-rejects-then-translator-rejects")
    expect(report.unhandled).toEqual([])
    expect(report.error).toBe("synthetic client-messages failure")
  })

  it("keeps the client-message error as the winner when both inputs reject", () => {
    const report = runChild("both-reject-translator-first")
    expect(report.unhandled).toEqual([])
    expect(report.error).toBe("synthetic client-messages failure")
  })

  it("renders the translated markup and starts both inputs before either settles", () => {
    const report = runChild("success")
    expect(report.unhandled).toEqual([])
    expect(report.error).toBeUndefined()
    const at = (event) => report.calls.indexOf(event)
    expect(report.calls).toHaveLength(4)
    expect(
      Math.max(at("translator:start"), at("client-messages:start")),
    ).toBeLessThan(Math.min(at("translator:end"), at("client-messages:end")))
    expect(report.markup).toBe(
      '<p data-fixture="audio-count">2,285 audio translations</p>',
    )
  })
}, 60_000)
