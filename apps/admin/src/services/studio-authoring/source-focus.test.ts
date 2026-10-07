import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, it } from "vitest"
import { studioCreateSchema, studioApplySchema } from "@forge/studio-contracts"
import { applyOperations } from "./operations"
const examples = resolve(
  import.meta.dirname,
  "../../../../../skills/shorts-creator/examples",
)
const input = (name: string) =>
  JSON.parse(readFileSync(resolve(examples, `${name}.json`), "utf8"))
it("reframes a source through domain operations while preserving timing, source evidence, overlays and music", () => {
  const document = applyOperations(
    studioCreateSchema.parse(input("create")).document,
    studioApplySchema.parse(input("compose")).operations,
  )
  const item = document.items.find((item) => item.kind === "video")!
  const operation = {
    kind: "set-source-focus",
    itemId: item.id,
    focus: { x: 0, y: 0.5 },
  } as const
  const parsed = studioApplySchema.parse({
    projectId: "project",
    expectedRevision: 1,
    idempotencyKey: "reframe",
    operations: [operation],
  })
  const reframed = applyOperations(document, parsed.operations)
  expect(reframed).toEqual({
    ...document,
    items: document.items.map((i) =>
      i.id === item.id ? { ...i, focus: operation.focus } : i,
    ),
  })
  const text = document.items.find((i) => i.kind === "text")!
  expect(() =>
    applyOperations(document, [{ ...operation, itemId: text.id }]),
  ).toThrow("INVALID")
})
