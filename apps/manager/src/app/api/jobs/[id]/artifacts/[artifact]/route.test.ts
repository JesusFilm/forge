import { createHash } from "node:crypto"
import { beforeEach, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"
const seam = vi.hoisted(() => ({
  auth: vi.fn(),
  get: vi.fn(),
  read: vi.fn(),
  bounded: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ authenticateRequest: seam.auth }))
vi.mock("@/lib/state", () => ({ getJob: seam.get }))
vi.mock("@/lib/mux-artifact-access", () => ({
  hasValidMuxArtifactAccessSignature: () => false,
}))
vi.mock("@/services/storage", () => ({
  readArtifact: seam.read,
  readArtifactBounded: seam.bounded,
}))
import { GET } from "./route"
const reviewedKey =
  "subtitles-fr-reviewed-r0001-j" + "a".repeat(64) + "-" + "b".repeat(64)
const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nReviewed\n"
const fingerprint = createHash("sha256").update(vtt).digest("hex")
beforeEach(() => {
  vi.resetAllMocks()
  seam.auth.mockResolvedValue(null)
  seam.get.mockResolvedValue({
    id: "job",
    muxAssetId: "owned-asset",
    options: { smartCrop: { assetId: "crop-asset" } },
    artifacts: {
      [reviewedKey]: { kind: "downloadable" },
      "subtitles-fr-reviewed-r0001": { kind: "downloadable" },
      "smart-crop-plan": { kind: "downloadable" },
      subtitleReviews: {
        kind: "metadata",
        data: {
          revisions: [
            {
              artifactKey: reviewedKey,
              sourceArtifactKey: "subtitles-fr",
              targetLanguage: "fr",
              revision: 1,
              baseFingerprint: "base",
              contentFingerprint: fingerprint,
              clientSaveId: "save",
              actorId: "operator",
              createdAt: "2026-10-24T00:00:00Z",
            },
          ],
          updatedAt: "2026-10-24T00:00:00Z",
        },
      },
    },
  })
  seam.bounded.mockResolvedValue(Buffer.from(vtt))
  seam.read.mockResolvedValue(Buffer.from("{}"))
})
const download = (artifact: string) =>
  GET(
    new Request("http://manager.invalid/api/jobs/job/artifacts/" + artifact),
    { params: Promise.resolve({ id: "job", artifact }) },
  )
it("authenticates downloads before reading storage", async () => {
  seam.auth.mockResolvedValue(
    NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  )
  expect((await download(reviewedKey)).status).toBe(401)
  expect(seam.get).not.toHaveBeenCalled()
})
it("serves job-bound reviewed bytes with bounded digest validation", async () => {
  const response = await download(reviewedKey)
  expect(response.status).toBe(200)
  expect(await response.text()).toBe(vtt)
  expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  expect(seam.bounded).toHaveBeenCalledWith(
    "owned-asset",
    reviewedKey,
    "vtt",
    512 * 1024,
  )
  expect(seam.read).not.toHaveBeenCalled()
})
it("rejects a reviewed object whose bytes do not match acknowledged metadata", async () => {
  seam.bounded.mockResolvedValue(Buffer.from("corrupt"))
  const response = await download(reviewedKey)
  expect(response.status).toBe(409)
  expect(response.headers.get("Cache-Control")).toBe("private, no-store")
})
it("preserves smart-crop storage aliases for ordinary artifacts", async () => {
  expect((await download("smart-crop-plan")).status).toBe(200)
  expect(seam.read).toHaveBeenCalledWith(
    "crop-asset",
    "smart-crop-plan-9x16-v1",
    "json",
  )
})

it("checks raw bytes before UTF-8 decoding can replace invalid sequences", async () => {
  const job = await seam.get()
  const prefix = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n"
  job.artifacts.subtitleReviews.data.revisions[0].contentFingerprint =
    createHash("sha256")
      .update(prefix + "\uFFFD\n")
      .digest("hex")
  seam.bounded.mockResolvedValue(
    Buffer.concat([Buffer.from(prefix), Buffer.from([0xff, 0x0a])]),
  )
  expect((await download(reviewedKey)).status).toBe(409)
})
it("keeps legacy reviewed names downloadable without migrating their metadata", async () => {
  expect((await download("subtitles-fr-reviewed-r0001")).status).toBe(200)
})
