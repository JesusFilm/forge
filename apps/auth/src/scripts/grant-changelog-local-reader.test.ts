import { PassThrough } from "node:stream"

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  handleOutputError,
  runGrantChangelogLocalReaderCommand,
} from "./grant-changelog-local-reader"

const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
}))

vi.mock("@/services/changelog-local-reader-grant.service", () => ({
  grantChangelogLocalReader: mocks.grant,
}))

vi.mock("@/db/client", () => ({
  prisma: { $disconnect: vi.fn() },
}))

function command(input: string, argv: readonly string[] = []) {
  const stdout = vi.fn()
  const stderr = vi.fn()

  return {
    result: runGrantChangelogLocalReaderCommand({
      argv,
      readEmail: vi.fn().mockResolvedValue(input),
      writeOutput: stdout,
      writeError: stderr,
    }),
    stdout,
    stderr,
  }
}

describe("runGrantChangelogLocalReaderCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects arguments without prompting or granting", async () => {
    const readEmail = vi.fn()
    const writeError = vi.fn()

    await expect(
      runGrantChangelogLocalReaderCommand({
        argv: ["developer@example.com"],
        readEmail,
        writeOutput: vi.fn(),
        writeError,
      }),
    ).resolves.toBe(1)

    expect(readEmail).not.toHaveBeenCalled()
    expect(mocks.grant).not.toHaveBeenCalled()
    expect(writeError).toHaveBeenCalledWith(
      "Usage: pnpm --filter @forge/auth changelog:grant-local-reader\n",
    )
  })

  it.each(["", "not-an-email", "has spaces@example.com"])(
    "rejects invalid prompted input before granting: %j",
    async (input) => {
      const { result, stderr } = command(input)

      await expect(result).resolves.toBe(1)
      expect(mocks.grant).not.toHaveBeenCalled()
      expect(stderr).toHaveBeenCalledWith(
        "Could not grant Local Changelog Reader access: enter a valid email address.\n",
      )
    },
  )

  it("reports a changed grant without exposing the complete email", async () => {
    mocks.grant.mockResolvedValue({ changed: true })
    const { result, stdout, stderr } = command("Developer@Example.com")

    await expect(result).resolves.toBe(0)
    expect(mocks.grant).toHaveBeenCalledWith("Developer@Example.com")
    expect(stdout).toHaveBeenCalledWith(
      "Granted Local Changelog Reader access to d***@e***.com.\n",
    )
    expect(stdout.mock.calls.join(" ")).not.toContain("developer@example.com")
    expect(stderr).not.toHaveBeenCalled()
  })

  it("reports existing Reader-or-higher access as a successful no-op", async () => {
    mocks.grant.mockResolvedValue({ changed: false })
    const { result, stdout, stderr } = command("developer@example.com")

    await expect(result).resolves.toBe(0)
    expect(stdout).toHaveBeenCalledWith(
      "No change: d***@e***.com already has Local Changelog Reader-or-higher access.\n",
    )
    expect(stderr).not.toHaveBeenCalled()
  })

  it("ignores EPIPE emitted by an output stream", () => {
    const output = new PassThrough()
    output.on("error", handleOutputError)

    expect(() =>
      output.emit(
        "error",
        Object.assign(new Error("EPIPE"), { code: "EPIPE" }),
      ),
    ).not.toThrow()
  })

  it("does not swallow other output stream errors", () => {
    const output = new PassThrough()
    const error = Object.assign(new Error("output failed"), { code: "EIO" })
    output.on("error", handleOutputError)

    expect(() => output.emit("error", error)).toThrow(error)
  })

  it("hides identity, connection details, IDs, and database errors", async () => {
    const databaseUrl = "postgresql://operator:secret@db.internal/auth"
    mocks.grant.mockRejectedValue(
      new Error(
        `user_internal_123 developer@example.com failed at ${databaseUrl}`,
      ),
    )
    const { result, stdout, stderr } = command("developer@example.com")

    await expect(result).resolves.toBe(1)
    expect(stdout).not.toHaveBeenCalled()
    const message = stderr.mock.calls.join(" ")
    expect(message).toContain("Could not grant Local Changelog Reader access.")
    expect(message).not.toContain("developer@example.com")
    expect(message).not.toContain("user_internal_123")
    expect(message).not.toContain(databaseUrl)
    expect(message).not.toContain("failed at")
  })
})
