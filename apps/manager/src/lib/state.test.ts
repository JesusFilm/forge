import { describe, expect, it } from "vitest"
import {
  buildJobUpdateData,
  mergeArtifactEntries,
  normalizeJobArtifacts,
} from "@/lib/state"

describe("buildJobUpdateData", () => {
  it("serializes explicit currentStep clearing as null", () => {
    expect(
      buildJobUpdateData({
        status: "failed",
        currentStep: undefined,
      }),
    ).toEqual({
      status: "failed",
      currentStep: null,
    })
  })

  it("merges new artifact manifest entries without dropping metadata", () => {
    expect(
      mergeArtifactEntries(
        {
          materialization: {
            kind: "metadata",
            data: { sourceVideoCoreId: "video-1" },
          },
          transcript: { kind: "downloadable" },
        },
        {
          chapters: { kind: "downloadable" },
          metadata: { kind: "downloadable" },
        },
      ),
    ).toEqual({
      materialization: {
        kind: "metadata",
        data: { sourceVideoCoreId: "video-1" },
      },
      transcript: { kind: "downloadable" },
      chapters: { kind: "downloadable" },
      metadata: { kind: "downloadable" },
    })
  })

  it("normalizes legacy artifact values into the new manifest shape", () => {
    expect(
      normalizeJobArtifacts({
        transcript: "/api/jobs/job-1/artifacts/transcript",
        materialization:
          '{"mode":"snapshot_to_stage_clone","sourceVideoCoreId":"video-1"}',
      }),
    ).toEqual({
      transcript: { kind: "downloadable" },
      materialization: {
        kind: "metadata",
        data: {
          mode: "snapshot_to_stage_clone",
          sourceVideoCoreId: "video-1",
        },
      },
    })
  })
})
