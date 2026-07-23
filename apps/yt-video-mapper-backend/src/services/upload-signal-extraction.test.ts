import { describe, expect, it } from "vitest"
import {
  DeterministicUploadSignalExtractor,
  UPLOAD_SIGNAL_ALGORITHM_VERSION,
} from "./upload-signal-extraction.js"
import {
  OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
  OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
  VISUAL_FRAME_FINGERPRINT_KIND,
} from "./visual-fingerprint.js"

describe("DeterministicUploadSignalExtractor", () => {
  it("emits deterministic byte sample hashes compatible with structural signatures", async () => {
    const extractor = new DeterministicUploadSignalExtractor(4)
    const first = await extractor.extract({
      bytes: Buffer.from([1, 2, 3, 4, 5, 6]),
      contentType: "video/mp4",
    })
    const second = await extractor.extract({
      bytes: Buffer.from([1, 2, 3, 4, 9, 9]),
      contentType: "video/mp4",
    })

    expect(first.sampledByteHashes).toEqual([
      "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
    ])
    expect(first.visualHashes).toEqual(first.sampledByteHashes)
    expect(second.sampledByteHashes).toEqual(first.sampledByteHashes)
    expect(first.byteSamples).toEqual([
      {
        kind: "byte_sample_v1",
        sha256:
          "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
        byteLength: 4,
        rangeStart: 0,
        rangeEnd: 3,
        contentType: "video/mp4",
        complete: false,
      },
    ])
    expect(first.algorithmVersion).toBe(UPLOAD_SIGNAL_ALGORITHM_VERSION)
  })

  it("changes byte sample hashes when the sampled bytes differ", async () => {
    const extractor = new DeterministicUploadSignalExtractor(4)

    const first = await extractor.extract({
      bytes: Buffer.from([1, 2, 3, 4]),
      contentType: "video/mp4",
    })
    const second = await extractor.extract({
      bytes: Buffer.from([4, 3, 2, 1]),
      contentType: "video/mp4",
    })

    expect(second.sampledByteHashes).not.toEqual(first.sampledByteHashes)
  })

  it("extracts MP4 mvhd duration when present", async () => {
    const signals = await new DeterministicUploadSignalExtractor().extract({
      bytes: mp4WithMvhd({ timescale: 1_000, duration: 12_345 }),
      contentType: "video/mp4; charset=binary",
    })

    expect(signals.durationMilliseconds).toBe(12_345)
  })

  it("emits structural fingerprints for unsupported binary content without fake audio", async () => {
    const signals = await new DeterministicUploadSignalExtractor().extract({
      bytes: Buffer.from("opaque-video-bytes"),
      contentType: "application/octet-stream",
    })

    expect(signals.sampledByteHashes).toHaveLength(1)
    expect(signals.durationMilliseconds).toBeUndefined()
    expect(signals.transcriptText).toBeUndefined()
    expect(signals.audioFingerprints).toEqual([])
  })

  it.each([
    OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
  ])(
    "uses injected %s visual frame fingerprints for raw video uploads",
    async (algorithmVersion) => {
      const calls: Array<{ bytes: Buffer; contentType: string }> = []
      const signals = await new DeterministicUploadSignalExtractor({
        sampleBytes: 4,
        algorithmVersion,
        visualFrameExtractor: {
          async extractFromBytes(input) {
            calls.push({
              bytes: input.bytes,
              contentType: input.contentType,
            })
            return [
              {
                offsetMilliseconds: 1_000,
                durationMilliseconds: null,
                payload: {
                  kind: VISUAL_FRAME_FINGERPRINT_KIND,
                  phash: "ffffffff00000000",
                  frameWidth: 8,
                  frameHeight: 8,
                },
              },
            ]
          },
        },
      }).extract({
        bytes: Buffer.from([1, 2, 3, 4, 5, 6]),
        contentType: "video/mp4",
      })

      expect(calls).toEqual([
        {
          bytes: Buffer.from([1, 2, 3, 4, 5, 6]),
          contentType: "video/mp4",
        },
      ])
      expect(signals.algorithmVersion).toBe(algorithmVersion)
      expect(signals.visualHashes).toEqual(["ffffffff00000000"])
      expect(signals.visualFingerprints).toEqual([
        {
          offsetMilliseconds: 1_000,
          durationMilliseconds: null,
          payload: {
            kind: VISUAL_FRAME_FINGERPRINT_KIND,
            phash: "ffffffff00000000",
            frameWidth: 8,
            frameHeight: 8,
          },
        },
      ])
      expect(signals.sampledByteHashes).toEqual([
        "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
      ])
      expect(signals.audioFingerprints).toEqual([])
    },
  )

  it.each([
    OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION,
    OFFICIAL_MEDIA_SIGNATURE_V3_ALGORITHM_VERSION,
  ])(
    "does not synthesize %s visual or audio evidence when frame extraction fails",
    async (algorithmVersion) => {
      const signals = await new DeterministicUploadSignalExtractor({
        algorithmVersion,
        visualFrameExtractor: {
          async extractFromBytes() {
            throw new Error("ffmpeg failed")
          },
        },
      }).extract({
        bytes: Buffer.from("opaque-video-bytes"),
        contentType: "video/mp4",
      })

      expect(signals.visualHashes).toEqual([])
      expect(signals.visualFingerprints).toEqual([])
      expect(signals.sampledByteHashes).toHaveLength(1)
      expect(signals.audioFingerprints).toEqual([])
    },
  )

  it("extracts normalized transcript text only for subtitle inputs", async () => {
    const signals = await new DeterministicUploadSignalExtractor().extract({
      bytes: Buffer.from(`WEBVTT

1
00:00:01.000 --> 00:00:03.000
<v Speaker> Peace   be with you

NOTE hidden cue
00:00:04.000 --> 00:00:05.000
Amen`),
      contentType: "text/vtt",
    })
    const binarySignals =
      await new DeterministicUploadSignalExtractor().extract({
        bytes: Buffer.from("Peace be with you"),
        contentType: "video/mp4",
      })

    expect(signals.transcriptText).toBe("Peace be with you Amen")
    expect(binarySignals.transcriptText).toBeUndefined()
  })

  it("normalizes subtitle markup without preserving tag delimiters", async () => {
    const signals = await new DeterministicUploadSignalExtractor().extract({
      bytes: Buffer.from(`WEBVTT

00:00:01.000 --!> 00:00:03.000
<v Speaker> Peace <script>alert(1)</script> be with you
<unclosed Amen`),
      contentType: "text/vtt",
    })

    expect(signals.transcriptText).toBe("Peace alert(1) be with you")
    expect(signals.transcriptText).not.toContain("<")
    expect(signals.transcriptText).not.toContain(">")
  })
})

function mp4WithMvhd({
  timescale,
  duration,
}: {
  timescale: number
  duration: number
}): Buffer {
  const mvhdPayload = Buffer.alloc(100)
  mvhdPayload.writeUInt8(0, 0)
  mvhdPayload.writeUInt32BE(timescale, 12)
  mvhdPayload.writeUInt32BE(duration, 16)

  return Buffer.concat([
    box("ftyp", Buffer.from("isom")),
    box("moov", box("mvhd", mvhdPayload)),
  ])
}

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(payload.byteLength + header.byteLength, 0)
  header.write(type, 4, 4, "ascii")
  return Buffer.concat([header, payload])
}
