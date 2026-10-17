import { createHash } from "node:crypto"
import { afterEach, expect, it, vi } from "vitest"
import { studioAssetUploadSchema } from "@forge/studio-contracts/assets"
import {
  createStudioAssetBroker,
  type StudioBrokerClient,
} from "./studio-broker"

vi.mock("@/config/env", () => ({
  env: { ADMIN_GRAPHQL_URL: "https://admin.example/api/graphql" },
}))
afterEach(() => vi.unstubAllGlobals())
const bytes = Buffer.from("source segment")
const reference = {
  assetId: "segment",
  versionId: "version",
  digest: createHash("sha256").update(bytes).digest("hex"),
}
function fixture() {
  const call = vi.fn<StudioBrokerClient>(async (action, raw) => {
    expect(action).toBe("asset-upload")
    studioAssetUploadSchema.parse(raw)
    return { path: `/api/shorts/assets/transfer/${"a".repeat(64)}` }
  })
  const fetcher = vi.fn(async () =>
    Response.json({
      reference,
      mediaAssetId: "media",
      filename: "segment.ts",
      mimeType: "video/mp2t",
      byteSize: bytes.length,
      role: "source",
      provenance: { status: "recorded", recorded: {} },
      narration: null,
      voice: null,
      actor: { kind: "service", id: "manager_backend" },
    }),
  )
  vi.stubGlobal("fetch", fetcher)
  return { call, fetcher }
}
it("retains a shared segment once for 17 repeated clips", async () => {
  const { call, fetcher } = fixture()
  const assets = createStudioAssetBroker(call)
  for (let i = 0; i < 17; i++) {
    expect(
      await assets.register("segment.ts", "video/mp2t", "source", bytes),
    ).toEqual(reference)
  }
  expect(call).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledTimes(1)
  await assets.register("segment.ts", "video/mp2t", "source", bytes, [], {
    sourceStartMs: 5000,
  })
  await assets.register("segment.ts", "video/mp2t", "source", bytes, [
    reference,
  ])
  expect(fetcher).toHaveBeenCalledTimes(3)
  await createStudioAssetBroker(call).register(
    "segment.ts",
    "video/mp2t",
    "source",
    bytes,
  )
  expect(fetcher).toHaveBeenCalledTimes(4)
})
it("does not cache failed uploads or return cached authority after cancellation", async () => {
  const { call, fetcher } = fixture()
  const controller = new AbortController()
  const assets = createStudioAssetBroker(call, controller.signal)
  fetcher.mockImplementationOnce(
    async () => new Response(null, { status: 503 }),
  )
  await expect(
    assets.register("segment.ts", "video/mp2t", "source", bytes),
  ).rejects.toThrow("Could not retain")
  await assets.register("segment.ts", "video/mp2t", "source", bytes)
  controller.abort()
  await expect(
    assets.register("segment.ts", "video/mp2t", "source", bytes),
  ).rejects.toThrow()
  expect(call).toHaveBeenCalledTimes(2)
  expect(fetcher).toHaveBeenCalledTimes(2)
})
