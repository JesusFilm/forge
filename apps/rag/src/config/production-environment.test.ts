import { describe, expect, it } from "vitest"
import { assertEnvironmentForTarget, resolveProductionEnv } from "./env.js"
import { resolveDashboardDatabase } from "./database-url.js"

const legacy = {
  JFRAG_POSTGRESQL_READONLY_DB_URL:
    "postgresql://forge_rag_evaluator:p@legacy.example/rag",
  JFRAG_POSTGRESQL_DB_URL: "postgresql://owner:p@legacy.example/rag",
  JFRAG_EXPECTED_POSTGRES_HOST: "legacy.example",
  JFRAG_OPENROUTER_API_KEY: "legacy-key",
  JFRAG_ALLOW_PROD_WRITE: "1",
}
const canonical = {
  FORGE_RAG_POSTGRESQL_READONLY_DB_URL:
    "postgresql://forge_rag_evaluator:p@forge.example/rag",
  FORGE_RAG_POSTGRESQL_DB_URL: "postgresql://owner:p@forge.example/rag",
  FORGE_RAG_EXPECTED_POSTGRES_HOST: "forge.example",
  OPENROUTER_API_KEY: "forge-key",
  FORGE_RAG_EMBED_MODEL_ID: "forge/model",
  FORGE_RAG_ALLOW_PROD_WRITE: "1",
}
describe("canonical-only production environment", () => {
  it("refuses legacy-only production and dashboard inputs", () => {
    expect(() =>
      assertEnvironmentForTarget(legacy, "production-read"),
    ).toThrow()
    expect(() =>
      assertEnvironmentForTarget(legacy, "production-write"),
    ).toThrow()
    expect(() => resolveDashboardDatabase(legacy)).toThrow()
  })
  it("accepts canonical-only reads", () => {
    expect(
      assertEnvironmentForTarget(canonical, "production-read"),
    ).toMatchObject({
      OPENROUTER_API_KEY: "forge-key",
      EMBED_MODEL_ID: "forge/model",
    })
  })
  it("selects canonical target with both prefixes", () => {
    const input = { ...legacy, ...canonical }
    expect(assertEnvironmentForTarget(input, "production-read")).toMatchObject({
      DATABASE_URL: canonical.FORGE_RAG_POSTGRESQL_READONLY_DB_URL,
    })
    expect(resolveDashboardDatabase(input).source).toBe(
      "FORGE_RAG_POSTGRESQL_READONLY_DB_URL",
    )
    expect(assertEnvironmentForTarget(input, "production-write")).toMatchObject(
      { DATABASE_URL: canonical.FORGE_RAG_POSTGRESQL_DB_URL },
    )
  })
  it.each([
    "FORGE_RAG_POSTGRESQL_READONLY_DB_URL",
    "FORGE_RAG_EXPECTED_POSTGRES_HOST",
    "OPENROUTER_API_KEY",
  ])("refuses blank canonical %s instead of falling back", (key) => {
    expect(() =>
      assertEnvironmentForTarget(
        { ...legacy, ...canonical, [key]: "" },
        "production-read",
      ),
    ).toThrow()
  })
  it("refuses partial canonical targets rather than mixing legacy credentials", () => {
    expect(() =>
      assertEnvironmentForTarget(
        {
          ...legacy,
          FORGE_RAG_POSTGRESQL_READONLY_DB_URL:
            canonical.FORGE_RAG_POSTGRESQL_READONLY_DB_URL,
        },
        "production-read",
      ),
    ).toThrow()
    expect(() =>
      assertEnvironmentForTarget(
        { ...legacy, FORGE_RAG_EXPECTED_POSTGRES_HOST: "legacy.example" },
        "production-write",
      ),
    ).toThrow()
    expect(() =>
      assertEnvironmentForTarget(
        { ...legacy, ...canonical, FORGE_RAG_POSTGRESQL_DB_URL: undefined },
        "production-write",
      ),
    ).toThrow()
    expect(
      assertEnvironmentForTarget(
        {
          ...legacy,
          ...canonical,
          FORGE_RAG_EMBED_MODEL_ID: undefined,
          JFRAG_OPENROUTER_EMBED_MODEL_ID: "legacy/model",
        },
        "production-read",
      ),
    ).toMatchObject({ EMBED_MODEL_ID: "qwen/qwen3-embedding-8b" })
  })
  it("preserves write acknowledgement, exact host and reader identity", () => {
    expect(() =>
      assertEnvironmentForTarget(
        { ...legacy, ...canonical, FORGE_RAG_ALLOW_PROD_WRITE: "" },
        "production-write",
      ),
    ).toThrow()
    expect(() =>
      resolveProductionEnv(canonical, { expectHost: "other.example" }),
    ).toThrow()
    expect(() =>
      assertEnvironmentForTarget(
        {
          ...canonical,
          FORGE_RAG_POSTGRESQL_READONLY_DB_URL:
            canonical.FORGE_RAG_POSTGRESQL_DB_URL,
        },
        "production-read",
      ),
    ).toThrow()
  })
  it("refuses legacy provider credentials with canonical target values", () => {
    expect(() =>
      assertEnvironmentForTarget(
        { ...legacy, ...canonical, OPENROUTER_API_KEY: undefined },
        "production-read",
      ),
    ).toThrow()
  })
})
