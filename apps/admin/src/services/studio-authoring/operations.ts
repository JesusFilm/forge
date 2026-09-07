import {
  studioDocumentSchema,
  studioTextPropertiesSchema,
  type StudioDocument,
  type StudioOperation,
} from "@forge/studio-contracts"
import { StudioCommandError } from "./errors"
import { studioHash } from "./state"

export function applyOperations(
  document: StudioDocument,
  operations: StudioOperation[],
): StudioDocument {
  let doc = structuredClone(document)
  for (const op of operations) {
    if (op.kind === "restore-document") {
      doc = structuredClone(op.document)
      continue
    }
    if (op.kind === "set-metadata") {
      if (op.title !== undefined) doc.title = op.title
      if (op.language !== undefined) doc.language = op.language
      if (op.durationInFrames !== undefined)
        doc.durationInFrames = op.durationInFrames
      continue
    }
    if (op.kind === "insert-item") {
      doc.items.push(op.item)
      continue
    }
    if (op.kind === "add-track") {
      doc.tracks.push(op.track)
      continue
    }
    if (op.kind === "remove-track") {
      doc.tracks = doc.tracks.filter((t) => t.id !== op.trackId)
      continue
    }
    if (op.kind === "register-component") {
      doc.components.push(op.component)
      continue
    }
    if (op.kind === "assign-content-packs") {
      doc.packRevisionIds = op.packRevisionIds
      continue
    }
    const item = doc.items.find((i) => i.id === op.itemId)
    if (!item) throw new StudioCommandError("INVALID")
    switch (op.kind) {
      case "remove-item":
        doc.items = doc.items.filter((i) => i.id !== op.itemId)
        break
      case "move-item":
        item.trackId = op.trackId
        item.startFrame = op.startFrame
        break
      case "set-timing":
        item.durationInFrames = op.durationInFrames
        item.timingLocked = op.timingLocked
        break
      case "set-transform":
        item.transform = op.transform
        break
      case "set-speech":
        if (op.speech) item.speech = op.speech
        else delete item.speech
        break
      case "set-text":
        if (item.kind !== "text") throw new StudioCommandError("INVALID")
        item.text = op.text
        if (item.speech) item.speech.text = op.text
        break
      case "set-properties":
        if (item.kind !== "component" && item.kind !== "text")
          throw new StudioCommandError("INVALID")
        item.properties =
          item.kind === "text"
            ? studioTextPropertiesSchema.parse(op.properties)
            : op.properties
        break
      case "trim-source":
        if (item.kind !== "video") throw new StudioCommandError("INVALID")
        item.source.startMs = op.startMs
        item.source.endMs = op.endMs
        item.durationInFrames = Math.round(
          ((op.endMs - op.startMs) * doc.fps) / 1000,
        )
        break
    }
  }
  // Keep immutable assets in history/cache, but never play previously approved
  // speech after its text, role, language or pronunciation dependency changes.
  doc.items = doc.items.filter((item) => {
    if (item.kind !== "audio" || !item.narrationFor) return true
    const before = document.items.find(
      (i) => i.id === item.narrationFor,
    )?.speech
    const after = doc.items.find((i) => i.id === item.narrationFor)?.speech
    return Boolean(
      after &&
      !after.suppressed &&
      after.text.length &&
      document.language === doc.language &&
      studioHash(before) === studioHash(after),
    )
  })
  return studioDocumentSchema.parse(doc)
}
