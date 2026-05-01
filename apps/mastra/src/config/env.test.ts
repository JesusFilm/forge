import { describe, expect, it } from "vitest"
import { parseMastraEnv } from "./env"

const BASE_ENV = {
  NODE_ENV: "development",
  MASTRA_HOST: "localhost",
  MASTRA_PORT: "4111",
  MASTRA_STORAGE_URL: "file:./.mastra/test.db",
  MASTRA_OPERATOR_API_KEY: "operator-key",
  MASTRA_SERVICE_API_KEY: "service-key",
  MASTRA_MODEL: "openai/gpt-5-mini",
  MANAGER_BASE_URL: "http://localhost:3002",
  MANAGER_MASTRA_API_KEY: "manager-mastra-key",
}

describe("parseMastraEnv", () => {
  it("fails production without an operator auth gate", () => {
    expect(() =>
      parseMastraEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        MASTRA_OPERATOR_API_KEY: "",
      }),
    ).toThrow("MASTRA_OPERATOR_API_KEY is required")
  })

  it("fails production without persistent storage", () => {
    expect(() =>
      parseMastraEnv({
        ...BASE_ENV,
        NODE_ENV: "production",
        MASTRA_STORAGE_URL: "",
      }),
    ).toThrow("MASTRA_STORAGE_URL is required")
  })

  it("accepts CI placeholder values", () => {
    expect(
      parseMastraEnv({
        CI: "1",
        NODE_ENV: "test",
        MASTRA_HOST: "127.0.0.1",
        MASTRA_PORT: "4111",
        MASTRA_STORAGE_URL: "file:./.mastra/ci.db",
        MASTRA_OPERATOR_API_KEY: "ci-operator-key",
        MASTRA_SERVICE_API_KEY: "ci-service-key",
        MASTRA_MODEL: "openai/gpt-5-mini",
        MANAGER_BASE_URL: "http://localhost:3002",
        MANAGER_MASTRA_API_KEY: "ci-manager-mastra-key",
      }),
    ).toMatchObject({
      isCi: true,
      port: 4111,
      managerBaseUrl: "http://localhost:3002",
    })
  })
})
