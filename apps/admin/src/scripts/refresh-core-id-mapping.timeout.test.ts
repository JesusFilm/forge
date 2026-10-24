/**
 * Timeout-path test for runDumpCommand.
 *
 * Runs in a separate file so DUMP_TIMEOUT_MS can be overridden at import
 * time (the CLI reads process.env.DUMP_TIMEOUT_MS once when the module is
 * evaluated; vitest's per-file module-graph isolation gives us a clean
 * slate here).
 */

import type { ChildProcess } from "node:child_process"
import { describe, expect, it, vi } from "vitest"

// Force a short timeout BEFORE the dynamic import so the module evaluates
// its DUMP_TIMEOUT_MS closure with this value.
process.env.DUMP_TIMEOUT_MS = "50"

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn }))

const { spawn: realSpawn } =
  await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  )

const { runDumpCommand } = await import("./refresh-core-id-mapping")

describe("runDumpCommand — timeout path", () => {
  it("rejects with a SIGTERM-exceeded message when the child ignores SIGTERM past DUMP_TIMEOUT_MS", async () => {
    spawn.mockImplementationOnce(
      (): ChildProcess =>
        // Long-running child with a SIGTERM handler that does nothing so
        // the timeout path has to fire. The child will eventually be
        // SIGKILLed after the 5s escalation, but the outer promise rejects
        // on SIGTERM-dispatch so the test doesn't wait that long.
        realSpawn(
          process.execPath,
          [
            "-e",
            "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60000)",
          ],
          { stdio: "ignore" },
        ),
    )

    await expect(runDumpCommand("/tmp/ignored")).rejects.toThrow(
      /cms dump exceeded 50ms; sent SIGTERM/,
    )
  })
})
