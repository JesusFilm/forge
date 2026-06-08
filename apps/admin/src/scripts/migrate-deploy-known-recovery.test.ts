import { describe, expect, it, vi } from "vitest"

import {
  RECOVERABLE_MIGRATION,
  RECOVERABLE_MIGRATIONS,
  deployWithKnownRecovery,
  getKnownRecoverableP3009Migration,
  isKnownRecoverableP3009,
  type CommandResult,
} from "./migrate-deploy-known-recovery"

describe("isKnownRecoverableP3009", () => {
  it("matches only P3009 output for known recoverable migrations", () => {
    expect(
      isKnownRecoverableP3009(`Error code: P3009 ${RECOVERABLE_MIGRATION}`),
    ).toBe(true)
    expect(
      isKnownRecoverableP3009(`Error code: P3009 ${RECOVERABLE_MIGRATIONS[1]}`),
    ).toBe(true)
    expect(isKnownRecoverableP3009(`Error code: P3009 0001_init`)).toBe(false)
    expect(
      isKnownRecoverableP3009(`Error code: P3018 ${RECOVERABLE_MIGRATION}`),
    ).toBe(false)
  })
})

describe("getKnownRecoverableP3009Migration", () => {
  it("returns the migration named in the P3009 output", () => {
    expect(
      getKnownRecoverableP3009Migration(
        `Error code: P3009 ${RECOVERABLE_MIGRATIONS[1]}`,
      ),
    ).toBe(RECOVERABLE_MIGRATIONS[1])
  })
})

describe("deployWithKnownRecovery", () => {
  const result = (code: number, output = ""): CommandResult => ({
    code,
    output,
  })

  it("does not run recovery when migrate deploy succeeds", async () => {
    const runner = vi.fn().mockResolvedValueOnce(result(0))

    await deployWithKnownRecovery(runner)

    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner).toHaveBeenCalledWith(["migrate", "deploy"])
  })

  it("resolves the known failed migration and retries deploy", async () => {
    const migration = RECOVERABLE_MIGRATIONS[1]
    const runner = vi
      .fn()
      .mockResolvedValueOnce(result(1, `P3009 ${migration}`))
      .mockResolvedValueOnce(result(0))
      .mockResolvedValueOnce(result(0))

    await deployWithKnownRecovery(runner)

    expect(runner).toHaveBeenNthCalledWith(1, ["migrate", "deploy"])
    expect(runner).toHaveBeenNthCalledWith(2, [
      "migrate",
      "resolve",
      "--rolled-back",
      migration,
    ])
    expect(runner).toHaveBeenNthCalledWith(3, ["migrate", "deploy"])
  })

  it("does not resolve unrelated migration failures", async () => {
    const runner = vi.fn().mockResolvedValueOnce(result(1, "P3018"))

    await expect(deployWithKnownRecovery(runner)).rejects.toThrow(
      /without known P3009 recovery/,
    )

    expect(runner).toHaveBeenCalledTimes(1)
  })

  it("fails when known migration resolve fails", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce(result(1, `P3009 ${RECOVERABLE_MIGRATION}`))
      .mockResolvedValueOnce(result(1, "resolve failed"))
      .mockResolvedValueOnce(result(1, "still failed"))

    await expect(deployWithKnownRecovery(runner)).rejects.toThrow(
      /resolve --rolled-back/,
    )
  })

  it("tolerates another replica resolving the migration first", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce(result(1, `P3009 ${RECOVERABLE_MIGRATION}`))
      .mockResolvedValueOnce(result(1, "migration is not failed"))
      .mockResolvedValueOnce(result(0))

    await deployWithKnownRecovery(runner)

    expect(runner).toHaveBeenNthCalledWith(3, ["migrate", "deploy"])
  })
})
