import { describe, expect, it } from "vitest"
import { parseAgenticEnv } from "./env"

const BASE_ENV = {
  NODE_ENV: "development",
  AGENTIC_HOST: "localhost",
  AGENTIC_PORT: "4111",
  AGENTIC_STORAGE_URL: "file:./.mastra/test.db",
  AGENTIC_OPERATOR_API_KEY: "operator-key",
  AGENTIC_SERVICE_API_KEY: "service-key",
  AGENTIC_MODEL: "openai/gpt-5-mini",
  MANAGER_BASE_URL: "http://localhost:3002",
  MANAGER_AGENTIC_API_KEY: "manager-agentic-key",
}

describe("parseAgenticEnv", () => {
  it("fails production without an operator auth gate", () => {
    expect(() =>
      parseAgenticEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        AGENTIC_OPERATOR_API_KEY: "",
      }),
    ).toThrow("AGENTIC_OPERATOR_API_KEY is required")
  })

  it("fails production without persistent storage", () => {
    expect(() =>
      parseAgenticEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        AGENTIC_STORAGE_URL: "",
      }),
    ).toThrow("AGENTIC_STORAGE_URL is required")
  })

  it("accepts CI placeholder values", () => {
    expect(
      parseAgenticEnv({
        CI: "1",
        NODE_ENV: "test",
        AGENTIC_HOST: "127.0.0.1",
        AGENTIC_PORT: "4111",
        AGENTIC_STORAGE_URL: "file:./.mastra/ci.db",
        AGENTIC_OPERATOR_API_KEY: "ci-operator-key",
        AGENTIC_SERVICE_API_KEY: "ci-service-key",
        AGENTIC_MODEL: "openai/gpt-5-mini",
        MANAGER_BASE_URL: "http://localhost:3002",
        MANAGER_AGENTIC_API_KEY: "ci-manager-agentic-key",
      }),
    ).toMatchObject({
      isCi: true,
      port: 4111,
      managerBaseUrl: "http://localhost:3002",
    })
  })

  it("uses Railway PORT when AGENTIC_PORT is not set", () => {
    expect(
      parseAgenticEnv({
        ...BASE_ENV,
        AGENTIC_PORT: undefined,
        PORT: "4899",
      }),
    ).toMatchObject({
      port: 4899,
    })
  })

  it("prefers AGENTIC_PORT over Railway PORT when both are set", () => {
    expect(
      parseAgenticEnv({
        ...BASE_ENV,
        AGENTIC_PORT: "4222",
        PORT: "4899",
      }),
    ).toMatchObject({
      port: 4222,
    })
  })
})
