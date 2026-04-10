import { describe, expect, it } from "vitest"
import {
  buildDownloadableArtifactManifest,
  buildJobArtifactHref,
  getArtifactsForStep,
  resolveJobArtifactDescriptor,
} from "@/lib/job-artifacts"

describe("job artifact helpers", () => {
  it("builds stable hrefs for job artifact routes", () => {
    expect(buildJobArtifactHref("job-42", "translation-fr")).toBe(
      "/api/jobs/job-42/artifacts/translation-fr",
    )
  })

  it("builds downloadable manifest entries from logical keys", () => {
    expect(
      buildDownloadableArtifactManifest(["transcript", "subtitles-en"]),
    ).toEqual({
      transcript: { kind: "downloadable" },
      "subtitles-en": { kind: "downloadable" },
    })
  })

  it("resolves dynamic translation descriptors", () => {
    expect(resolveJobArtifactDescriptor("subtitles-ja")).toEqual({
      artifactType: "subtitles-ja",
      ext: "vtt",
      contentType: "text/vtt; charset=utf-8",
    })
    expect(resolveJobArtifactDescriptor("translation-ja")).toEqual({
      artifactType: "translation-ja",
      ext: "json",
      contentType: "application/json",
    })
  })

  it("maps exact transcription artifacts to the transcription step", () => {
    expect(
      getArtifactsForStep("transcription", "job-1", {
        transcript: { kind: "downloadable" },
        subtitles: { kind: "downloadable" },
      }),
    ).toEqual([
      {
        key: "transcript",
        url: "/api/jobs/job-1/artifacts/transcript",
      },
      {
        key: "subtitles",
        url: "/api/jobs/job-1/artifacts/subtitles",
      },
    ])
  })

  it("collects and sorts per-language translation artifacts", () => {
    expect(
      getArtifactsForStep("translation", "job-1", {
        "translation-es": { kind: "downloadable" },
        "subtitles-es": { kind: "downloadable" },
        "translation-ar": { kind: "downloadable" },
        materialization: {
          kind: "metadata",
          data: { sourceVideoCoreId: "video-1" },
        },
      }),
    ).toEqual([
      {
        key: "subtitles-es",
        url: "/api/jobs/job-1/artifacts/subtitles-es",
      },
      {
        key: "translation-ar",
        url: "/api/jobs/job-1/artifacts/translation-ar",
      },
      {
        key: "translation-es",
        url: "/api/jobs/job-1/artifacts/translation-es",
      },
    ])
  })
})
