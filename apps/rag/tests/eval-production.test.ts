import { describe, expect, it } from "vitest"

import {
  installProductionReadEnvironment,
  productionEvaluationErrorMessage,
} from "../scripts/eval-production.js"

const production = {
  JFRAG_POSTGRESQL_DB_URL: "postgresql://reader:secret@prod.example/rag",
  JFRAG_OPENROUTER_API_KEY: "provider-secret",
  JFRAG_OPENROUTER_EMBED_MODEL_ID: "model",
  JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
}

describe("production eval target", () => {
  it("accepts only the explicit production-read target and namespaced inputs", () => {
    const environment: NodeJS.ProcessEnv = { ...production }
    expect(
      installProductionReadEnvironment(
        ["--target", "production-read", "--case-set", "current"],
        environment,
      ),
    ).toEqual(["--case-set", "current"])
    expect(environment.DATABASE_URL).toBe(production.JFRAG_POSTGRESQL_DB_URL)
  })

  it("rejects generic DATABASE_URL and every other target", () => {
    expect(() =>
      installProductionReadEnvironment(["--target", "production-read"], {
        DATABASE_URL: production.JFRAG_POSTGRESQL_DB_URL,
        OPENROUTER_API_KEY: "generic",
        JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
      }),
    ).toThrow(/JFRAG_POSTGRESQL_DB_URL/)
    expect(() =>
      installProductionReadEnvironment(["--target", "production-write"], {
        ...production,
      }),
    ).toThrow(/production-read/)
  })

  it("requires the expected host and refuses a mismatched production URL", () => {
    const withoutExpectedHost: NodeJS.ProcessEnv = { ...production }
    delete withoutExpectedHost.JFRAG_EXPECTED_POSTGRES_HOST
    expect(() =>
      installProductionReadEnvironment(
        ["--target", "production-read"],
        withoutExpectedHost,
      ),
    ).toThrow(/JFRAG_EXPECTED_POSTGRES_HOST/)
    expect(() =>
      installProductionReadEnvironment(["--target", "production-read"], {
        ...production,
        JFRAG_EXPECTED_POSTGRES_HOST: "other.example",
      }),
    ).toThrow(/host/i)
  })

  it("reports safe argument errors but redacts runtime validation failures", () => {
    let argumentError: unknown
    try {
      installProductionReadEnvironment(
        ["--target", "production-read", "--source", "cru"],
        { ...production },
      )
    } catch (error) {
      argumentError = error
    }
    expect(productionEvaluationErrorMessage(argumentError)).toBe(
      "unknown eval argument: --source",
    )

    expect(
      productionEvaluationErrorMessage(
        new Error(`failed with ${production.JFRAG_OPENROUTER_API_KEY}`),
      ),
    ).toBe("production-read evaluation failed (details redacted)")
  })
})
