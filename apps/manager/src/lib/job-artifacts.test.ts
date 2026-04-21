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
        label: "Transcript raw",
        url: "/api/jobs/job-1/artifacts/transcript",
      },
      {
        key: "subtitles",
        label: "Subtitles processed",
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
        label: "Subtitles es",
        url: "/api/jobs/job-1/artifacts/subtitles-es",
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
})
