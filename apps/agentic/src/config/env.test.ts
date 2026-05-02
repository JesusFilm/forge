import { describe, expect, it } from "vitest"
import { parseAgenticEnv } from "./env"

const BASE_ENV = {
  NODE_ENV: "development",
  AGENTIC_HOST: "localhost",
  AGENTIC_PORT: "4111",
  AGENTIC_STORAGE_URL: "file:./.mastra/test.db",
  AGENTIC_OPERATOR_API_KEY: "agentic-operator-key",
  AGENTIC_SERVICE_API_KEY: "agentic-service-key",
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

  it("keeps production secret validation strong when CI is set", () => {
    expect(() =>
      parseAgenticEnv({
        ...BASE_ENV,
        CI: "true",
        NODE_ENV: "production",
        AGENTIC_STORAGE_URL: "file:/tmp/agentic-smoke.db",
        AGENTIC_OPERATOR_API_KEY: "x",
        AGENTIC_SERVICE_API_KEY: "y",
        MANAGER_AGENTIC_API_KEY: "z",
      }),
    ).toThrow()
  })

  it("rejects relative file storage in production", () => {
    expect(() =>
      parseAgenticEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        AGENTIC_STORAGE_URL: "file:./.mastra/local.db",
      }),
    ).toThrow("AGENTIC_STORAGE_URL must be durable in production")
  })

  it("rejects reused Agentic service and operator tokens", () => {
    expect(() =>
      parseAgenticEnv({
        ...BASE_ENV,
        AGENTIC_OPERATOR_API_KEY: "shared-agentic-token",
        AGENTIC_SERVICE_API_KEY: "shared-agentic-token",
      }),
    ).toThrow(
      "AGENTIC_SERVICE_API_KEY and AGENTIC_OPERATOR_API_KEY must be different",
    )
  })

  it("rejects reused Agentic operator and Manager callback tokens", () => {
    expect(() =>
      parseAgenticEnv({
        ...BASE_ENV,
        AGENTIC_OPERATOR_API_KEY: "shared-agentic-token",
        MANAGER_AGENTIC_API_KEY: "shared-agentic-token",
      }),
    ).toThrow(
      "AGENTIC_OPERATOR_API_KEY and MANAGER_AGENTIC_API_KEY must be different",
    )
  })

  it("parses the Manager request timeout with a default and override", () => {
    expect(parseAgenticEnv(BASE_ENV)).toMatchObject({
      managerRequestTimeoutMs: 60000,
    })

    expect(
      parseAgenticEnv({
        ...BASE_ENV,
        AGENTIC_MANAGER_REQUEST_TIMEOUT_MS: "12500",
      }),
    ).toMatchObject({
      managerRequestTimeoutMs: 12500,
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
