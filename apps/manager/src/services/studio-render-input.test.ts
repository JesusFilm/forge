import { createServer } from "node:http"
import { createHash, createHmac } from "node:crypto"
import { afterAll, beforeAll, expect, it, vi } from "vitest"
import type { StudioAssetReference } from "@forge/studio-contracts"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import type { StudioBrokerClient } from "./studio-broker"
const config = vi.hoisted(() => ({ ADMIN_GRAPHQL_URL: "" }))
vi.mock("@/config/env", () => ({ env: config }))
import { prepareStudioRenderInput } from "./studio-render-input"
const bytes = new Map<string, Buffer>(),
  metadata = new Map<string, unknown>()
let corrupt = false
const server = createServer((req, res) => {
  const key = req.url?.split("/").at(-1) ?? ""
  const data = bytes.get(key)
  if (!data) {
    res.writeHead(404).end()
    return
  }
  res.end(corrupt ? Buffer.from("altered") : data)
})
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Fixture address required")
  config.ADMIN_GRAPHQL_URL = `http://127.0.0.1:${address.port}/api/graphql`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done) => server.close(() => done()))
})
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(",")}}`
      : (JSON.stringify(v) ?? "null")
const proofKey = "task-local-retained-source-fixture-key"
function asset(
  name: string,
  value: string,
  recorded: Record<string, unknown> = {},
): StudioAssetReference {
  const body = Buffer.from(value),
    digest = createHash("sha256").update(body).digest("hex")
  const reference = { assetId: name, versionId: name, digest }
  bytes.set(digest, body)
  metadata.set(name, {
    reference,
    mediaAssetId: name,
    filename: name,
    mimeType: "application/json",
    byteSize: body.length,
    role: "manifest",
    provenance: { status: "recorded", recorded },
    narration: null,
    voice: null,
    actor: { kind: "service", id: "manager_backend" },
  })
  return reference
}
function fixture() {
  const previewSegment = asset("preview-segment", "LOW RESOLUTION"),
    exportSegment = asset("export-segment", "EXPORT RESOLUTION")
  const placeholder = asset("placeholder", "original descriptor"),
    catalogDigest = "a".repeat(64)
  const source = {
    videoId: "video",
    dubId: "dub",
    editionId: "edition",
    language: "english",
    subtitle: {
      trackId: "caption",
      editionId: "edition",
      language: "english",
      asset: placeholder,
    },
    preview: placeholder,
    export: placeholder,
    startMs: 500,
    endMs: 1500,
  }
  const snapshot = {
    id: "retained",
    source,
    durationMs: 2000,
    downloadId: "download",
    hlsUrl: "https://stream.mux.com/never-fetch.m3u8",
    downloadUrl: "https://stream.mux.com/never-fetch.mp4",
    subtitleUrl: "https://stream.mux.com/never-fetch.vtt",
    catalogDigest,
    restrictions: [],
    materialization: "broker-manifest",
    originalByteDigest: null,
    coveredRanges: [{ startMs: 0, endMs: 2000 }],
    exportHeight: 1080,
    subtitlePrimary: true,
    subtitleAiGenerated: false,
  }
  for (const purpose of ["preview", "export"] as const) {
    const playlist = asset(
      `${purpose}-playlist`,
      `${purpose} retained playlist`,
    )
    const proof = {
      playlist,
      sourceStartMs: 0,
      segmentDurations: [2],
      verification: "decoded-h264-v1",
    }
    const manifest = {
      sourceSnapshotId: "original",
      catalogDigest,
      purpose,
      height: purpose === "preview" ? 270 : 1080,
      ranges: [{ startMs: 0, endMs: 2000 }],
      media: [purpose === "preview" ? previewSegment : exportSegment],
    }
    const ref = asset(`${purpose}-manifest`, JSON.stringify(manifest))
    const proofSignature = createHmac("sha256", proofKey)
      .update(`${ref.digest}:${canonical(proof)}`)
      .digest("hex")
    asset(`${purpose}-manifest`, JSON.stringify(manifest), {
      ...proof,
      proofSignature,
    })
    source[purpose] = ref
  }
  const code =
    "throw new Error('MUST NEVER EXECUTE IN BROKER'); export default function Component(){return null}"
  const componentCode = asset("code", code)
  const document = {
    version: 1,
    title: "Retained export",
    language: "english",
    runtimeVersion: STUDIO_RUNTIME_VERSION,
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30,
    tracks: [{ id: "visual", kind: "visual" }],
    components: [
      {
        versionId: "component",
        code: componentCode,
        runtimeVersion: STUDIO_RUNTIME_VERSION,
        width: 320,
        height: 180,
        duration: { minFrames: 1, maxFrames: 30 },
        dependencies: [],
        assets: [],
        controls: {},
      },
    ],
    packRevisionIds: [],
    items: [
      {
        id: "video-item",
        kind: "video",
        trackId: "visual",
        startFrame: 0,
        durationInFrames: 30,
        source,
        volume: 0,
      },
      {
        id: "component-item",
        kind: "component",
        trackId: "visual",
        startFrame: 0,
        durationInFrames: 30,
        componentVersionId: "component",
        properties: {},
      },
    ],
  }
  const actions: string[] = []
  const call: StudioBrokerClient = async (action, input) => {
    actions.push(action)
    if (action === "preview-sources")
      return [{ snapshot, itemId: "video-item", startMs: 500, endMs: 1500 }]
    if (action === "source") return snapshot
    const ref = input as StudioAssetReference
    if (action === "asset") return metadata.get(ref.versionId)
    if (action === "asset-read")
      return { path: `/api/shorts/assets/transfer/${ref.digest}` }
    throw new Error(`Unexpected action ${action}`)
  }
  return { document, snapshot, call, actions, code }
}
it("reads high-resolution retained export bytes and preserves custom code without executing or staging it", async () => {
  const f = fixture(),
    result = await prepareStudioRenderInput(
      f.call,
      "project",
      f.document,
      proofKey,
      new AbortController().signal,
    )
  expect(
    result.files.some(
      (file) =>
        Buffer.from(file.base64, "base64").toString() === "EXPORT RESOLUTION",
    ),
  ).toBe(true)
  expect(
    result.files.some(
      (file) =>
        Buffer.from(file.base64, "base64").toString() === "LOW RESOLUTION",
    ),
  ).toBe(false)
  expect(result.input.code.component).toBe(f.code)
  expect(result.input.document).toEqual(f.document)
  expect(result.input.media["video-item"]?.sourceStartMs).toBe(0)
  expect(
    f.actions.every((action) =>
      ["preview-sources", "source", "asset", "asset-read"].includes(action),
    ),
  ).toBe(true)
})
it("rejects descriptors and missing codec authority instead of downloading original sources", async () => {
  const f = fixture()
  f.snapshot.materialization = "descriptor"
  await expect(
    prepareStudioRenderInput(
      f.call,
      "project",
      f.document,
      proofKey,
      new AbortController().signal,
    ),
  ).rejects.toThrow("retained export bytes")
  expect(f.actions).toEqual(["preview-sources"])
  f.snapshot.materialization = "broker-manifest"
  await expect(
    prepareStudioRenderInput(
      f.call,
      "project",
      f.document,
      "wrong key",
      new AbortController().signal,
    ),
  ).rejects.toThrow("codec authority")
})
it("fails a changed retained byte digest before dispatch", async () => {
  const f = fixture()
  corrupt = true
  try {
    await expect(
      prepareStudioRenderInput(
        f.call,
        "project",
        f.document,
        proofKey,
        new AbortController().signal,
      ),
    ).rejects.toThrow("digest changed")
  } finally {
    corrupt = false
  }
})
