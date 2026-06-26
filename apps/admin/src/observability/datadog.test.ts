import { describe, expect, it, vi } from "vitest"

const init = vi.fn()
const use = vi.fn()

vi.mock("dd-trace", () => ({
  default: {
    init,
    use,
  },
}))

const { configureDatadog, DATADOG_GRAPHQL_CONFIG } = await import("./datadog")

describe("configureDatadog", () => {
  it("configures Datadog GraphQL auto-instrumentation without raw query values", () => {
    expect(DATADOG_GRAPHQL_CONFIG).toEqual({
      collapse: true,
      depth: -1,
      signature: true,
      source: false,
      variables: undefined,
    })

    configureDatadog()
    configureDatadog()

    expect(init).toHaveBeenCalledTimes(1)
    expect(init).toHaveBeenCalledWith({
      logInjection: true,
      runtimeMetrics: true,
      service: "forge-admin",
    })
    expect(use).toHaveBeenCalledTimes(1)
    expect(use).toHaveBeenCalledWith("graphql", DATADOG_GRAPHQL_CONFIG)
  })
})
