// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The hook reports a misconfiguration; it must never throw (a rejected
// register() rejects Next's prepare() for the WHOLE server — every request,
// not just Seeker's). Enforcement lives at the proxies, verified there.

const ENV_KEYS = [
  "SEEKER_MASTRA_BASE_URL",
  "SEEKER_MASTRA_ALLOWED_HOSTS",
] as const

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

async function runRegister(): Promise<void> {
  vi.resetModules()
  const { register } = await import("./instrumentation")
  await register()
}

describe("instrumentation register — Seeker egress diagnostic", () => {
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clearEnv()
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    error = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    clearEnv()
    vi.unstubAllEnvs()
    error.mockRestore()
  })

  it("logs the enum reason when production has a base URL with no allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    await runRegister()
    expect(error).toHaveBeenCalledWith(
      "[seeker-egress] event=misconfigured reason=allowlist_unset effect=seeker_sends_and_history_refuse",
    )
  })

  it("logs host_not_allowed when the base host is not pinned", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS = "other.internal"
    await runRegister()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("reason=host_not_allowed"),
    )
  })

  it("stays silent when the configuration is sound", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    process.env.SEEKER_MASTRA_ALLOWED_HOSTS = "mastra.internal"
    await runRegister()
    expect(error).not.toHaveBeenCalled()
  })

  it("stays silent outside production (fail-open posture, nothing to report)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    process.env.SEEKER_MASTRA_BASE_URL = "http://localhost:4111"
    await runRegister()
    expect(error).not.toHaveBeenCalled()
  })

  it("does not throw on a misconfiguration (a throw would reject prepare() for every request)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    await expect(runRegister()).resolves.toBeUndefined()
  })

  // The never-throw contract's real failure mode: the dynamic import itself
  // rejecting (@/config/env reaches `server-only`, which throws on a wrong
  // module resolution). Without the try/catch this rejects Next's prepare()
  // and every request fails, not just Seeker's.
  it("resolves and logs the enum reason when the env import REJECTS", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    vi.doMock("@/config/env", () => {
      throw new Error("server-only: cannot be imported here")
    })
    const { register } = await import("./instrumentation")
    await expect(register()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      "[seeker-egress] event=diagnostic_failed",
    )
    vi.doUnmock("@/config/env")
  })

  it("resolves when the diagnostic itself throws", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    vi.doMock("@/config/env", () => ({
      describeSeekerEgressMisconfiguration: () => {
        throw new Error("boom")
      },
    }))
    const { register } = await import("./instrumentation")
    await expect(register()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      "[seeker-egress] event=diagnostic_failed",
    )
    vi.doUnmock("@/config/env")
  })

  it("no-ops on a non-nodejs runtime without reading env", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge")
    vi.stubEnv("NODE_ENV", "production")
    process.env.SEEKER_MASTRA_BASE_URL = "https://mastra.internal"
    await runRegister()
    expect(error).not.toHaveBeenCalled()
  })
})
