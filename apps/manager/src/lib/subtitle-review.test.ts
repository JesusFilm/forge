import { describe, expect, it } from "vitest"
import {
  buildReviewedSubtitleArtifactKey,
  findExistingSubtitleReviewRevision,
  getLatestSubtitleReviewRevision,
  getSubtitleReviewReport,
  setSubtitleReviewReport,
} from "@/lib/subtitle-review"
import type { JobArtifactManifest, SubtitleReviewReport } from "@/types/job"

describe("subtitle review helpers", () => {
  it("builds stable revision artifact keys", () => {
    expect(buildReviewedSubtitleArtifactKey("ja", 1)).toBe(
      "subtitles-ja-reviewed-r0001",
    )
    expect(buildReviewedSubtitleArtifactKey("pt-BR", 42)).toBe(
      "subtitles-pt-BR-reviewed-r0042",
    )
  })

  it("normalizes persisted review metadata and selects the latest source revision", () => {
    const artifacts = {
      subtitleReviews: {
        kind: "metadata",
        data: {
          revisions: [
            {
              artifactKey: "subtitles-fr-reviewed-r0001",
              sourceArtifactKey: "subtitles-fr",
              targetLanguage: "fr",
              revision: 1,
              baseFingerprint: "base-a",
              contentFingerprint: "content-a",
              clientSaveId: "save-a",
              actorId: "user-1",
              createdAt: "2026-04-12T12:00:00.000Z",
            },
            {
              artifactKey: "subtitles-fr-reviewed-r0002",
              sourceArtifactKey: "subtitles-fr",
              targetLanguage: "fr",
              revision: 2,
              baseFingerprint: "base-b",
              contentFingerprint: "content-b",
              clientSaveId: "save-b",
              actorId: "user-1",
              createdAt: "2026-04-12T13:00:00.000Z",
            },
            {
              artifactKey: "subtitles-es-reviewed-r0001",
              sourceArtifactKey: "subtitles-es",
              targetLanguage: "es",
              revision: 1,
              baseFingerprint: "base-c",
              contentFingerprint: "content-c",
              clientSaveId: "save-c",
              actorId: "user-2",
              createdAt: "2026-04-12T14:00:00.000Z",
            },
          ],
          updatedAt: "2026-04-12T14:00:00.000Z",
        },
      },
    } satisfies JobArtifactManifest

    expect(getLatestSubtitleReviewRevision(artifacts, "subtitles-fr")).toEqual(
      expect.objectContaining({
        artifactKey: "subtitles-fr-reviewed-r0002",
        revision: 2,
      }),
    )
  })

  it("writes review metadata without dropping unrelated artifacts", () => {
    const report: SubtitleReviewReport = {
      revisions: [
        {
          artifactKey: "subtitles-ja-reviewed-r0001",
          sourceArtifactKey: "subtitles-ja",
          targetLanguage: "ja",
          revision: 1,
          baseFingerprint: "base-fingerprint",
          contentFingerprint: "content-fingerprint",
          clientSaveId: "save-1",
          actorId: "user-1",
          createdAt: "2026-04-12T12:00:00.000Z",
        },
      ],
      launchSessions: [],
      updatedAt: "2026-04-12T12:00:00.000Z",
    }

    expect(
      setSubtitleReviewReport(
        {
          transcript: { kind: "downloadable" },
        },
        report,
      ),
    ).toEqual({
      transcript: { kind: "downloadable" },
      subtitleReviews: {
        kind: "metadata",
        data: report,
      },
    })
  })

  it("finds an existing idempotent save by client save id or content fingerprint", () => {
    const report: SubtitleReviewReport = {
      revisions: [
        {
          artifactKey: "subtitles-ja-reviewed-r0001",
          sourceArtifactKey: "subtitles-ja",
          targetLanguage: "ja",
          revision: 1,
          baseFingerprint: "base-fingerprint",
          contentFingerprint: "content-fingerprint",
          clientSaveId: "save-1",
          actorId: "user-1",
          createdAt: "2026-04-12T12:00:00.000Z",
        },
      ],
      launchSessions: [],
      updatedAt: "2026-04-12T12:00:00.000Z",
    }

    expect(
      findExistingSubtitleReviewRevision(report, {
        sourceArtifactKey: "subtitles-ja",
        clientSaveId: "save-1",
        contentFingerprint: "different",
      })?.artifactKey,
    ).toBe("subtitles-ja-reviewed-r0001")
    expect(
      findExistingSubtitleReviewRevision(report, {
        sourceArtifactKey: "subtitles-ja",
        clientSaveId: "different",
        contentFingerprint: "content-fingerprint",
      })?.artifactKey,
    ).toBe("subtitles-ja-reviewed-r0001")
  })

  it("returns an empty report for missing or malformed metadata", () => {
    expect(getSubtitleReviewReport({})).toEqual({
      revisions: [],
      launchSessions: [],
      updatedAt: new Date(0).toISOString(),
    })
  })
})
