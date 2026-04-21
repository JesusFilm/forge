/**
 * Tests for the refresh CLI child-process orchestration.
 *
 * Exercises runDumpCommand against a tiny in-process node subprocess rather
 * than mocking the full spawn protocol, so the exit/error event wiring and
 * signal cleanup are covered end-to-end.
 */

import type { ChildProcess } from "node:child_process"
import { describe, expect, it, vi, beforeEach } from "vitest"

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))

vi.mock("node:child_process", () => ({ spawn }))

// Reach past the vi.mock hoist for an unmocked spawn so tests can drive
// real (but trivial) subprocesses.
const { spawn: realSpawn } =
  await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  )

const { runDumpCommand } = await import("./refresh-core-id-mapping")

function spawnQuickChild(code: string): ChildProcess {
  return realSpawn(process.execPath, ["-e", code], { stdio: "ignore" })
}

describe("runDumpCommand", () => {
  beforeEach(() => {
    spawn.mockReset()
  })

  it("resolves when the child exits with code 0", async () => {
    spawn.mockImplementationOnce(() => spawnQuickChild("process.exit(0)"))

    await expect(runDumpCommand("/tmp/ignored")).resolves.toBeUndefined()
  })

  it("rejects with a clear message when the child exits non-zero", async () => {
    spawn.mockImplementationOnce(() => spawnQuickChild("process.exit(3)"))

    await expect(runDumpCommand("/tmp/ignored")).rejects.toThrow(
      /cms dump exited with code 3/,
    )
  })

  it("rejects with the signal name when the child is killed by a signal", async () => {
    spawn.mockImplementationOnce(() => {
      const child = spawnQuickChild("setTimeout(() => {}, 60000)")
      // Schedule kill after spawn returns so runDumpCommand's listeners
      // are attached first.
      setImmediate(() => child.kill("SIGKILL"))
      return child
    })

    await expect(runDumpCommand("/tmp/ignored")).rejects.toThrow(
      /cms dump exited with signal SIGKILL/,
    )
  })
})
