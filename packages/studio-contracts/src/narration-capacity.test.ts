import { expect, it } from "vitest"
import { assertStudioNarrationCapacity } from "./production"
import { studioDocumentSchema } from "./index"
const doc = studioDocumentSchema.parse({
  version: 1,
  title: "Capacity",
  language: "en",
  runtimeVersion: "v1",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 30,
  tracks: [{ id: "main", kind: "visual" }],
  components: [],
  packRevisionIds: [],
  items: [],
})
const speech = {
  text: "Approved.",
  role: "bridge",
  voice: { assetId: "voice", versionId: "version", digest: "a".repeat(64) },
  provider: "elevenlabs",
  model: "eleven_multilingual_v2",
  settings: {},
  pronunciation: null,
  suppressed: false,
}
it("rejects a composition that cannot retain one audio binding per spoken item before dispatch", () => {
  const items = Array.from({ length: 501 }, (_, i) => ({
    id: `item-${i}`,
    kind: "text" as const,
    trackId: "main",
    startFrame: 0,
    durationInFrames: 30,
    text: "",
    properties: {},
    speech,
  }))
  expect(() => assertStudioNarrationCapacity({ ...doc, items })).toThrow(
    "1,000 items",
  )
})
it("reuses existing narration slots and rejects byte overflow without increasing document bounds", () => {
  const item = {
    id: "bridge",
    kind: "text" as const,
    trackId: "main",
    startFrame: 0,
    durationInFrames: 30,
    text: "",
    properties: {},
    speech,
  }
  expect(() =>
    assertStudioNarrationCapacity({ ...doc, items: [item] }),
  ).not.toThrow()
  const big = {
    ...doc,
    items: Array.from({ length: 35 }, (_, i) => ({
      ...item,
      id: `item-${i}`,
      text: "a".repeat(7400),
    })),
  }
  expect(() => assertStudioNarrationCapacity(big)).toThrow("256 KiB")
})
it("rejects dangling and cyclic timing links while allowing arbitrary acyclic layouts", () => {
  const a = {
    id: "a",
    kind: "text" as const,
    trackId: "main",
    startFrame: 0,
    durationInFrames: 30,
    text: "",
    properties: {},
  }
  expect(() =>
    studioDocumentSchema.parse({
      ...doc,
      items: [{ ...a, linkedTo: "missing" }],
    }),
  ).toThrow()
  expect(() =>
    studioDocumentSchema.parse({
      ...doc,
      items: [
        { ...a, linkedTo: "b" },
        { ...a, id: "b", linkedTo: "a" },
      ],
    }),
  ).toThrow()
  expect(() =>
    studioDocumentSchema.parse({
      ...doc,
      items: [a, { ...a, id: "b", linkedTo: "a" }],
    }),
  ).not.toThrow()
})
