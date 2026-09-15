import { expect, it } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { StudioProposalFieldError } from "@forge/studio-contracts/production"
import { applyOperations } from "./operations"
const document = studioDocumentSchema.parse({
  version: 1,
  title: "Any subject",
  language: "en",
  runtimeVersion: "fixture",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 90,
  tracks: [{ id: "main", kind: "visual" }],
  packRevisionIds: [],
  components: [
    {
      versionId: "custom",
      runtimeVersion: "fixture",
      code: { assetId: "code", versionId: "code-v1", digest: "a".repeat(64) },
      dependencies: [],
      assets: [],
      width: 1080,
      height: 1920,
      duration: { minFrames: 1, maxFrames: 90 },
      controls: { fontSize: { type: "text", maxLength: 100 } },
    },
  ],
  items: [
    {
      id: "text",
      trackId: "main",
      startFrame: 0,
      durationInFrames: 30,
      kind: "text",
      text: "Any content",
      properties: {},
    },
    {
      id: "component",
      trackId: "main",
      startFrame: 30,
      durationInFrames: 30,
      kind: "component",
      componentVersionId: "custom",
      properties: { fontSize: "custom component content" },
    },
  ],
})
it("retains strict text types without restricting a component's own text control", () => {
  const before = structuredClone(document)
  expect(() =>
    applyOperations(document, [
      {
        kind: "set-properties",
        itemId: "text",
        properties: {
          fontSize: "private-value",
          fontWeight: "private-value",
          color: 7,
          fontFamily: false,
        },
      },
    ]),
  ).toThrow(StudioProposalFieldError)
  try {
    applyOperations(document, [
      {
        kind: "set-properties",
        itemId: "text",
        properties: {
          fontSize: "private-value",
          fontWeight: "private-value",
          color: 7,
          fontFamily: false,
        },
      },
    ])
  } catch (error) {
    expect(error).toMatchObject({
      feedback: {
        code: "PROPOSAL_FIELD_TYPE_MISMATCH",
        issues: expect.arrayContaining([
          {
            path: ["operations", 0, "properties", "fontSize"],
            expected: "number",
          },
          {
            path: ["operations", 0, "properties", "color"],
            expected: "string",
          },
        ]),
      },
    })
    expect(JSON.stringify(error)).not.toContain("private-value")
    expect(JSON.stringify(error).length).toBeLessThan(4096)
  }
  expect(document).toEqual(before)
  const changed = applyOperations(document, [
    {
      kind: "set-properties",
      itemId: "component",
      properties: { fontSize: "still dynamic component content" },
    },
  ])
  expect(changed.items[1]).toMatchObject({
    properties: { fontSize: "still dynamic component content" },
  })
  expect(document).toEqual(before)
})
it("keeps unknown text properties and non-type validation strict", () => {
  const invalidProperties: Record<string, string | number | boolean>[] = [
    { privateKeyName: "private-value" },
    { fontSize: 0 },
    { color: "not-a-color" },
  ]
  for (const properties of invalidProperties)
    expect(() =>
      applyOperations(document, [
        { kind: "set-properties", itemId: "text", properties },
      ]),
    ).toThrow()
})
