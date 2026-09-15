import { describe, expect, it, vi } from "vitest"

import {
  RECOVERABLE_MIGRATION,
  RECOVERABLE_MIGRATIONS,
  deployWithKnownRecovery,
  getKnownRecoverableP3009Migration,
  isKnownRecoverableP3009,
  isTransientPrismaDeployFailure,
  type CommandResult,
} from "./migrate-deploy-known-recovery"

const videoLocaleSearchSocialMetadataMigration =
  "0047_video_locale_search_social_metadata"
const watchSearchCandidateExactCompatibilityMigration =
  "0073_watch_search_candidate_exact_compatibility_identities"

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

  it("recovers the failed VideoLocale search metadata migration", () => {
    expect(
      isKnownRecoverableP3009(
        `Error code: P3009 ${videoLocaleSearchSocialMetadataMigration}`,
      ),
    ).toBe(true)
  })

  it("recovers the failed Watch search exact compatibility migration", () => {
    expect(
      isKnownRecoverableP3009(
        `Error code: P3009 ${watchSearchCandidateExactCompatibilityMigration}`,
      ),
    ).toBe(true)
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

describe("isTransientPrismaDeployFailure", () => {
  it("matches database connection saturation from the schema engine", () => {
    expect(
      isTransientPrismaDeployFailure(
        "Error: Schema engine error:\nFATAL: sorry, too many clients already",
      ),
    ).toBe(true)
    expect(
      isTransientPrismaDeployFailure(
        "FATAL: remaining connection slots are reserved for roles with privileges",
      ),
    ).toBe(true)
    expect(isTransientPrismaDeployFailure("Error code: P3018")).toBe(false)
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
    const migration = videoLocaleSearchSocialMetadataMigration
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

  it("resolves the failed Watch search exact compatibility migration", async () => {
    const migration = watchSearchCandidateExactCompatibilityMigration
    const runner = vi
      .fn()
      .mockResolvedValueOnce(result(1, `P3009 ${migration}`))
      .mockResolvedValueOnce(result(0))
      .mockResolvedValueOnce(result(0))

    await deployWithKnownRecovery(runner)

    expect(runner).toHaveBeenNthCalledWith(2, [
      "migrate",
      "resolve",
      "--rolled-back",
      migration,
    ])
    expect(runner).toHaveBeenNthCalledWith(3, ["migrate", "deploy"])
  })

  it("retries transient deploy saturation before succeeding", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const runner = vi
      .fn()
      .mockResolvedValueOnce(
        result(
          1,
          "Schema engine error: FATAL: sorry, too many clients already",
        ),
      )
      .mockResolvedValueOnce(
        result(1, "FATAL: remaining connection slots are reserved"),
      )
      .mockResolvedValueOnce(result(0))

    await deployWithKnownRecovery(runner, {
      sleep,
      transientDeployAttempts: 3,
      transientDeployDelayMs: 0,
    })

    expect(runner).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it("fails after exhausting transient deploy retries", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const runner = vi
      .fn()
      .mockResolvedValue(
        result(
          1,
          "Schema engine error: FATAL: sorry, too many clients already",
        ),
      )

    await expect(
      deployWithKnownRecovery(runner, {
        sleep,
        transientDeployAttempts: 2,
        transientDeployDelayMs: 0,
      }),
    ).rejects.toThrow(/without known P3009 recovery/)

    expect(runner).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
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
