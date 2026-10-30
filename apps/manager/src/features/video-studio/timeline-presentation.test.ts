import { expect, it } from "vitest"
import { timelineTimecode, timelineRowHeight } from "./timeline-presentation"
import type { TimelineRow } from "./timeline-layout"
it("formats frame-accurate timecodes and rollover", () => {
  expect(timelineTimecode(0, 30)).toBe("00:00:00:00")
  expect(timelineTimecode(29, 30)).toBe("00:00:00:29")
  expect(timelineTimecode(30, 30)).toBe("00:00:01:00")
  expect(timelineTimecode(3661 * 30 + 23, 30)).toBe("01:01:01:23")
  expect(timelineTimecode(771 - 300, 30)).toBe("00:00:15:21")
  expect(timelineTimecode(-1, 30)).toBe("00:00:00:00")
})
it("sizes lanes by their actual presentation so group headers align", () => {
  const row: TimelineRow = {
    id: "row",
    trackId: "t",
    group: "Visual",
    items: [],
  }
  expect(timelineRowHeight(row)).toBe(48)
  expect(
    timelineRowHeight({ ...row, group: "Audio", linkedSourceAudio: true }),
  ).toBe(72)
  const video = {
    id: "v",
    kind: "video" as const,
    trackId: "t",
    startFrame: 0,
    durationInFrames: 30,
    volume: 1,
    source: {
      videoId: "v",
      dubId: "d",
      editionId: "e",
      language: "en",
      subtitle: null,
      preview: { assetId: "a", versionId: "v", digest: "a".repeat(64) },
      export: { assetId: "a", versionId: "v", digest: "a".repeat(64) },
      startMs: 0,
      endMs: 1000,
    },
  }
  expect(
    timelineRowHeight({
      ...row,
      items: [
        video,
        {
          id: "text",
          kind: "text",
          trackId: "t",
          startFrame: 30,
          durationInFrames: 30,
          text: "Title",
          properties: {},
        },
      ],
    }),
  ).toBe(104)
})
