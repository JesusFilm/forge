import { describe, expect, it } from "vitest"

import { DEFAULT_EMBED_MODEL_ID } from "../../src/config/env.js"
import { RagOperationalError } from "../../src/contracts/index.js"
import {
  installForgeProductionEnvironment,
  installProductionEnvironment,
} from "./production-target.js"

const forgeEnvironment = (): NodeJS.ProcessEnv => ({
  FORGE_RAG_POSTGRESQL_READONLY_DB_URL:
    "postgresql://forge_rag_evaluator:reader-secret@forge.example/rag",
  FORGE_RAG_POSTGRESQL_DB_URL:
    "postgresql://owner:writer-secret@forge.example/rag",
  FORGE_RAG_EXPECTED_POSTGRES_HOST: "forge.example",
  OPENROUTER_API_KEY: "provider-secret",
  DATABASE_URL: "postgresql://local:local@localhost/local",
  JFRAG_POSTGRESQL_DB_URL: "postgresql://legacy:p@legacy.example/legacy",
  JFRAG_POSTGRESQL_READONLY_DB_URL:
    "postgresql://forge_rag_evaluator:p@legacy.example/legacy",
  JFRAG_ALLOW_PROD_WRITE: "1",
  JFRAG_EXPECTED_POSTGRES_HOST: "legacy.example",
  JFRAG_OPENROUTER_EMBED_MODEL_ID: "legacy/model",
})

describe("Forge production maintenance target", () => {
  it.each([false, true])("selects only the Forge URL for write=%s", (write) => {
    const input = forgeEnvironment()
    input.FORGE_RAG_ALLOW_PROD_WRITE = "1"
    const before = { ...input }
    const receipt = installForgeProductionEnvironment(input, write)
    expect(input.DATABASE_URL).toBe(
      before[
        write
          ? "FORGE_RAG_POSTGRESQL_DB_URL"
          : "FORGE_RAG_POSTGRESQL_READONLY_DB_URL"
      ],
    )
    expect(input.EMBED_MODEL_ID).toBe(DEFAULT_EMBED_MODEL_ID)
    for (const key of Object.keys(before).filter((key) =>
      key.startsWith("JFRAG_"),
    ))
      expect(input[key]).toBe(before[key])
    expect(receipt).toEqual({
      target: "forge",
      mode: write ? "apply" : "preview",
      databaseHost: "forge.example",
      databaseName: "rag",
    })
    expect(JSON.stringify(receipt)).not.toMatch(/secret|owner|evaluator/)
  })

  it.each([false, true])(
    "never falls back to another target for write=%s",
    (write) => {
      const input = forgeEnvironment()
      input.FORGE_RAG_ALLOW_PROD_WRITE = "1"
      const variable = write
        ? "FORGE_RAG_POSTGRESQL_DB_URL"
        : "FORGE_RAG_POSTGRESQL_READONLY_DB_URL"
      delete input[variable]
      const before = { ...input }
      expect(() => installForgeProductionEnvironment(input, write)).toThrow(
        variable,
      )
      expect(input).toEqual(before)
    },
  )

  it.each([undefined, "", "true", "0"])(
    "requires the exact Forge write opt-in (%s)",
    (signal) => {
      const input = forgeEnvironment()
      input.FORGE_RAG_ALLOW_PROD_WRITE = signal
      const before = { ...input }
      expect(() => installForgeProductionEnvironment(input, true)).toThrow(
        "FORGE_RAG_ALLOW_PROD_WRITE=1",
      )
      expect(input).toEqual(before)
    },
  )

  it.each([undefined, " ", "other.example"])(
    "requires the independent Forge host guard (%s)",
    (host) => {
      const input = forgeEnvironment()
      input.FORGE_RAG_EXPECTED_POSTGRES_HOST = host
      const before = { ...input }
      expect(() => installForgeProductionEnvironment(input, false)).toThrow(
        /FORGE_RAG_EXPECTED_POSTGRES_HOST|host/,
      )
      expect(input).toEqual(before)
    },
  )

  it.each([
    "postgresql://owner:secret@forge.example/rag",
    "https://forge_rag_evaluator:secret@forge.example/rag",
    "malformed-secret",
  ])(
    "rejects an unsafe reader URL without mutation or secret disclosure",
    (url) => {
      const input = forgeEnvironment()
      input.FORGE_RAG_POSTGRESQL_READONLY_DB_URL = url
      const before = { ...input }
      expect(() => installForgeProductionEnvironment(input, false)).toThrow(
        RagOperationalError,
      )
      try {
        installForgeProductionEnvironment(input, false)
      } catch (error) {
        expect((error as Error).message).not.toContain("secret")
        expect((error as Error).message).not.toContain("JFRAG_")
      }
      expect(input).toEqual(before)
    },
  )

  it("uses the explicit Forge role/model and environment-neutral provider fallback", () => {
    const input = forgeEnvironment()
    input.FORGE_RAG_POSTGRESQL_READONLY_DB_URL =
      "postgresql://forge_reader:p@forge.example/rag"
    input.FORGE_RAG_READONLY_ROLE_NAME = "forge_reader"
    input.FORGE_RAG_EMBED_MODEL_ID = "forge/model"
    delete input.OPENROUTER_API_KEY
    input.JFRAG_OPENROUTER_API_KEY = "fallback-key"
    installForgeProductionEnvironment(input, false)
    expect(input).toMatchObject({
      EMBED_MODEL_ID: "forge/model",
      OPENROUTER_API_KEY: "fallback-key",
    })
  })

  it("refuses a missing provider credential without partially installing the database", () => {
    const input = forgeEnvironment()
    delete input.OPENROUTER_API_KEY
    const before = { ...input }
    expect(() => installForgeProductionEnvironment(input, false)).toThrow(
      "OPENROUTER_API_KEY",
    )
    expect(input).toEqual(before)
  })
})

describe("production maintenance target", () => {
  it("requires an expected host even for read-only preflight", () => {
    expect(() =>
      installProductionEnvironment(
        {
          JFRAG_POSTGRESQL_READONLY_DB_URL:
            "postgresql://forge_rag_evaluator:p@prod.example/rag",
          JFRAG_OPENROUTER_API_KEY: "key",
        },
        false,
      ),
    ).toThrow(/EXPECTED_POSTGRES_HOST/)
  })

  it("rejects host mismatch before installing DATABASE_URL", () => {
    const env = {
      JFRAG_POSTGRESQL_READONLY_DB_URL:
        "postgresql://forge_rag_evaluator:p@wrong.example/rag",
      JFRAG_OPENROUTER_API_KEY: "key",
      JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
    }
    expect(() => installProductionEnvironment(env, false)).toThrow(/host/i)
    expect(env).not.toHaveProperty("DATABASE_URL")
  })

  it("requires the explicit production write signal", () => {
    const env = {
      JFRAG_POSTGRESQL_DB_URL: "postgresql://owner:p@prod.example/rag",
      JFRAG_OPENROUTER_API_KEY: "key",
      JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
    }
    expect(() => installProductionEnvironment(env, true)).toThrow(
      /ALLOW_PROD_WRITE/,
    )
    expect(env).not.toHaveProperty("DATABASE_URL")
  })

  it("installs production values only when both write guards match", () => {
    const env = {
      JFRAG_POSTGRESQL_DB_URL: "postgresql://owner:p@prod.example/rag",
      JFRAG_OPENROUTER_API_KEY: "key",
      JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
      JFRAG_ALLOW_PROD_WRITE: "1",
    }
    installProductionEnvironment(env, true)
    expect(env).toMatchObject({
      DATABASE_URL: "postgresql://owner:p@prod.example/rag",
      OPENROUTER_API_KEY: "key",
    })
  })
})
