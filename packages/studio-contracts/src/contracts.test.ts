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

it("validates canonical subtitle markup for the selected range without altering retained bytes", async () => {
  const { parseStudioVtt } = await import("./sources")
  const bytes = new TextEncoder().encode(
    "WEBVTT\n\n00:28.000 --> 00:31.000\nSelected words\n\n08:01.670 --> 08:07.060\n<script>Later words</script>\n\n1:00:00.130 --> 1:00:03.000\nOne hour later\n",
  )
  expect(parseStudioVtt(bytes, { startMs: 28600, endMs: 30600 })).toEqual([
    { startMs: 28000, endMs: 31000, text: "Selected words" },
  ])
  expect(() =>
    parseStudioVtt(bytes, { startMs: 481670, endMs: 487060 }),
  ).toThrow("Unsupported subtitle cue")
  expect(() => parseStudioVtt(bytes)).toThrow("Unsupported subtitle cue")
})

it("reads formatted canonical dialogue without changing subtitle bytes", async () => {
  const { parseStudioVtt } = await import("./sources")
  const raw =
    "WEBVTT\n\n00:02.150 --> 00:10.440\n<b>Let us go <i>across</i> &amp; rest.</b>\n"
  const bytes = new TextEncoder().encode(raw)
  expect(parseStudioVtt(bytes)).toEqual([
    { startMs: 2150, endMs: 10440, text: "Let us go across & rest." },
  ])
  expect(new TextDecoder().decode(bytes)).toBe(raw)
})

it.each([
  "<script>words</script>",
  "<b onclick='x'>words</b>",
  "<b>words</i>",
  "<b></b>",
  "<b>words",
])("rejects unsupported or malformed cue %s", async (cue) => {
  const { parseStudioVtt } = await import("./sources")
  expect(() =>
    parseStudioVtt(
      new TextEncoder().encode(`WEBVTT\n\n00:00.000 --> 00:01.000\n${cue}\n`),
    ),
  ).toThrow("Unsupported subtitle cue")
})

it("rejects long malformed formatting without repeatedly scanning its prefix", async () => {
  const { parseStudioVtt } = await import("./sources")
  expect(() =>
    parseStudioVtt(
      new TextEncoder().encode(
        "WEBVTT\n\n00:00.000 --> 00:01.000\n" + "<".repeat(100000),
      ),
    ),
  ).toThrow("Unsupported subtitle cue")
})
