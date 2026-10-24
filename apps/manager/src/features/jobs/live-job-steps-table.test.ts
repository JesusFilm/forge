import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LiveJobStepsTable } from "@/features/jobs/live-job-steps-table"
import type { JobRecord } from "@/types/job"

describe("LiveJobStepsTable", () => {
  it("surfaces source transcript correction status and artifacts", () => {
    const job: JobRecord = {
      id: "job-1",
      muxAssetId: "mux-1",
      muxPlaybackId: "play-1",
      languages: ["fr"],
      options: {},
      status: "completed",
      retries: 0,
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:05:00.000Z",
      artifacts: {
        transcript: { kind: "downloadable" },
        subtitles: { kind: "downloadable" },
        "transcript-correction-report": { kind: "downloadable" },
        "transcript-raw": { kind: "downloadable" },
        "subtitles-raw": { kind: "downloadable" },
      },
      steps: [
        { name: "transcription", status: "completed", retries: 0 },
        {
          name: "structured_transcript",
          status: "completed",
          retries: 0,
          details: {
            transcriptCorrection: {
              status: "applied",
              basis: "model_knowledge",
              contentDomain: "bible_story",
              confidence: 0.96,
              checkedReferenceCount: 1,
              likelyBibleReferences: ["Luke 18:38"],
              appliedCount: 1,
              flaggedCount: 1,
              findings: [
                {
                  action: "applied",
                  category: "scripture_phrase",
                  segmentIndex: 7,
                  start: 56,
                  end: 60,
                  originalText: "Son, the demon",
                  correctedText: "Son of David",
                  rationale:
                    "The blind man in Luke 18 addresses Jesus as Son of David.",
                  confidence: 0.97,
                  basis: "model_knowledge",
                  reference: "Luke 18:38",
                },
              ],
            },
          },
        },
        { name: "translation", status: "pending", retries: 0 },
      ],
      errors: [],
    }

    const markup = renderToStaticMarkup(
      React.createElement(LiveJobStepsTable, { initialJob: job }),
    )

    expect(markup).toContain("Structured Transcript")
    expect(markup).toContain("1 source correction applied; 1 flagged.")
    expect(markup).toContain("Transcript correction report")
    expect(markup).toContain(
      "/api/jobs/job-1/artifacts/transcript-correction-report",
    )
    expect(markup).toContain("Transcript raw")
    expect(markup).toContain("Subtitles raw")
  })
})
