import { describe, expect, it } from "vitest"
import { getMuxSyncReport, setMuxSyncReport } from "@/lib/mux-sync-report"
import type { JobArtifactManifest, MuxSyncReport } from "@/types/job"

describe("mux-sync-report helpers", () => {
  it("reads a persisted muxSync metadata artifact", () => {
    const report = getMuxSyncReport({
      muxSync: {
        kind: "metadata",
        data: {
          comparisons: [
            {
              artifactKey: "subtitles-fr",
              targetLanguage: "fr",
              muxTargetType: "text_track",
              muxTargetKey: "fr",
              status: "skipped_existing_mux_data",
              explanation: "Mux already has fr subtitles",
              canOverride: true,
            },
          ],
          updatedAt: "2026-04-10T12:00:00.000Z",
        },
      },
    } satisfies JobArtifactManifest)

    expect(report).toEqual({
      comparisons: [
        expect.objectContaining({
          artifactKey: "subtitles-fr",
          targetLanguage: "fr",
          status: "skipped_existing_mux_data",
          canOverride: true,
        }),
      ],
      overrideHistory: [],
      updatedAt: "2026-04-10T12:00:00.000Z",
    })
  })

  it("writes a muxSync report back into artifacts without dropping existing entries", () => {
    const report: MuxSyncReport = {
      comparisons: [
        {
          artifactKey: "subtitles-es",
          targetLanguage: "es",
          muxTargetType: "text_track",
          muxTargetKey: "es",
          status: "synced",
          explanation: "Synced es subtitles to Mux",
        },
      ],
      overrideHistory: [],
      updatedAt: "2026-04-10T12:00:00.000Z",
    }

    expect(
      setMuxSyncReport(
        {
          transcript: { kind: "downloadable" },
        },
        report,
      ),
    ).toEqual({
      transcript: { kind: "downloadable" },
      muxSync: {
        kind: "metadata",
        data: report,
      },
    })
  })
})
