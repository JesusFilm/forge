import { expect, it } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { itemLabel } from "./item-presentation"
import { timelineRows } from "./timeline-layout"
const document = studioDocumentSchema.parse({
  version: 1,
  title: "Custom captions",
  language: "en",
  runtimeVersion: "fixture",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 90,
  tracks: [{ id: "mixed", kind: "visual" }],
  packRevisionIds: [],
  components: [
    {
      versionId: "Captions",
      code: { assetId: "code", versionId: "v1", digest: "a".repeat(64) },
      runtimeVersion: "fixture",
      dependencies: [],
      width: 1080,
      height: 1920,
      duration: { minFrames: 1, maxFrames: 90 },
      assets: [],
      controls: { text: { type: "text", maxLength: 100 } },
    },
  ],
  items: [
    {
      id: "caption",
      kind: "component",
      trackId: "mixed",
      startFrame: 0,
      durationInFrames: 90,
      componentVersionId: "Captions",
      properties: { text: "Hello" },
    },
  ],
})
it("names legacy custom components and presents text controls in Text without altering stored order", () => {
  const before = structuredClone(document)
  expect(itemLabel(document.items[0]!, document)).toBe("Captions")
  expect(timelineRows(document).find((row) => row.items.length)?.group).toBe(
    "Text",
  )
  expect(document).toEqual(before)
})
it("uses authored names and honours explicit Video classification even with text controls", () => {
  const doc = structuredClone(document)
  doc.components[0]!.name = "Film credit"
  doc.components[0]!.category = "video"
  expect(itemLabel(doc.items[0]!, doc)).toBe("Film credit")
  expect(timelineRows(doc).find((row) => row.items.length)?.group).toBe("Video")
})

it("recognises a named caption with no editable text and leaves a texture component in Video", () => {
  const doc = structuredClone(document)
  doc.components[0]!.controls = {}
  const item = doc.items[0]!
  if (item.kind !== "component") throw new Error("Component fixture required")
  item.properties = {}
  expect(timelineRows(doc).find((row) => row.items.length)?.group).toBe("Text")
  doc.components[0]!.name = "Texture background"
  expect(timelineRows(doc).find((row) => row.items.length)?.group).toBe("Video")
})
