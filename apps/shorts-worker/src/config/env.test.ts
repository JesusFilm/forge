import { describe, expect, it } from "vitest"
import {
  assertRuntimeEnv,
  MAX_RENDER_JOB_TIMEOUT_MS,
  parseEnv,
  RuntimeEnvError,
} from "./env.js"

describe("parseEnv", () => {
  it("applies defaults when unset", () => {
    const env = parseEnv({})
    expect(env.NODE_ENV).toBe("development")
    expect(env.PORT).toBe(3012)
    expect(env.SHORTS_WORKER_LOCAL_ARTIFACTS_DIR).toBe(".tmp/artifacts")
    expect(env.SHORTS_WORKER_ALLOWED_SOURCE_HOSTS).toBe("stream.mux.com")
    expect(env.SHORTS_WORKER_RENDER_CONCURRENCY).toBe(2)
    expect(env.SHORTS_WORKER_QUEUE_LIMIT).toBe(2)
    expect(env.SHORTS_WORKER_PREPARE_JOB_TIMEOUT_MS).toBe(2_700_000)
    expect(env.SHORTS_WORKER_RENDER_JOB_TIMEOUT_MS).toBe(4_200_000)
    expect(env.SHORTS_WORKER_WHISPER_CPP_VERSION).toBe("1.7.4")
    expect(env.SHORTS_WORKER_BUNDLE_DIR).toBeUndefined()
    expect(env.SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR).toBeUndefined()
  })

  it('treats empty strings as unset (Railway provides "" rather than omitting)', () => {
    const env = parseEnv({ NODE_ENV: "", PORT: "", SHORTS_WORKER_API_KEYS: "" })
    expect(env.NODE_ENV).toBe("development")
    expect(env.PORT).toBe(3012)
    expect(env.SHORTS_WORKER_API_KEYS).toBeUndefined()
  })

  it("coerces numeric overrides", () => {
    const env = parseEnv({
      PORT: "4000",
      SHORTS_WORKER_QUEUE_LIMIT: "5",
      SHORTS_WORKER_RENDER_CONCURRENCY: "4",
    })
    expect(env.PORT).toBe(4000)
    expect(env.SHORTS_WORKER_QUEUE_LIMIT).toBe(5)
    expect(env.SHORTS_WORKER_RENDER_CONCURRENCY).toBe(4)
  })

  it("keeps the render deadline strictly below Mastra's 80 minute poll ceiling", () => {
    expect(
      parseEnv({
        SHORTS_WORKER_RENDER_JOB_TIMEOUT_MS: String(MAX_RENDER_JOB_TIMEOUT_MS),
      }).SHORTS_WORKER_RENDER_JOB_TIMEOUT_MS,
    ).toBe(MAX_RENDER_JOB_TIMEOUT_MS)
    expect(() =>
      parseEnv({
        SHORTS_WORKER_RENDER_JOB_TIMEOUT_MS: String(
          MAX_RENDER_JOB_TIMEOUT_MS + 1,
        ),
      }),
    ).toThrow()
  })
})

const fullProductionSource = {
  NODE_ENV: "production",
  SHORTS_WORKER_API_KEYS: "key-a",
  RAILWAY_S3_ENDPOINT: "https://s3.example",
  RAILWAY_S3_REGION: "auto",
  RAILWAY_S3_BUCKET: "artifacts",
  RAILWAY_S3_ACCESS_KEY_ID: "access",
  RAILWAY_S3_SECRET_ACCESS_KEY: "secret",
  SHORTS_WORKER_BUNDLE_DIR: "/app/bundle",
  SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR: "/app/devotional-bundle",
  SHORTS_WORKER_WHISPER_MODEL_PATH:
    "/opt/whisper-models/ggml-large-v3-turbo.bin",
  SHORTS_WORKER_WHISPER_CPP_DIR: "/opt/whisper",
}

describe("assertRuntimeEnv", () => {
  it("is a no-op outside production", () => {
    expect(() => assertRuntimeEnv(parseEnv({}), () => false)).not.toThrow()
  })

  it("throws for missing required vars in production", () => {
    expect(() =>
      assertRuntimeEnv(parseEnv({ NODE_ENV: "production" }), () => true),
    ).toThrow(RuntimeEnvError)
    expect(() =>
      assertRuntimeEnv(parseEnv({ NODE_ENV: "production" }), () => true),
    ).toThrow(/SHORTS_WORKER_API_KEYS/)
    expect(() =>
      assertRuntimeEnv(parseEnv({ NODE_ENV: "production" }), () => true),
    ).toThrow(/SHORTS_WORKER_WHISPER_MODEL_PATH/)
    expect(() =>
      assertRuntimeEnv(parseEnv({ NODE_ENV: "production" }), () => true),
    ).toThrow(/SHORTS_WORKER_BUNDLE_DIR/)
  })

  it("throws when the model/bundle/cpp paths do not exist on disk", () => {
    expect(() =>
      assertRuntimeEnv(parseEnv(fullProductionSource), () => false),
    ).toThrow(/missing path/)
  })

  it("passes with the full set present and paths existing", () => {
    expect(() =>
      assertRuntimeEnv(parseEnv(fullProductionSource), () => true),
    ).not.toThrow()
  })
})
