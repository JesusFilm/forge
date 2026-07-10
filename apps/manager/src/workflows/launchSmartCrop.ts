import { start } from "workflow/api"
import {
  runSmartCropCanonical,
  runSmartCropLocalized,
  type SmartCropCanonicalWorkflowInput,
  type SmartCropLocalizedWorkflowInput,
} from "@/workflows/smartCrop"

export type LaunchSmartCropInput =
  | ({ kind: "canonical" } & SmartCropCanonicalWorkflowInput)
  | ({ kind: "localized" } & SmartCropLocalizedWorkflowInput)

export async function launchSmartCrop(input: LaunchSmartCropInput) {
  const base: SmartCropCanonicalWorkflowInput = {
    jobId: input.jobId,
    assetId: input.assetId,
    muxAssetId: input.muxAssetId,
    playbackId: input.playbackId,
    cropMode: input.cropMode,
    model: input.model,
    force: input.force,
  }

  if (input.kind === "localized") {
    return start(runSmartCropLocalized, [
      {
        ...base,
        canonicalAssetId: input.canonicalAssetId,
        language: input.language,
      },
    ])
  }

  return start(runSmartCropCanonical, [base])
}
