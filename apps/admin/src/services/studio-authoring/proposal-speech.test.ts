import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { studioApplySchema, studioProjectSchema } from "@forge/studio-contracts"
import { applyOperations } from "./operations"
import { scriptHash } from "./state"
import { proposalSpeech } from "./proposal-speech"

const evidence = new URL(
  "../../../../../docs/validation/studio-458/model-comparison-1/",
  import.meta.url,
)
const bound = JSON.parse(
  readFileSync(new URL("verified-bound-proposal.body", evidence), "utf8"),
)
const saved = JSON.parse(
  readFileSync(new URL("live/retained-0.body", evidence), "utf8"),
).result.previews[0]
const project = studioProjectSchema.parse(
  bound.cases.find((c: { case: string }) => c.case === "ch33-seq0-ep2").project,
)
const original = JSON.parse(
  readFileSync(
    new URL(
      "../effective-speech-feedback/slot0-original-proposal.json",
      evidence,
    ),
    "utf8",
  ),
)
const command = studioApplySchema.parse({
  ...saved.proposal.command,
  operations: original.operations,
})

it("reports the actual final slot0 speech after ordered set-speech and set-text operations", () => {
  const before = structuredClone(project.document)
  const document = applyOperations(
    project.document,
    structuredClone(command.operations),
  )
  expect(document).toEqual(saved.document)
  const result = proposalSpeech(document, command)
  expect(result.view).toBe("inline")
  if (result.view !== "inline") throw new Error("Expected complete transcript")
  expect(result.complete).toBe(true)
  expect(result.scriptDigest).toBe(scriptHash(document))
  expect(result.items.map((item) => item.text)).toEqual([
    "Jesus does not pass through Jericho as though its old curse makes it beneath his notice.\n\nOn his way toward Bethany, he still stops beneath Zacchaeus's sycomore tree.\n\nGrace sees the man the crowd had already summed up.",
    "Common fame is not righteous judgment.\n\nA sinful past does not prove a sinful present.\n\nThe physician goes where the sick may yet be healed.",
    "Take a quiet breath.\nLet that mercy settle.",
  ])
  expect(project.document).toEqual(before)
})

it("preserves ordering, independent display text, suppression and exact whitespace", () => {
  const document = applyOperations(
    project.document,
    structuredClone(command.operations),
  )
  const first = document.items.find((item) => item.speech)
  if (!first?.speech || first.kind !== "text")
    throw new Error("Missing text speech fixture")
  const text = "  café\n\t ",
    speech = { ...first.speech, text: "Different spoken words" }
  const forward = [
    { kind: "set-speech" as const, itemId: first.id, speech },
    { kind: "set-text" as const, itemId: first.id, text },
  ]
  const a = applyOperations(document, structuredClone(forward)),
    b = applyOperations(document, structuredClone([...forward].reverse()))
  expect(a.items.find((i) => i.id === first.id)?.speech?.text).toBe(text)
  expect(b.items.find((i) => i.id === first.id)?.speech?.text).toBe(speech.text)
  const x = proposalSpeech(a, { ...command, operations: forward }),
    y = proposalSpeech(b, { ...command, operations: [...forward].reverse() })
  expect(x.operationsDigest).not.toBe(y.operationsDigest)
  expect(x.scriptDigest).not.toBe(y.scriptDigest)
  const removed = applyOperations(document, [
    { kind: "set-speech", itemId: first.id, speech: null },
    { kind: "set-text", itemId: first.id, text },
  ])
  expect(removed.items.find((i) => i.id === first.id)?.speech).toBeUndefined()
  document.items.reverse()
  document.items.forEach((item, index) => {
    item.startFrame = 0
    if (item.speech) {
      item.speech.role = "custom-role"
      item.speech.suppressed = index === 0
      item.speech.text = index === 0 ? "" : text
    }
  })
  const result = proposalSpeech(document, command)
  if (result.view !== "inline") throw new Error("Expected inline")
  expect(result.items.map((i) => i.itemId)).toEqual(
    [...result.items.map((i) => i.itemId)].sort(),
  )
  expect(result.suppressedItemCount).toBe(1)
  expect(result.emptyItemCount).toBe(1)
  expect(result.spokenItemCount).toBe(2)
  expect(result.items.every((i) => i.role === "custom-role")).toBe(true)
  expect(result.items.filter((i) => i.spoken).map((i) => i.text)).toEqual([
    text,
    text,
  ])
})

it("binds voice settings and pronunciation without changing transcript bytes", () => {
  const document = applyOperations(
    project.document,
    structuredClone(command.operations),
  )
  const original = proposalSpeech(document, command)
  for (const mutate of [
    (speech: NonNullable<(typeof document.items)[number]["speech"]>) => {
      speech.settings = { speed: 0.9 }
    },
    (speech: NonNullable<(typeof document.items)[number]["speech"]>) => {
      speech.pronunciation = {
        ...speech.voice,
        versionId: "another-pronunciation",
      }
    },
    (speech: NonNullable<(typeof document.items)[number]["speech"]>) => {
      speech.voice = { ...speech.voice, versionId: "another-voice" }
    },
  ]) {
    const changed = structuredClone(document)
    const item = changed.items.find((i) => i.speech)
    if (!item?.speech) throw new Error("Missing speech")
    mutate(item.speech)
    const result = proposalSpeech(changed, command)
    expect(result.scriptDigest).not.toBe(original.scriptDigest)
    if (result.view !== "inline" || original.view !== "inline")
      throw new Error("Expected inline")
    expect(result.items).toEqual(original.items)
  }
})

it("returns complete or explicitly unavailable feedback at exact UTF-8/escaping bounds", () => {
  const document = applyOperations(
    project.document,
    structuredClone(command.operations),
  )
  const template = document.items[0]
  if (!template.speech) throw new Error("Missing speech")
  document.items = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(template),
    id: `item-${index}`,
    speech: {
      ...template.speech!,
      text: index === 0 ? '🙂\n"' + "x".repeat(6995) : "x".repeat(7000),
    },
  }))
  const baseline = proposalSpeech(document, command)
  if (baseline.view !== "inline") throw new Error("Expected initial inline")
  const padding = 30720 - Buffer.byteLength(JSON.stringify(baseline))
  // Distribute padding so every item remains below its existing 8000-char limit.
  for (let index = 0; index < padding; index++)
    document.items[index % 4].speech!.text += "x"
  const exact = proposalSpeech(document, command)
  expect(exact.view).toBe("inline")
  expect(Buffer.byteLength(JSON.stringify(exact))).toBe(30720)
  document.items[0].speech!.text += "x"
  const unavailable = proposalSpeech(document, command)
  expect(unavailable).toMatchObject({
    view: "unavailable",
    complete: false,
    reason: "INLINE_BYTE_LIMIT",
    speechItemCount: 4,
  })
  expect(unavailable).not.toHaveProperty("items")
  document.items[0].speech!.text = document.items[0].speech!.text.slice(0, -2)
  const below = proposalSpeech(document, command)
  expect(below.view).toBe("inline")
  expect(Buffer.byteLength(JSON.stringify(below))).toBe(30719)
  document.items = Array.from({ length: 1000 }, (_, index) => ({
    ...structuredClone(template),
    id: `many-${index}`,
  }))
  expect(proposalSpeech(document, command)).toMatchObject({
    view: "unavailable",
    complete: false,
    speechItemCount: 1000,
  })
})
