import { describe, expect, it } from "vitest"

import { installProductionEnvironment } from "./production-target.js"

describe("production maintenance target", () => {
  it("requires an expected host even for read-only preflight", () => {
    expect(() =>
      installProductionEnvironment(
        {
          JFRAG_POSTGRESQL_DB_URL: "postgresql://u:p@prod.example/rag",
          JFRAG_OPENROUTER_API_KEY: "key",
        },
        false,
      ),
    ).toThrow(/EXPECTED_POSTGRES_HOST/)
  })

  it("rejects host mismatch before installing DATABASE_URL", () => {
    const env = {
      JFRAG_POSTGRESQL_DB_URL: "postgresql://u:p@wrong.example/rag",
      JFRAG_OPENROUTER_API_KEY: "key",
      JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
    }
    expect(() => installProductionEnvironment(env, false)).toThrow(/host/i)
    expect(env).not.toHaveProperty("DATABASE_URL")
  })
})
