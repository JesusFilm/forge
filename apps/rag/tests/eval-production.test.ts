import { describe, expect, it } from "vitest"

import {
  installProductionReadEnvironment,
  productionEvaluationErrorMessage,
} from "../scripts/eval-production.js"

const production = {
  FORGE_RAG_POSTGRESQL_READONLY_DB_URL:
    "postgresql://forge_rag_evaluator:secret@prod.example/rag",
  OPENROUTER_API_KEY: "provider-secret",
  FORGE_RAG_EMBED_MODEL_ID: "model",
  FORGE_RAG_EXPECTED_POSTGRES_HOST: "prod.example",
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
    expect(environment.DATABASE_URL).toBe(
      production.FORGE_RAG_POSTGRESQL_READONLY_DB_URL,
    )
  })

  it("rejects generic DATABASE_URL and every other target", () => {
    expect(() =>
      installProductionReadEnvironment(["--target", "production-read"], {
        DATABASE_URL: production.FORGE_RAG_POSTGRESQL_READONLY_DB_URL,
        OPENROUTER_API_KEY: "generic",
        FORGE_RAG_EXPECTED_POSTGRES_HOST: "prod.example",
      }),
    ).toThrow(/FORGE_RAG_POSTGRESQL_READONLY_DB_URL/)
    expect(() =>
      installProductionReadEnvironment(["--target", "production-write"], {
        ...production,
      }),
    ).toThrow(/production-read/)
  })

  it("requires the expected host and refuses a mismatched production URL", () => {
    const withoutExpectedHost: NodeJS.ProcessEnv = { ...production }
    delete withoutExpectedHost.FORGE_RAG_EXPECTED_POSTGRES_HOST
    expect(() =>
      installProductionReadEnvironment(
        ["--target", "production-read"],
        withoutExpectedHost,
      ),
    ).toThrow(/FORGE_RAG_EXPECTED_POSTGRES_HOST/)
    expect(() =>
      installProductionReadEnvironment(["--target", "production-read"], {
        ...production,
        FORGE_RAG_EXPECTED_POSTGRES_HOST: "other.example",
      }),
    ).toThrow(/host/i)
  })

  it("rejects an owner credential stored in the read-only variable", () => {
    expect(() =>
      installProductionReadEnvironment(["--target", "production-read"], {
        ...production,
        FORGE_RAG_POSTGRESQL_READONLY_DB_URL:
          "postgresql://owner:secret@prod.example/rag",
      }),
    ).toThrow(/username must match/)
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
        new Error(`failed with ${production.OPENROUTER_API_KEY}`),
      ),
    ).toBe("production-read evaluation failed (details redacted)")
  })
})
