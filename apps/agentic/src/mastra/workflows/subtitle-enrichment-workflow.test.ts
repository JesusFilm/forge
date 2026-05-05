import { describe, expect, it } from "vitest"

import {
  SUBTITLE_ENRICHMENT_WORKFLOW_ID,
  launchSubtitleEnrichmentWorkflow,
} from "./subtitle-enrichment-workflow"

const request = {
  jobId: "job-1",
  videoDocumentId: "video-1",
  assetId: "asset-1",
  muxAssetId: "mux-asset-1",
  muxPlaybackId: "mux-playback-1",
  sourceLanguage: "en",
  targetLanguage: "fr",
  materialization: {
    mode: "direct_mux_asset_reuse" as const,
    targetEnvironment: "mux-production" as const,
  },
  requestedBy: { kind: "service" as const, id: "manager" },
  idempotencyKey: "manager:job-1:subtitle:fr",
}

describe("launchSubtitleEnrichmentWorkflow", () => {
  it("returns a queued Agentic run id for an approved Manager job", async () => {
    await expect(launchSubtitleEnrichmentWorkflow(request)).resolves.toEqual({
      ok: true,
      agenticRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
      managerJobId: "job-1",
      status: "queued",
      summary: "Subtitle enrichment run queued.",
    })
  })

  it("exports the Studio-visible workflow id", () => {
    expect(SUBTITLE_ENRICHMENT_WORKFLOW_ID).toBe("subtitle-enrichment-workflow")
  })
})
