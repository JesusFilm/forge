import type { StudioApply, StudioDocument } from "@forge/studio-contracts"
import {
  orderedStudioSpeech,
  studioEffectiveSpeechSchema,
  STUDIO_SPEECH_FEEDBACK_LIMITS,
  unavailableStudioSpeech,
  type StudioEffectiveSpeech,
} from "@forge/studio-contracts/production"
import { scriptHash, studioHash } from "./state"

/** Final canonical projection only; transcript data grants no approval or creative assurance. */
export function proposalSpeech(
  document: StudioDocument,
  command: StudioApply,
  operationsDigest = studioHash(command.operations),
): StudioEffectiveSpeech {
  const items = orderedStudioSpeech(document).map((item) => ({
    itemId: item.id,
    trackId: item.trackId,
    startFrame: item.startFrame,
    durationInFrames: item.durationInFrames,
    role: item.speech!.role,
    suppressed: item.speech!.suppressed,
    text: item.speech!.text,
    spoken: !item.speech!.suppressed && item.speech!.text.length > 0,
  }))
  const value: StudioEffectiveSpeech = {
    version: 1,
    projectId: command.projectId,
    baseRevision: command.expectedRevision,
    language: document.language,
    operationsDigest,
    scriptDigest: scriptHash(document),
    speechItemCount: items.length,
    spokenItemCount: items.filter((i) => i.spoken).length,
    suppressedItemCount: items.filter((i) => i.suppressed).length,
    emptyItemCount: items.filter((i) => !i.text.length).length,
    exactTextUtf8Bytes: items.reduce(
      (sum, i) => sum + Buffer.byteLength(i.text),
      0,
    ),
    view: "inline",
    complete: true,
    items,
  }
  return studioEffectiveSpeechSchema.parse(
    Buffer.byteLength(JSON.stringify(value)) <=
      STUDIO_SPEECH_FEEDBACK_LIMITS.inlineBytes
      ? value
      : unavailableStudioSpeech(value),
  )
}
