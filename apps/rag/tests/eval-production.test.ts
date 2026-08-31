import { describe, expect, it } from "vitest"

import { installProductionReadEnvironment } from "../scripts/eval-production.js"

const production = {
  JFRAG_POSTGRESQL_DB_URL: "postgresql://reader:secret@prod.example/rag",
  JFRAG_OPENROUTER_API_KEY: "provider-secret",
  JFRAG_OPENROUTER_EMBED_MODEL_ID: "model",
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
      }),
    ).toThrow(/JFRAG_POSTGRESQL_DB_URL/)
    expect(() =>
      installProductionReadEnvironment(["--target", "production-write"], {
        ...production,
      }),
    ).toThrow(/production-read/)
  })
})
