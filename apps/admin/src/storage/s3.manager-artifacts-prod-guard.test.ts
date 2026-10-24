/**
 * Fail-fast test for the production-requires-manager-bucket guard.
 *
 * Mirrors `s3.prod-guard.test.ts` for the new `readManagerArtifact`
 * helper. Runs in a separate file so NODE_ENV can be flipped to
 * "production" at module import time without contaminating other
 * test files' module-cached `useManagerArtifactsS3` flag.
 */

import { describe, expect, it, vi } from "vitest"
;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
delete process.env.MANAGER_ARTIFACTS_S3_BUCKET
// Keep RAILWAY_S3_BUCKET set so the primary client's prod guard does
// NOT trip — we want to isolate the manager-artifacts guard here.
process.env.RAILWAY_S3_BUCKET = "irrelevant-primary-bucket"
process.env.RAILWAY_S3_ENDPOINT = "https://primary.example.com"
process.env.RAILWAY_S3_REGION = "auto"
process.env.RAILWAY_S3_ACCESS_KEY_ID = "PRIMARY_AKIA"
process.env.RAILWAY_S3_SECRET_ACCESS_KEY = "primary-secret"

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
  PutObjectCommand: class {},
  GetObjectCommand: class {},
}))
vi.mock("@smithy/node-http-handler", () => ({
  NodeHttpHandler: class {},
}))

const { readManagerArtifact } = await import("./s3")

describe("storage — readManagerArtifact production fail-fast", () => {
  it("rejects loudly when MANAGER_ARTIFACTS_S3_BUCKET is unset in production", async () => {
    await expect(
      readManagerArtifact("1502", "scene-analysis", "json"),
    ).rejects.toThrow(/MANAGER_ARTIFACTS_S3_BUCKET is not set/)
  })
})
