import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { URL } from "node:url"

import {
  applyNamespacedEnvFallbacks,
  assertEnvironmentForTarget,
  loadEnvironmentFiles,
  parseRuntimeEnv,
  parseEnvironmentFile,
  parseSmokeEnv,
  redactDatabaseUrl,
  resolveDashboardDatabase,
  resolveProductionEnv,
} from "../src/config/env.ts"

const runtimeEnv = {
  DATABASE_URL: "postgresql://local:password@localhost:5434/jesusfilm_rag",
  OPENROUTER_API_KEY: "test-openrouter-key",
}

test("runtime env applies defaults and treats optional empty strings as unset", () => {
  const env = parseRuntimeEnv({
    ...runtimeEnv,
    EMBED_BASE_URL: " ",
    EMBED_API_KEY: "",
  })

  assert.equal(env.EMBED_MODEL_ID, "qwen/qwen3-embedding-8b")
  assert.equal(env.EMBED_MAX_ATTEMPTS, 10)
  assert.equal(env.EMBED_TIMEOUT_MS, 120_000)
  assert.equal(env.QUERY_EMBED_MAX_ATTEMPTS, 2)
  assert.equal(env.QUERY_EMBED_TIMEOUT_MS, 4_000)
  assert.equal(env.PORT, 8080)
  assert.equal(env.EMBED_BASE_URL, undefined)
  assert.equal(env.EMBED_API_KEY, undefined)
})

test("runtime env rejects missing, malformed, and non-positive values", () => {
  assert.throws(() => parseRuntimeEnv({}), /DATABASE_URL/)
  assert.throws(
    () => parseRuntimeEnv({ ...runtimeEnv, DATABASE_URL: "mysql://db/rag" }),
    /Postgres URL/,
  )
  assert.throws(
    () => parseRuntimeEnv({ ...runtimeEnv, EMBED_MAX_ATTEMPTS: "0" }),
    /EMBED_MAX_ATTEMPTS/,
  )
})

test("gateway URL requires its own credential", () => {
  assert.throws(
    () =>
      parseRuntimeEnv({
        ...runtimeEnv,
        EMBED_BASE_URL: "https://gateway.example.test/v1",
      }),
    /EMBED_API_KEY.*required when EMBED_BASE_URL is set/s,
  )
  assert.doesNotThrow(() =>
    parseRuntimeEnv({
      ...runtimeEnv,
      EMBED_BASE_URL: "https://gateway.example.test/v1",
      EMBED_API_KEY: "test-gateway-key",
    }),
  )
})

test("only the environment-agnostic OpenRouter key falls back from JFRAG names", () => {
  const env = {
    OPENROUTER_API_KEY: " ",
    JFRAG_OPENROUTER_API_KEY: "namespaced-key",
    JFRAG_POSTGRESQL_DB_URL: "postgresql://prod:secret@prod.example.test/rag",
    JFRAG_OPENROUTER_EMBED_MODEL_ID: "model-from-prod",
    JFRAG_SERVE_BEARER_TOKENS: '{"secret":["*"]}',
  }

  applyNamespacedEnvFallbacks(env)

  assert.equal(env.OPENROUTER_API_KEY, "namespaced-key")
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.EMBED_MODEL_ID, undefined)
  assert.equal(env.SERVE_BEARER_TOKENS, undefined)
})

test("environment files keep injected values and prefer .env.local over .env", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forge-rag-env-"))
  await writeFile(
    join(directory, ".env"),
    'DATABASE_URL="postgresql://file:secret@file.example.test/rag"\nOPENROUTER_API_KEY=file-key\n',
  )
  await writeFile(
    join(directory, ".env.local"),
    "OPENROUTER_API_KEY=local-file-key\n",
  )

  const loaded = loadEnvironmentFiles(directory, {
    DATABASE_URL: runtimeEnv.DATABASE_URL,
  })

  assert.equal(loaded.DATABASE_URL, runtimeEnv.DATABASE_URL)
  assert.equal(loaded.OPENROUTER_API_KEY, "local-file-key")
})

test("the committed example is a valid local environment", async () => {
  const example = await readFile(
    new URL("../.env.example", import.meta.url),
    "utf8",
  )
  assert.doesNotThrow(() =>
    assertEnvironmentForTarget(parseEnvironmentFile(example), "local"),
  )
})

test("railway validation requires and validates scoped bearer JSON", () => {
  assert.throws(
    () => assertEnvironmentForTarget(runtimeEnv, "railway"),
    /SERVE_BEARER_TOKENS/,
  )
  assert.throws(
    () =>
      assertEnvironmentForTarget(
        { ...runtimeEnv, SERVE_BEARER_TOKENS: '{"token":[]}' },
        "railway",
      ),
    /SERVE_BEARER_TOKENS/,
  )
  assert.doesNotThrow(() =>
    assertEnvironmentForTarget(
      { ...runtimeEnv, SERVE_BEARER_TOKENS: '{"token":["*"]}' },
      "railway",
    ),
  )
})

test("Firecrawl is required only for the firecrawl acquisition target", () => {
  assert.doesNotThrow(() => assertEnvironmentForTarget(runtimeEnv, "local"))
  assert.throws(
    () => assertEnvironmentForTarget(runtimeEnv, "firecrawl"),
    /FIRECRAWL_API_KEY/,
  )
})

test("smoke configuration validates URL, token, and hang ceiling", () => {
  const smoke = parseSmokeEnv({ SMOKE_TOKEN: "test-smoke-token" })
  assert.equal(smoke.SMOKE_BASE_URL, "http://localhost:8080")
  assert.equal(smoke.SMOKE_MAX_MS, 15_000)
  assert.throws(() => parseSmokeEnv({}), /SMOKE_TOKEN/)
  assert.throws(
    () => parseSmokeEnv({ SMOKE_TOKEN: "token", SMOKE_MAX_MS: "NaN" }),
    /SMOKE_MAX_MS/,
  )
})

test("production resolution is explicit and write operations need a second signal", () => {
  const source = {
    JFRAG_POSTGRESQL_DB_URL:
      "postgresql://prod:password@prod.example.test:5432/rag",
    JFRAG_OPENROUTER_API_KEY: "prod-openrouter-key",
    JFRAG_OPENROUTER_EMBED_MODEL_ID: "prod-model",
  }

  const read = resolveProductionEnv(source, { expectHost: "prod.example.test" })
  assert.equal(read.EMBED_MODEL_ID, "prod-model")
  assert.throws(
    () => resolveProductionEnv(source, { write: true }),
    /JFRAG_ALLOW_PROD_WRITE=1/,
  )
  assert.throws(
    () => resolveProductionEnv(source, { expectHost: "wrong.example.test" }),
    /does not match/,
  )
})

test("dashboard production reads fail closed on generic database fallbacks", () => {
  assert.deepEqual(
    resolveDashboardDatabase({
      JFRAG_POSTGRESQL_DB_URL:
        "postgresql://prod:password@prod.example.test:5432/rag",
      DATABASE_URL: runtimeEnv.DATABASE_URL,
    }),
    {
      url: "postgresql://prod:password@prod.example.test:5432/rag",
      source: "JFRAG_POSTGRESQL_DB_URL",
    },
  )
  assert.throws(
    () => resolveDashboardDatabase({ DATABASE_URL: runtimeEnv.DATABASE_URL }),
    /Refusing.*DATABASE_URL/s,
  )
})

test("database diagnostics redact credentials", () => {
  const secret = "do-not-leak"
  const redacted = redactDatabaseUrl(
    `postgresql://rag:${secret}@prod.example.test:5432/rag`,
  )

  assert.equal(redacted, "postgresql://rag:***@prod.example.test:5432/rag")
  assert.equal(redacted.includes(secret), false)
})
