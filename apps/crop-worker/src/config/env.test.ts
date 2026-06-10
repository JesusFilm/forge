import { describe, expect, it } from "vitest"
import { assertRuntimeEnv, parseEnv, RuntimeEnvError } from "./env.js"

const fullProductionSource = {
  NODE_ENV: "production",
  CROP_WORKER_API_KEYS: "key-a,key-b",
  RAILWAY_S3_ENDPOINT: "https://s3.example.test",
  RAILWAY_S3_REGION: "auto",
  RAILWAY_S3_BUCKET: "artifacts",
  RAILWAY_S3_ACCESS_KEY_ID: "access",
  RAILWAY_S3_SECRET_ACCESS_KEY: "secret",
}

describe("parseEnv", () => {
  it("applies defaults when source is empty", () => {
    const env = parseEnv({})

    expect(env.NODE_ENV).toBe("development")
    expect(env.PORT).toBe(3011)
    expect(env.CROP_WORKER_API_KEYS).toBeUndefined()
    expect(env.CROP_WORKER_LOCAL_ARTIFACTS_DIR).toBe(".tmp/artifacts")
    expect(env.CROP_WORKER_MAX_CONCURRENT_JOBS).toBe(1)
    expect(env.CROP_WORKER_QUEUE_LIMIT).toBe(10)
    expect(env.CROP_WORKER_PREVIEW_MAX_SEGMENTS).toBe(6)
    expect(env.CROP_WORKER_PREVIEW_MAX_SECONDS).toBe(90)
    expect(env.CROP_WORKER_FFMPEG_FINGERPRINT_TIMEOUT_MS).toBe(1_800_000)
    expect(env.CROP_WORKER_FFMPEG_RENDER_TIMEOUT_MS).toBe(21_600_000)
    expect(env.CROP_WORKER_SCENE_THRESHOLD).toBe(0.3)
    expect(env.CROP_WORKER_MIN_SHOT_SECONDS).toBe(1.5)
  })

  it("treats empty strings as unset", () => {
    const env = parseEnv({
      CROP_WORKER_API_KEYS: "",
      RAILWAY_S3_BUCKET: "",
      PORT: "",
    })

    expect(env.CROP_WORKER_API_KEYS).toBeUndefined()
    expect(env.RAILWAY_S3_BUCKET).toBeUndefined()
    expect(env.PORT).toBe(3011)
  })

  it("coerces numeric overrides", () => {
    const env = parseEnv({
      PORT: "4001",
      CROP_WORKER_MAX_CONCURRENT_JOBS: "2",
      CROP_WORKER_QUEUE_LIMIT: "25",
      CROP_WORKER_SCENE_THRESHOLD: "0.42",
      CROP_WORKER_MIN_SHOT_SECONDS: "2.5",
    })

    expect(env.PORT).toBe(4001)
    expect(env.CROP_WORKER_MAX_CONCURRENT_JOBS).toBe(2)
    expect(env.CROP_WORKER_QUEUE_LIMIT).toBe(25)
    expect(env.CROP_WORKER_SCENE_THRESHOLD).toBe(0.42)
    expect(env.CROP_WORKER_MIN_SHOT_SECONDS).toBe(2.5)
  })

  it("rejects invalid numeric values", () => {
    expect(() => parseEnv({ PORT: "not-a-port" })).toThrow()
    expect(() => parseEnv({ CROP_WORKER_SCENE_THRESHOLD: "1.5" })).toThrow()
  })
})

describe("assertRuntimeEnv", () => {
  it("passes outside production even when everything is unset", () => {
    expect(() => assertRuntimeEnv(parseEnv({ NODE_ENV: "test" }))).not.toThrow()
  })

  it("passes in production with full configuration", () => {
    expect(() => assertRuntimeEnv(parseEnv(fullProductionSource))).not.toThrow()
  })

  it("throws RuntimeEnvError in production when api keys are missing", () => {
    const env = parseEnv({
      ...fullProductionSource,
      CROP_WORKER_API_KEYS: undefined,
    })

    expect(() => assertRuntimeEnv(env)).toThrow(RuntimeEnvError)
    expect(() => assertRuntimeEnv(env)).toThrow(/CROP_WORKER_API_KEYS/)
  })

  it("throws in production when any RAILWAY_S3_* var is missing", () => {
    const env = parseEnv({
      ...fullProductionSource,
      RAILWAY_S3_BUCKET: undefined,
      RAILWAY_S3_SECRET_ACCESS_KEY: undefined,
    })

    expect(() => assertRuntimeEnv(env)).toThrow(
      /RAILWAY_S3_BUCKET, RAILWAY_S3_SECRET_ACCESS_KEY are required/,
    )
  })
})
