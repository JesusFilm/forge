import { describe, expect, it } from "vitest"
import { FORGE_WORKFLOW_STEPS } from "@/lib/workflow-steps"
import {
  cmsVideoToClientVideo,
  collectionToClientVideo,
  computeCoverageStatus,
  jobToClientVideo,
} from "./coverage-report-model"
import type { JobRecord, JobStepState } from "@/types/job"

function buildSteps(completedCount: number): JobStepState[] {
  return FORGE_WORKFLOW_STEPS.map((name, index) => ({
    name,
    status: index < completedCount ? "completed" : "pending",
    retries: 0,
  }))
}

function buildJob(completedCount: number): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-asset-1",
    muxPlaybackId: "mux-playback-1",
    languages: [],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    artifacts: {},
    steps: buildSteps(completedCount),
    errors: [],
  }
}

function buildCompletedSkippedOptionalStepJob(): JobRecord {
  return {
    ...buildJob(FORGE_WORKFLOW_STEPS.length),
    steps: FORGE_WORKFLOW_STEPS.map((name) => ({
      name,
      status:
        name === "audio_cleanup" ||
        name === "theology_validation_bible_quotes" ||
        name === "seo_improvements"
          ? "skipped"
          : "completed",
      retries: 0,
    })),
  }
}

describe("coverage report model", () => {
  it("classifies job coverage from the canonical workflow step count", () => {
    expect(computeCoverageStatus(buildJob(0))).toBe("none")
    expect(computeCoverageStatus(buildJob(1))).toBe("ai")
    expect(
      computeCoverageStatus(buildJob(FORGE_WORKFLOW_STEPS.length - 1)),
    ).toBe("ai")
    expect(computeCoverageStatus(buildJob(FORGE_WORKFLOW_STEPS.length))).toBe(
      "human",
    )
  })

  it("projects job step completeness with the canonical total", () => {
    const video = jobToClientVideo(buildJob(FORGE_WORKFLOW_STEPS.length))

    expect(video.stepCompleteness).toEqual({
      completed: FORGE_WORKFLOW_STEPS.length,
      total: FORGE_WORKFLOW_STEPS.length,
    })
    expect(video.steps.map((step) => step.name)).toEqual(FORGE_WORKFLOW_STEPS)
  })

  it("counts skipped optional terminal steps as complete for finished jobs", () => {
    const video = jobToClientVideo(buildCompletedSkippedOptionalStepJob())

    expect(video.coverageStatus).toBe("human")
    expect(video.stepCompleteness).toEqual({
      completed: FORGE_WORKFLOW_STEPS.length,
      total: FORGE_WORKFLOW_STEPS.length,
    })
  })

  it("keeps legacy completed jobs human when they predate placeholder steps", () => {
    const legacySteps = FORGE_WORKFLOW_STEPS.filter(
      (name) =>
        name !== "theology_validation_bible_quotes" &&
        name !== "seo_improvements",
    ).map((name) => ({
      name,
      status: "completed" as const,
      retries: 0,
    }))
    const video = jobToClientVideo({
      ...buildJob(FORGE_WORKFLOW_STEPS.length),
      steps: legacySteps,
    })

    expect(video.coverageStatus).toBe("human")
    expect(video.stepCompleteness).toEqual({
      completed: legacySteps.length,
      total: legacySteps.length,
    })
  })

  it("projects CMS videos with the canonical generated step list", () => {
    const video = cmsVideoToClientVideo(
      {
        id: "video-1",
        title: "Video",
        imageUrl: null,
        label: "standalone",
        coverage: {
          subtitles: { human: 1, ai: 0, none: 0 },
          audio: { human: 0, ai: 0, none: 1 },
          meta: { human: 0, ai: 1, none: 0 },
        },
      },
      "subtitles",
    )

    expect(video.steps.map((step) => step.name)).toEqual(FORGE_WORKFLOW_STEPS)
    expect(video.steps.slice(-2)).toEqual([
      expect.objectContaining({
        name: "theology_validation_bible_quotes",
        status: "skipped",
      }),
      expect.objectContaining({
        name: "seo_improvements",
        status: "skipped",
      }),
    ])
    expect(video.stepCompleteness).toEqual({
      completed: FORGE_WORKFLOW_STEPS.length,
      total: FORGE_WORKFLOW_STEPS.length,
    })
  })

  it("projects CMS collections with the canonical generated step list", () => {
    const video = collectionToClientVideo(
      {
        id: "collection-1",
        title: "Collection",
        imageUrl: null,
        label: "collection",
        labelDisplay: "Collection",
        coverage: {
          subtitles: { human: 0, ai: 1, none: 0 },
          audio: { human: 0, ai: 0, none: 1 },
          meta: { human: 0, ai: 0, none: 1 },
        },
        videos: [],
      },
      "subtitles",
    )

    expect(video.steps.map((step) => step.name)).toEqual(FORGE_WORKFLOW_STEPS)
    expect(video.stepCompleteness).toEqual({
      completed: 1,
      total: FORGE_WORKFLOW_STEPS.length,
    })
  })
})
