import { expect, it } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { itemLabel, isTextComponent } from "./item-presentation"
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
it("keeps legacy text components in the visual stack without altering stored order", () => {
  const before = structuredClone(document)
  expect(itemLabel(document.items[0]!, document)).toBe("Captions")
  expect(timelineRows(document).find((row) => row.items.length)?.group).toBe(
    "Visual",
  )
  expect(document).toEqual(before)
})
it("preserves component metadata while sharing the visual stack", () => {
  const doc = structuredClone(document)
  doc.components[0]!.name = "Film credit"
  doc.components[0]!.category = "video"
  expect(itemLabel(doc.items[0]!, doc)).toBe("Film credit")
  expect(isTextComponent(doc.items[0]!, doc)).toBe(false)
  expect(timelineRows(doc).find((row) => row.items.length)?.group).toBe(
    "Visual",
  )
})

it("keeps named captions and texture components in the same visual stack", () => {
  const doc = structuredClone(document)
  doc.components[0]!.controls = {}
  const item = doc.items[0]!
  if (item.kind !== "component") throw new Error("Component fixture required")
  item.properties = {}
  expect(isTextComponent(item, doc)).toBe(true)
  expect(timelineRows(doc).find((row) => row.items.length)?.group).toBe(
    "Visual",
  )
  doc.components[0]!.name = "Texture background"
  expect(isTextComponent(item, doc)).toBe(false)
  expect(timelineRows(doc).find((row) => row.items.length)?.group).toBe(
    "Visual",
  )
})
