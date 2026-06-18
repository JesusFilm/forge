import { describe, expect, it } from "vitest"
import {
  buildDownloadableArtifactManifest,
  buildJobArtifactHref,
  formatJobArtifactLabel,
  getArtifactsForStep,
  getJobArtifactStorageAssetId,
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
    expect(resolveJobArtifactDescriptor("subtitle-validation-ja")).toEqual({
      artifactType: "subtitle-validation-ja",
      ext: "json",
      contentType: "application/json",
    })
  })

  it("resolves audio review artifact descriptors", () => {
    expect(resolveJobArtifactDescriptor("original-audio")).toEqual({
      artifactType: "original-audio",
      ext: "mp3",
      contentType: "audio/mpeg",
    })
    expect(resolveJobArtifactDescriptor("cleaned-audio")).toEqual({
      artifactType: "cleaned-audio",
      ext: "mp3",
      contentType: "audio/mpeg",
    })
  })

  it("resolves the chapters-vtt descriptor", () => {
    expect(resolveJobArtifactDescriptor("chapters-vtt")).toEqual({
      artifactType: "chapters-vtt",
      ext: "vtt",
      contentType: "text/vtt; charset=utf-8",
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
        label: "Transcript JSON",
        url: "/api/jobs/job-1/artifacts/transcript",
      },
      {
        key: "subtitles",
        label: "Subtitles VTT",
        url: "/api/jobs/job-1/artifacts/subtitles",
      },
    ])
  })

  it("maps source transcript correction artifacts to the structured transcript step", () => {
    expect(
      getArtifactsForStep("structured_transcript", "job-1", {
        "transcript-correction-report": { kind: "downloadable" },
        "transcript-raw": { kind: "downloadable" },
        "subtitles-raw": { kind: "downloadable" },
        transcript: { kind: "downloadable" },
        subtitles: { kind: "downloadable" },
      }),
    ).toEqual([
      {
        key: "transcript-correction-report",
        label: "Transcript correction report",
        url: "/api/jobs/job-1/artifacts/transcript-correction-report",
      },
      {
        key: "transcript-raw",
        label: "Transcript raw",
        url: "/api/jobs/job-1/artifacts/transcript-raw",
      },
      {
        key: "subtitles-raw",
        label: "Subtitles raw",
        url: "/api/jobs/job-1/artifacts/subtitles-raw",
      },
    ])
  })

  it("collects and sorts per-language translation artifacts", () => {
    expect(
      getArtifactsForStep("translation", "job-1", {
        "translation-es": { kind: "downloadable" },
        "subtitles-es": { kind: "downloadable" },
        "subtitle-validation-es": { kind: "downloadable" },
        "translation-ar": { kind: "downloadable" },
        materialization: {
          kind: "metadata",
          data: { sourceVideoCoreId: "video-1" },
        },
      }),
    ).toEqual([
      {
        key: "subtitles-es",
        label: "Subtitles es",
        url: "/api/jobs/job-1/artifacts/subtitles-es",
      },
      {
        key: "subtitle-validation-es",
        label: "Subtitle validation es",
        url: "/api/jobs/job-1/artifacts/subtitle-validation-es",
      },
      {
        key: "translation-ar",
        label: "Translation ar",
        url: "/api/jobs/job-1/artifacts/translation-ar",
      },
      {
        key: "translation-es",
        label: "Translation es",
        url: "/api/jobs/job-1/artifacts/translation-es",
      },
    ])
  })

  it("maps audio review artifacts to the audio cleanup step", () => {
    expect(
      getArtifactsForStep("audio_cleanup", "job-1", {
        "cleaned-audio": { kind: "downloadable" },
        "original-audio": { kind: "downloadable" },
      }),
    ).toEqual([
      {
        key: "original-audio",
        label: "Audio raw",
        url: "/api/jobs/job-1/artifacts/original-audio",
      },
      {
        key: "cleaned-audio",
        label: "Audio clean",
        url: "/api/jobs/job-1/artifacts/cleaned-audio",
      },
    ])
  })

  it("returns both chapter artifacts when present", () => {
    expect(
      getArtifactsForStep("chapters", "job-1", {
        chapters: { kind: "downloadable" },
        "chapters-vtt": { kind: "downloadable" },
      }),
    ).toEqual([
      {
        key: "chapters",
        label: "Chapters JSON",
        url: "/api/jobs/job-1/artifacts/chapters",
      },
      {
        key: "chapters-vtt",
        label: "Chapters VTT",
        url: "/api/jobs/job-1/artifacts/chapters-vtt",
      },
    ])
  })

  it("keeps older chapter manifests working when only json is present", () => {
    expect(
      getArtifactsForStep("chapters", "job-1", {
        chapters: { kind: "downloadable" },
      }),
    ).toEqual([
      {
        key: "chapters",
        label: "Chapters JSON",
        url: "/api/jobs/job-1/artifacts/chapters",
      },
    ])
  })

  it("resolves smart-crop artifact descriptors with the versioned types", () => {
    expect(resolveJobArtifactDescriptor("smart-crop-fingerprint")).toEqual({
      artifactType: "smart-crop-fingerprint-v1",
      ext: "json",
      contentType: "application/json",
    })
    expect(resolveJobArtifactDescriptor("smart-crop-plan")).toEqual({
      artifactType: "smart-crop-plan-9x16-v1",
      ext: "json",
      contentType: "application/json",
    })
    expect(resolveJobArtifactDescriptor("smart-crop-timeline-map")).toEqual({
      artifactType: "smart-crop-timeline-map-v1",
      ext: "json",
      contentType: "application/json",
    })
    expect(resolveJobArtifactDescriptor("smart-crop-qa")).toEqual({
      artifactType: "smart-crop-qa-9x16-v1",
      ext: "json",
      contentType: "application/json",
    })
    expect(resolveJobArtifactDescriptor("smart-crop-preview")).toEqual({
      artifactType: "smart-crop-preview-9x16",
      ext: "mp4",
      contentType: "video/mp4",
    })
    expect(resolveJobArtifactDescriptor("smart-crop-output")).toEqual({
      artifactType: "smart-crop-output-9x16",
      ext: "mp4",
      contentType: "video/mp4",
    })
    expect(
      resolveJobArtifactDescriptor("smart-crop-render-report-preview"),
    ).toEqual({
      artifactType: "smart-crop-render-report-9x16-preview",
      ext: "json",
      contentType: "application/json",
    })
    expect(
      resolveJobArtifactDescriptor("smart-crop-render-report-full"),
    ).toEqual({
      artifactType: "smart-crop-render-report-9x16-full",
      ext: "json",
      contentType: "application/json",
    })
  })

  it("resolves smart-crop preview frame descriptors dynamically", () => {
    expect(
      resolveJobArtifactDescriptor("smart-crop-preview-frame-9x16-001"),
    ).toEqual({
      artifactType: "smart-crop-preview-frame-9x16-001",
      ext: "jpg",
      contentType: "image/jpeg",
    })
    expect(
      resolveJobArtifactDescriptor("smart-crop-preview-frame-9x16-1"),
    ).toBeNull()
  })

  it("resolves smart-crop attempt artifacts dynamically", () => {
    expect(resolveJobArtifactDescriptor("smart-crop-plan-attempt-001")).toEqual(
      {
        artifactType: "smart-crop-plan-9x16-attempt-001-v1",
        ext: "json",
        contentType: "application/json",
      },
    )
    expect(
      resolveJobArtifactDescriptor(
        "smart-crop-preview-frame-9x16-001-attempt-001",
      ),
    ).toEqual({
      artifactType: "smart-crop-preview-frame-9x16-001-attempt-001",
      ext: "jpg",
      contentType: "image/jpeg",
    })
    expect(formatJobArtifactLabel("smart-crop-qa-attempt-001")).toBe(
      "Smart Crop QA report (attempt 001)",
    )
  })

  it("maps smart-crop artifacts to their steps", () => {
    expect(
      getArtifactsForStep("smart_crop_preview_render", "job-1", {
        "smart-crop-preview": { kind: "downloadable" },
        "smart-crop-render-report-preview": { kind: "downloadable" },
      }).map((artifact) => artifact.key),
    ).toEqual(["smart-crop-preview", "smart-crop-render-report-preview"])
    expect(
      getArtifactsForStep("smart_crop_render", "job-1", {
        "smart-crop-output": { kind: "downloadable" },
        "smart-crop-render-report-full": { kind: "downloadable" },
      }).map((artifact) => artifact.key),
    ).toEqual(["smart-crop-output", "smart-crop-render-report-full"])
  })

  it("resolves the storage assetId from smart-crop options when present", () => {
    expect(
      getJobArtifactStorageAssetId({
        muxAssetId: "mux-1",
        options: {
          smartCrop: {
            kind: "canonical",
            assetId: "asset123",
            targetAspectRatio: "9:16",
            cropMode: "auto",
          },
        },
      }),
    ).toBe("asset123")
    expect(
      getJobArtifactStorageAssetId({ muxAssetId: "mux-1", options: {} }),
    ).toBe("mux-1")
  })
})
