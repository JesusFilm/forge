// POST /api/admin-trigger/scene-analysis — admin-triggered scene-
// analysis pipeline dispatch (feat-119 PR2). This produces non-search
// source artifacts; the scene embedding proxy is retired.
//
// Body: { items: [{ assetId: number, coreId: string }, ...] }
// Auth: bearer in `ADMIN_TRIGGER_API_KEYS` allowlist.
// Response envelope:
//   200 { results: [{ assetId, coreId, managerJobId, status, message? }] }
//   400 invalid JSON / validation failure
//   401 missing or wrong bearer
//   503 ADMIN_TRIGGER_API_KEYS not configured

import {
  processAdminTriggerRequest,
  type AdminTriggerDispatchInput,
} from "@/lib/admin-trigger-route"
import { runSceneAnalysisPipeline } from "@/workflows/sceneAnalysisPipeline"

async function dispatchSceneAnalysis(
  input: AdminTriggerDispatchInput,
): Promise<unknown> {
  return runSceneAnalysisPipeline({
    videoId: input.assetId,
    assetId: String(input.assetId),
    muxAssetId: input.muxAssetId,
    subtitleUrl: input.subtitleUrl,
    videoLabel: input.videoLabel,
    languageCode: input.languageBcp47,
    targetLocale: input.targetLocale,
  })
}

export async function POST(request: Request): Promise<Response> {
  return processAdminTriggerRequest({
    request,
    kind: "scene-analysis",
    dispatch: dispatchSceneAnalysis,
  })
}
