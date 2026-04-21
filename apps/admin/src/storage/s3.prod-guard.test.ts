/**
 * Fail-fast test for the production-requires-S3 guard in storage/s3.ts.
 *
 * Runs in a separate test file so NODE_ENV can be flipped to "production"
 * at module import time, which is the only moment `useS3` and the prod
 * guard read their inputs.
 */

import { describe, expect, it, vi } from "vitest"

// Flip env BEFORE the dynamic import so env.ts + s3.ts see the production
// shape. Leave RAILWAY_S3_BUCKET unset — that's the misconfigured state
// the guard is meant to surface. NODE_ENV is `Readonly<string>` under
// `@types/node`, so we assign via a pass-through cast.
;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
delete process.env.RAILWAY_S3_BUCKET

// @aws-sdk/client-s3 and @smithy/node-http-handler are imported lazily
// inside getS3(), but the assertStorageConfiguredForProduction guard
// runs BEFORE that path. Still, mock them defensively so any accidental
// client-construction attempt fails loudly rather than reaching the
// network.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
  PutObjectCommand: class {},
  GetObjectCommand: class {},
}))
vi.mock("@smithy/node-http-handler", () => ({
  NodeHttpHandler: class {},
}))

const { writeObject, readObject } = await import("./s3")

describe("storage — production fail-fast", () => {
  it("writeObject rejects loudly when RAILWAY_S3_BUCKET is unset in production", async () => {
    await expect(
      writeObject("admin-migrations/x.json", "payload"),
    ).rejects.toThrow(/RAILWAY_S3_BUCKET is not set/)
  })

  it("readObject rejects loudly when RAILWAY_S3_BUCKET is unset in production", async () => {
    await expect(readObject("admin-migrations/x.json")).rejects.toThrow(
      /RAILWAY_S3_BUCKET is not set/,
    )
  })
})
