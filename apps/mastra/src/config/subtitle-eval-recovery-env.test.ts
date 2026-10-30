import { afterEach, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it("maps the optional recovery operator pair from process env", async () => {
  vi.stubEnv(
    "MANAGER_SUBTITLE_EVAL_RECOVERY_URL",
    "https://manager.jesusfilm.org/api/scheduled/subtitle-eval-recovery",
  )
  vi.stubEnv("MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY", "dummy-operator-key")
  const { env } = await import("./env")
  expect(env.MANAGER_SUBTITLE_EVAL_RECOVERY_URL).toBe(
    "https://manager.jesusfilm.org/api/scheduled/subtitle-eval-recovery",
  )
  expect(env.MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY).toBe("dummy-operator-key")
})

it.each([undefined, ""])(
  "keeps unset/empty recovery config optional (%j)",
  async (value) => {
    vi.stubEnv("MANAGER_SUBTITLE_EVAL_RECOVERY_URL", value)
    vi.stubEnv("MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY", value)
    const { env } = await import("./env")
    expect(env.MANAGER_SUBTITLE_EVAL_RECOVERY_URL).toBeUndefined()
    expect(env.MANAGER_SUBTITLE_EVAL_RECOVERY_API_KEY).toBeUndefined()
  },
)
