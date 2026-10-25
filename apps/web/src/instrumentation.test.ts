import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const configureDatadog = vi.fn()

vi.mock("@/observability/datadog", () => ({
  configureDatadog,
}))

describe("register", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.NEXT_RUNTIME
  })

  afterAll(() => {
    consoleError.mockRestore()
  })

  it("configures Datadog in the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs"
    const { register } = await import("./instrumentation")

    await register()

    expect(configureDatadog).toHaveBeenCalledTimes(1)
  })

  it("does not configure Datadog outside the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge"
    const { register } = await import("./instrumentation")

    await register()

    expect(configureDatadog).not.toHaveBeenCalled()
  })

  it("does not reject startup when Datadog configuration fails", async () => {
    process.env.NEXT_RUNTIME = "nodejs"
    configureDatadog.mockImplementationOnce(() => {
      throw new Error("dd-trace failed")
    })
    const { register } = await import("./instrumentation")

    await expect(register()).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith(
      "[datadog] failed to configure observability: dd-trace failed",
    )
  })
})
