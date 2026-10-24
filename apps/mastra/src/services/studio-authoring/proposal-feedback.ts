import type { StudioApply } from "@forge/studio-contracts"
import {
  studioProposalValidationResultSchema,
  STUDIO_SPEECH_FEEDBACK_LIMITS,
  unavailableStudioSpeech,
} from "@forge/studio-contracts/production"
import { studioHash, StudioBoundaryError } from "@forge/studio-server"

/** Authenticated canonical data, never an instruction, approval, or quality verdict. */
export function proposalFeedback(raw: unknown, command: StudioApply) {
  const parsed = studioProposalValidationResultSchema.safeParse(raw)
  if (
    !parsed.success ||
    parsed.data.projectId !== command.projectId ||
    parsed.data.revision !== command.expectedRevision ||
    parsed.data.effectiveSpeech.operationsDigest !==
      studioHash(command.operations)
  )
    throw new StudioBoundaryError("Canonical proposal feedback rejected", 400)
  const { valid, projectId, revision, effectiveSpeech } = parsed.data
  const result = {
    proposed: true,
    applied: false,
    validation: { valid, projectId, revision, effectiveSpeech },
  }
  if (
    Buffer.byteLength(JSON.stringify(result)) >
    STUDIO_SPEECH_FEEDBACK_LIMITS.nativeBytes
  )
    result.validation.effectiveSpeech = unavailableStudioSpeech(effectiveSpeech)
  if (
    Buffer.byteLength(JSON.stringify(result)) >
    STUDIO_SPEECH_FEEDBACK_LIMITS.nativeBytes
  )
    throw new StudioBoundaryError("Canonical proposal feedback rejected", 400)
  return result
}
