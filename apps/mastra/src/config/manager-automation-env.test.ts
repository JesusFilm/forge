import { afterEach, expect, it, vi } from "vitest"
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})
it.each([undefined, ""])(
  "does not require automation config at startup (%j)",
  async (value) => {
    vi.stubEnv("MANAGER_AUTOMATION_BASE_URL", value)
    vi.stubEnv("MANAGER_AGENTIC_API_KEY", value)
    vi.stubEnv("MANAGER_AUTOMATION_DRY_RUN_TIMEOUT_MS", value)
    const { env } = await import("./env")
    expect(env.MANAGER_AUTOMATION_BASE_URL).toBeUndefined()
    expect(env.MANAGER_AGENTIC_API_KEY).toBeUndefined()
    expect(env.MANAGER_AUTOMATION_DRY_RUN_TIMEOUT_MS).toBeUndefined()
  },
)
it("allows partial config without blocking startup and maps a bounded timeout", async () => {
  vi.stubEnv("MANAGER_AUTOMATION_BASE_URL", "https://manager.test")
  vi.stubEnv("MANAGER_AGENTIC_API_KEY", "")
  vi.stubEnv("MANAGER_AUTOMATION_DRY_RUN_TIMEOUT_MS", "60000")
  const { env } = await import("./env")
  expect(env.MANAGER_AUTOMATION_BASE_URL).toBe("https://manager.test")
  expect(env.MANAGER_AGENTIC_API_KEY).toBeUndefined()
  expect(env.MANAGER_AUTOMATION_DRY_RUN_TIMEOUT_MS).toBe(60000)
})
