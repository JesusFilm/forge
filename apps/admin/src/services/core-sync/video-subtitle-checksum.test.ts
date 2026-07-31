import { beforeEach, describe, expect, it, vi } from "vitest"

import { coreQuery } from "./core-client"
import {
  buildVideoSubtitleChecksumManifest,
  fetchVideoSubtitleChecksumManifest,
  VideoSubtitleSnapshotMismatchError,
  serializeVideoSubtitleChecksumBucket,
  serializeVideoSubtitleChecksumRoot,
  validateVideoSubtitleChecksumManifest,
  videoSubtitleChecksum,
  type VideoSubtitleChecksumSourceRecord,
} from "./video-subtitle-checksum"

vi.mock("./core-client", () => ({ coreQuery: vi.fn() }))

const source: VideoSubtitleChecksumSourceRecord = {
  id: "subtitle-1",
  videoId: "video-1",
  languageId: "529",
  edition: "base",
  primary: true,
  vttSrc: "https://cdn.example/sub.vtt",
  vttVersion: 3,
  srtSrc: null,
  srtVersion: 1,
}

describe("video subtitle checksum v1", () => {
  beforeEach(() => vi.mocked(coreQuery).mockReset())

  it("matches Core's exact golden bucket and root vectors", () => {
    expect(serializeVideoSubtitleChecksumBucket("video-1", [source])).toBe(
      '["jfp.subtitle-sync.video",1,"video-1",[["subtitle-1","video-1","529","base",true,"https://cdn.example/sub.vtt",3,null,1,"https://cdn.example/sub.vtt"]]]',
    )
    const manifest = buildVideoSubtitleChecksumManifest([source])
    expect(manifest.buckets).toEqual([
      {
        videoId: "video-1",
        count: 1,
        checksum:
          "sha256:ad92e982e4304e0baf251a0de18d6f3dea2b5f9937fc3caf5c171655b0a855ea",
      },
    ])
    expect(serializeVideoSubtitleChecksumRoot(1, manifest.buckets)).toBe(
      '["jfp.subtitle-sync.root",1,1,[["video-1",1,"sha256:ad92e982e4304e0baf251a0de18d6f3dea2b5f9937fc3caf5c171655b0a855ea"]]]',
    )
    expect(manifest.rootChecksum).toBe(
      "sha256:d973312fe3ef8c37c5dc0969a599d9191cd930893661a21a856d1c8b6e83e723",
    )
  })

  it("matches Core's empty root and explicit empty bucket vectors", () => {
    expect(buildVideoSubtitleChecksumManifest([]).rootChecksum).toBe(
      "sha256:c1fda15944a413c8c6195270716250d6db2a00a30941338c0ff6bbe65e4b956d",
    )
    expect(
      videoSubtitleChecksum(
        serializeVideoSubtitleChecksumBucket("video-empty", []),
      ),
    ).toBe(
      "sha256:fdebc88a680346820a2680f64e8b41294562986368e170cc8752c222f3dd88d6",
    )
  })

  it("sorts IDs by UTF-8 bytes and keeps null distinct from an empty string", () => {
    const accented = { ...source, id: "é", vttSrc: null }
    const ascii = { ...source, id: "z", vttSrc: "" }
    const serialized = serializeVideoSubtitleChecksumBucket("video-1", [
      accented,
      ascii,
    ])

    expect(serialized.indexOf('"z"')).toBeLessThan(serialized.indexOf('"é"'))
    expect(serialized).toContain('"z","video-1","529","base",true,"",3')
    expect(serialized).toContain('"é","video-1","529","base",true,null,3')
  })

  it("changes the checksum for every versioned canonical field", () => {
    const baseline = buildVideoSubtitleChecksumManifest([source]).rootChecksum
    const mutations: VideoSubtitleChecksumSourceRecord[] = [
      { ...source, languageId: "530" },
      { ...source, edition: "dubbed" },
      { ...source, primary: false },
      { ...source, vttSrc: null },
      { ...source, vttVersion: 4 },
      { ...source, srtSrc: "https://cdn.example/sub.srt" },
      { ...source, srtVersion: 2 },
    ]

    for (const changed of mutations) {
      expect(
        buildVideoSubtitleChecksumManifest([changed]).rootChecksum,
      ).not.toBe(baseline)
    }
  })

  it("rejects malformed, inconsistent, duplicate, and unsupported manifests", () => {
    const valid = buildVideoSubtitleChecksumManifest([source], ["video-1"])

    expect(() =>
      validateVideoSubtitleChecksumManifest({ ...valid, version: 2 }, [
        "video-1",
      ]),
    ).toThrow("Unsupported video subtitle checksum version")
    expect(() =>
      validateVideoSubtitleChecksumManifest(
        { ...valid, totalCount: valid.totalCount + 1 },
        ["video-1"],
      ),
    ).toThrow("bucket count sum")
    expect(() =>
      validateVideoSubtitleChecksumManifest(
        { ...valid, buckets: [...valid.buckets, valid.buckets[0]] },
        ["video-1"],
      ),
    ).toThrow("duplicate bucket videoId")
    expect(() =>
      validateVideoSubtitleChecksumManifest(
        { ...valid, details: [...valid.details, valid.details[0]] },
        ["video-1"],
      ),
    ).toThrow("duplicate detail videoId")
    expect(() =>
      validateVideoSubtitleChecksumManifest(valid, ["video-1", "video-2"]),
    ).toThrow("exactly match requested video IDs")
  })

  it("rejects detail corruption and requests above Core's detail cap", () => {
    const valid = buildVideoSubtitleChecksumManifest([source], ["video-1"])
    const corrupt = {
      ...valid,
      details: [
        {
          ...valid.details[0],
          records: [{ ...valid.details[0].records[0], value: "wrong" }],
        },
      ],
    }

    expect(() =>
      validateVideoSubtitleChecksumManifest(corrupt, ["video-1"]),
    ).toThrow("derived value")
    expect(() =>
      validateVideoSubtitleChecksumManifest(
        valid,
        Array.from({ length: 101 }, (_, index) => `video-${index}`),
      ),
    ).toThrow("at most 100")
  })

  it("fetches the protected manifest using snapshot-bound detail variables", async () => {
    const manifest = buildVideoSubtitleChecksumManifest([source], ["video-1"])
    vi.mocked(coreQuery).mockResolvedValue({
      data: { videoSubtitleChecksumManifest: manifest },
    })

    await expect(
      fetchVideoSubtitleChecksumManifest({
        detailsForVideoIds: ["video-1"],
        expectedSnapshot: manifest.snapshot,
      }),
    ).resolves.toEqual(manifest)
    expect(coreQuery).toHaveBeenCalledWith(
      expect.stringContaining("records: subtitles"),
      {
        detailsForVideoIds: ["video-1"],
        expectedSnapshot: manifest.snapshot,
      },
      { requireInteropToken: true },
    )
  })

  it("classifies a successful stale-snapshot response for one safe restart", async () => {
    const manifest = buildVideoSubtitleChecksumManifest([source])
    vi.mocked(coreQuery).mockResolvedValue({
      data: { videoSubtitleChecksumManifest: manifest },
    })

    const result = fetchVideoSubtitleChecksumManifest({
      expectedSnapshot: `sha256:${"b".repeat(64)}`,
    })

    await expect(result).rejects.toBeInstanceOf(
      VideoSubtitleSnapshotMismatchError,
    )
    await expect(result).rejects.toMatchObject({
      code: "SUBTITLE_SNAPSHOT_MISMATCH",
    })
  })
})
