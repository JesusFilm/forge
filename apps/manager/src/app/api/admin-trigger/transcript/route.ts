// POST /api/admin-trigger/transcript — admin-triggered transcript-
// only pipeline dispatch (feat-119 PR2). Inverse direction of
// /api/admin-embeds/transcript.
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
import { runTranscriptOnlyPipeline } from "@/workflows/transcriptOnlyPipeline"

async function dispatchTranscriptOnly(
  input: AdminTriggerDispatchInput,
): Promise<unknown> {
  return runTranscriptOnlyPipeline({
    assetId: String(input.assetId),
    muxAssetId: input.muxAssetId,
    languageCode: input.languageBcp47,
  })
}

export async function POST(request: Request): Promise<Response> {
  return processAdminTriggerRequest({
    request,
    kind: "transcript",
    dispatch: dispatchTranscriptOnly,
  })
}
