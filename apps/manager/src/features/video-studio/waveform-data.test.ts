import { expect, it } from "vitest"
import {
  pcmPeaks,
  waveformPath,
  waveformKey,
  type AudioItem,
} from "./waveform-data"
it("retains speech/silence positions and both PCM polarities", () => {
  const bytes = new Uint8Array(16)
  const view = new DataView(bytes.buffer)
  ;[0, 0, 16384, -32768, 0, 0, 8192, -8192].forEach((n, i) =>
    view.setInt16(i * 2, n, true),
  )
  expect(pcmPeaks(bytes, 4)).toEqual([0, 1, 0, 0.25])
})
it("reads subarrays correctly and emits finite empty bins", () => {
  const bytes = new Uint8Array([99, 99, 0, 64, 0, 0, 88, 88])
  expect(pcmPeaks(bytes.subarray(2, 6), 2)).toEqual([0.5, 0])
  expect(pcmPeaks(new Uint8Array(), 2)).toEqual([0, 0])
})
it("caps SVG amplitudes and scales the width independently of peaks", () => {
  expect(waveformPath([0, 0.5, 1], 1)).toBe(
    "M0.5,15.7v0.6M1.5,6.1v19.8M2.5,2v28",
  )
  expect(waveformPath([1], 2)).toBe("M0.5,2v28")
})
it("does not refetch independent audio on moves, mute or zoom", () => {
  const item: AudioItem = {
    id: "audio",
    kind: "audio",
    asset: { assetId: "a", versionId: "v", digest: "a".repeat(64) },
    trackId: "audio",
    startFrame: 0,
    durationInFrames: 60,
    sourceStartMs: 1000,
    volume: 1,
  }
  expect(waveformKey({ ...item, startFrame: 100, volume: 0 }, 30)).toBe(
    waveformKey(item, 30),
  )
  expect(waveformKey({ ...item, sourceStartMs: 2000 }, 30)).not.toBe(
    waveformKey(item, 30),
  )
  expect(waveformKey(item, 60)).not.toBe(waveformKey(item, 30))
})
