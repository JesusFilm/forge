import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test, expect } from "vitest"
import { studioCreateSchema, studioApplySchema } from "@forge/studio-contracts"
import { applyOperations } from "./operations"

const examples = resolve(
  import.meta.dirname,
  "../../../../../skills/shorts-creator/examples",
)
const input = (name: string) =>
  JSON.parse(readFileSync(resolve(examples, `${name}.json`), "utf8"))

test("portable examples compose a draft and revise overlay/speech while preserving human timing and music", () => {
  const initial = studioCreateSchema.parse(input("create")).document
  const composed = applyOperations(
    initial,
    studioApplySchema.parse(input("compose")).operations,
  )
  const voiced = applyOperations(
    composed,
    studioApplySchema.parse(input("speech")).operations,
  )
  const humanEdited = applyOperations(voiced, [
    {
      kind: "set-timing",
      itemId: "hook-1",
      durationInFrames: 135,
      timingLocked: true,
    },
    { kind: "set-metadata", title: "Human chosen title" },
  ])
  const revised = applyOperations(
    humanEdited,
    studioApplySchema.parse(input("feedback")).operations,
  )
  const hook = revised.items.find((item) => item.id === "hook-1")!
  expect(hook.kind).toBe("text")
  if (hook.kind !== "text") throw new Error("Expected overlay")
  expect(hook.text).toBe("Make room for kindness.")
  expect(hook.speech?.text).toBe("Make a little room for kindness today.")
  expect(hook.durationInFrames).toBe(135)
  expect(hook.timingLocked).toBe(true)
  const originalHook = voiced.items.find((item) => item.id === "hook-1")!
  if (originalHook.kind !== "text") throw new Error("Expected original overlay")
  expect(hook.properties).toEqual(originalHook.properties)
  expect(hook.transform).toEqual(originalHook.transform)
  expect(revised.title).toBe("Human chosen title")
  expect(revised.items.filter((item) => item.id !== "hook-1")).toEqual(
    humanEdited.items.filter((item) => item.id !== "hook-1"),
  )
})
