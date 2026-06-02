import { describe, expect, it, vi } from "vitest"

import {
  RECOVERABLE_MIGRATION,
  deployWithKnownRecovery,
  isKnownRecoverableP3009,
  type CommandResult,
} from "./migrate-deploy-known-recovery"

describe("isKnownRecoverableP3009", () => {
  it("matches only P3009 output for the localized metadata migration", () => {
    expect(
      isKnownRecoverableP3009(`Error code: P3009 ${RECOVERABLE_MIGRATION}`),
    ).toBe(true)
    expect(isKnownRecoverableP3009(`Error code: P3009 0001_init`)).toBe(false)
    expect(
      isKnownRecoverableP3009(`Error code: P3018 ${RECOVERABLE_MIGRATION}`),
    ).toBe(false)
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
    const runner = vi
      .fn()
      .mockResolvedValueOnce(result(1, `P3009 ${RECOVERABLE_MIGRATION}`))
      .mockResolvedValueOnce(result(0))
      .mockResolvedValueOnce(result(0))

    await deployWithKnownRecovery(runner)

    expect(runner).toHaveBeenNthCalledWith(1, ["migrate", "deploy"])
    expect(runner).toHaveBeenNthCalledWith(2, [
      "migrate",
      "resolve",
      "--rolled-back",
      RECOVERABLE_MIGRATION,
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

    await expect(deployWithKnownRecovery(runner)).rejects.toThrow(
      /resolve --rolled-back/,
    )
  })
})
