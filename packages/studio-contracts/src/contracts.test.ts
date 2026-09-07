import { describe, expect, it } from "vitest"
import { studioDocumentSchema } from "./index"

export const asset = {
  assetId: "asset-1",
  versionId: "v1",
  digest: "a".repeat(64),
}
export const composition = {
  version: 1,
  title: "Custom interview",
  language: "en",
  runtimeVersion: "studio-proof-1",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 1800,
  tracks: [{ id: "main", kind: "visual" }],
  packRevisionIds: [],
  components: [
    {
      versionId: "component-v1",
      code: asset,
      runtimeVersion: "studio-proof-1",
      dependencies: [{ name: "remotion", version: "4.0.475" }],
      width: 1920,
      height: 1080,
      duration: { minFrames: 1, maxFrames: 1800 },
      assets: [],
      controls: {
        title: { type: "text", maxLength: 500 },
        color: { type: "color" },
      },
    },
  ],
  items: [
    {
      id: "custom",
      kind: "component",
      trackId: "main",
      startFrame: 0,
      durationInFrames: 1800,
      componentVersionId: "component-v1",
      properties: { title: "Interview", color: "#123456" },
    },
  ],
}
describe("portable Studio composition", () => {
  it("accepts a new custom component without requiring a devotional arrangement", () => {
    expect(studioDocumentSchema.parse(composition)).toEqual(composition)
    expect(
      studioDocumentSchema.safeParse({
        ...composition,
        items: [
          { ...composition.items[0], properties: { title: "x", color: "red" } },
        ],
      }).success,
    ).toBe(false)
    expect(
      studioDocumentSchema.safeParse({
        ...composition,
        items: [{ ...composition.items[0], componentVersionId: "missing" }],
      }).success,
    ).toBe(false)
  })
  it("supports scoped runtime dependencies and an explicitly absent pronunciation dictionary", () => {
    const doc = structuredClone(composition)
    doc.components[0].dependencies = [
      { name: "@remotion/media", version: "4.0.475" },
    ]
    expect(studioDocumentSchema.safeParse(doc).success).toBe(true)
    expect(
      studioDocumentSchema.safeParse({
        ...doc,
        items: [
          {
            ...doc.items[0],
            speech: {
              text: "Hello",
              role: "bridge",
              suppressed: false,
              voice: asset,
              provider: "provider",
              model: "model",
              settings: {},
              pronunciation: null,
            },
          },
        ],
      }).success,
    ).toBe(true)
  })

  it("rejects undeclared built-in properties and oversized durable documents", () => {
    const item = {
      id: "text",
      kind: "text",
      trackId: "main",
      startFrame: 0,
      durationInFrames: 90,
      text: "Title",
      properties: { arbitraryCode: "not a text control" },
    }
    expect(
      studioDocumentSchema.safeParse({ ...composition, items: [item] }).success,
    ).toBe(false)
    expect(
      studioDocumentSchema.safeParse({
        ...composition,
        items: Array.from({ length: 40 }, (_, i) => ({
          ...item,
          id: "t" + i,
          text: "x".repeat(8000),
          properties: {},
        })),
      }).success,
    ).toBe(false)
  })
})
