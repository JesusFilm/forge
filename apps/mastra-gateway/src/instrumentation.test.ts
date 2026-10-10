import { afterEach, describe, expect, it, vi } from "vitest"

describe("gateway startup instrumentation", () => {
  afterEach(() => {
    vi.doUnmock("@/config/env")
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("runs runtime environment assertions in the Node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    const assertGatewayRuntimeEnv = vi.fn()
    vi.doMock("@/config/env", () => ({ assertGatewayRuntimeEnv }))

    const { register } = await import("./instrumentation")
    await register()

    expect(assertGatewayRuntimeEnv).toHaveBeenCalledOnce()
  })
})
