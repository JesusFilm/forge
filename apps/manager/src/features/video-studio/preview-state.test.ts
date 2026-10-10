import { expect, it } from "vitest"
import type { StudioDocument } from "@forge/studio-contracts"
import { attachPreparedSources, previewSignature } from "./preview-state"
class StudioPreviewFixtureError extends Error {}

const asset = (id: string) => ({
  assetId: id,
  versionId: id,
  digest: "a".repeat(64),
})
const requested: StudioDocument = {
  version: 1,
  title: "Source",
  language: "english",
  runtimeVersion: "proof",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 120,
  tracks: [{ id: "main", kind: "visual" }],
  components: [],
  packRevisionIds: [],
  items: [
    {
      id: "clip",
      kind: "video",
      volume: 1,
      trackId: "main",
      startFrame: 0,
      durationInFrames: 60,
      source: {
        videoId: "video",
        dubId: "dub",
        editionId: "edition",
        language: "english",
        startMs: 1000,
        endMs: 3000,
        subtitle: {
          trackId: "track",
          editionId: "edition",
          language: "english",
          asset: asset("subtitle"),
        },
        preview: asset("descriptor"),
        export: asset("descriptor"),
      },
    },
  ],
}
const prepared = structuredClone(requested)
if (prepared.items[0]?.kind === "video") {
  prepared.items[0].source.preview = asset("verified-low")
  prepared.items[0].source.export = asset("verified-high")
}
it.each(["edition", "language", "snapshot", "trim"])(
  "rejects delayed materialization after %s changes on the same clip",
  (change) => {
    const current = structuredClone(requested),
      item = current.items[0]!
    if (item.kind !== "video")
      throw new StudioPreviewFixtureError("Video fixture required")
    if (change === "edition") item.source.editionId = "new-edition"
    if (change === "language") item.source.language = "new-language"
    if (change === "snapshot") item.source.preview = asset("new-descriptor")
    if (change === "trim") item.source.startMs = 1500
    expect(previewSignature(current)).not.toBe(previewSignature(requested))
    expect(attachPreparedSources(current, requested, prepared)).toEqual(current)
  },
)
it("attaches verified references while preserving later canvas edits", () => {
  const current = structuredClone(requested)
  current.title = "New title"
  current.items[0]!.startFrame = 30
  const next = attachPreparedSources(current, requested, prepared)
  expect(next.title).toBe("New title")
  expect(next.items[0]!.startFrame).toBe(30)
  expect(next.items[0]).toMatchObject({
    source: { preview: asset("verified-low"), export: asset("verified-high") },
  })
})

it("restages active custom versions after deletion, undo or historical restoration", () => {
  const installed: StudioDocument = {
    ...requested,
    components: [
      {
        versionId: "custom-v1",
        code: asset("code"),
        runtimeVersion: "proof",
        dependencies: [],
        controls: {},
        width: 1920,
        height: 1080,
        duration: { minFrames: 1, maxFrames: 120 },
        assets: [],
      },
    ],
    items: [
      ...requested.items,
      {
        id: "custom",
        kind: "component",
        componentVersionId: "custom-v1",
        trackId: "main",
        startFrame: 0,
        durationInFrames: 60,
        properties: {},
      },
    ],
  }
  const deleted = { ...installed, items: requested.items }
  expect(previewSignature(deleted)).not.toBe(previewSignature(installed))
  expect(previewSignature(deleted)).toBe(previewSignature(requested))
  const edited = structuredClone(installed)
  const item = edited.items.find((i) => i.kind === "component")!
  if (item.kind === "component") item.properties = { title: "New title" }
  expect(previewSignature(edited)).toBe(previewSignature(installed))
})
