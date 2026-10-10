import { describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { measureStudioAudio } from "./audio"
// Real provisioned codecs; this is decode/duration evidence, not generated voice quality.
describe.skipIf(!env.STUDIO_FFMPEG_PATH || !env.STUDIO_FFPROBE_PATH)(
  "retained audio codec proof",
  () => {
    it("measures the complete retained waveform without changing its bytes", async () => {
      const frames = 8000,
        bytes = Buffer.alloc(44 + frames * 2)
      bytes.write("RIFF", 0)
      bytes.writeUInt32LE(bytes.length - 8, 4)
      bytes.write("WAVEfmt ", 8)
      bytes.writeUInt32LE(16, 16)
      bytes.writeUInt16LE(1, 20)
      bytes.writeUInt16LE(1, 22)
      bytes.writeUInt32LE(8000, 24)
      bytes.writeUInt32LE(16000, 28)
      bytes.writeUInt16LE(2, 32)
      bytes.writeUInt16LE(16, 34)
      bytes.write("data", 36)
      bytes.writeUInt32LE(frames * 2, 40)
      for (let frame = 0; frame < frames; frame++)
        bytes.writeInt16LE(
          Math.round(Math.sin((frame * Math.PI * 2 * 440) / 8000) * 8000),
          44 + frame * 2,
        )
      const original = Buffer.from(bytes)
      expect(await measureStudioAudio(bytes)).toBe(1000)
      expect(bytes).toEqual(original)
    })
    it("rejects non-audio and empty provider bytes", async () => {
      await expect(
        measureStudioAudio(
          Buffer.from("Provider returned an HTML error instead of audio"),
        ),
      ).rejects.toThrow()
      await expect(measureStudioAudio(Buffer.alloc(0))).rejects.toThrow(
        "Audio outside byte bound",
      )
    })
  },
)
