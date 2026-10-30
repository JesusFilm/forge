import { describe, expect, it } from "vitest"
import { studioTimelineItemSchema } from "./index"
import {
  audioDbToVolume,
  audioVolumeToDb,
  audioFadeSettings,
  audioFadeProgress,
  studioAudioVolume,
  type StudioAudioItem,
} from "./audio"
const item = studioTimelineItemSchema.parse({
  id: "music",
  trackId: "audio",
  kind: "audio",
  startFrame: 120,
  durationInFrames: 61,
  asset: { assetId: "a", versionId: "v1", digest: "a".repeat(64) },
  sourceStartMs: 7000,
  volume: 1,
}) as StudioAudioItem

describe("Studio audio envelopes", () => {
  it("round trips +30 dB and exact silence", () => {
    expect(audioDbToVolume(30)).toBeCloseTo(31.6227766017)
    expect(audioVolumeToDb(audioDbToVolume(-24))).toBeCloseTo(-24)
    expect(audioVolumeToDb(0)).toBe(-Infinity)
    expect(audioDbToVolume(-Infinity)).toBe(0)
    expect(audioDbToVolume(90)).toBe(audioDbToVolume(30))
  })
  it("keeps legacy documents at their original gain without adding fades", () => {
    expect(item.audioFade).toBeUndefined()
    expect(studioAudioVolume(item, 0)).toBe(1)
    expect(studioAudioVolume(item, 60)).toBe(1)
    expect(studioAudioVolume(item, -1)).toBe(0)
    expect(studioAudioVolume(item, 61)).toBe(0)
  })
  it("persists bounded optional envelopes and amplified levels", () => {
    const edited = studioTimelineItemSchema.parse({
      ...item,
      volume: audioDbToVolume(30),
      audioFade: {
        fadeInFrames: 10,
        fadeOutFrames: 20,
        fadeInCurve: 0.4,
        fadeOutCurve: -0.5,
      },
    })
    expect(edited).toEqual(JSON.parse(JSON.stringify(edited)))
    expect(
      studioTimelineItemSchema.safeParse({ ...edited, volume: 32 }).success,
    ).toBe(false)
    expect(
      studioTimelineItemSchema.safeParse({
        ...edited,
        audioFade: { fadeInCurve: 1.01 },
      }).success,
    ).toBe(false)
    expect(
      studioTimelineItemSchema.safeParse({
        ...edited,
        audioFade: { fadeOutFrames: -1 },
      }).success,
    ).toBe(false)
  })
  it("applies fades at timeline-relative frames, independent of source offset", () => {
    const audio = {
      ...item,
      volume: 2,
      audioFade: {
        fadeInFrames: 20,
        fadeOutFrames: 10,
        fadeInCurve: 0,
        fadeOutCurve: 0,
      },
    }
    expect(studioAudioVolume(audio, 0)).toBe(0)
    expect(studioAudioVolume(audio, 10)).toBe(1)
    expect(studioAudioVolume(audio, 20)).toBe(2)
    expect(studioAudioVolume(audio, 55)).toBe(1)
    expect(studioAudioVolume(audio, 60)).toBe(0)
    expect(studioAudioVolume({ ...audio, volume: 0 }, 30)).toBe(0)
  })
  it("curves both directions with exact endpoints and monotonic gain", () => {
    for (const curve of [-1, 0, 1]) {
      const values = Array.from({ length: 101 }, (_, i) =>
        audioFadeProgress(i / 100, curve),
      )
      expect(values[0]).toBe(0)
      expect(values[100]).toBe(1)
      expect(values.every((n, i) => i === 0 || n >= values[i - 1]!)).toBe(true)
    }
    expect(audioFadeProgress(0.5, 1)).toBeGreaterThan(0.5)
    expect(audioFadeProgress(0.5, -1)).toBeLessThan(0.5)
  })
  it("fits envelopes after trimming, including one-frame clips", () => {
    const audio = {
      ...item,
      audioFade: {
        fadeInFrames: 45,
        fadeOutFrames: 45,
        fadeInCurve: 1,
        fadeOutCurve: -1,
      },
    }
    expect(audioFadeSettings(audio)).toMatchObject({
      fadeInFrames: 30,
      fadeOutFrames: 30,
    })
    const trimmed = { ...audio, durationInFrames: 11 }
    expect(audioFadeSettings(trimmed)).toMatchObject({
      fadeInFrames: 5,
      fadeOutFrames: 5,
    })
    expect(studioAudioVolume(trimmed, 0)).toBe(0)
    expect(studioAudioVolume(trimmed, 10)).toBe(0)
    expect(studioAudioVolume({ ...trimmed, durationInFrames: 1 }, 0)).toBe(1)
  })
})

it("moves the curve through time while preserving legacy shapes and smooth monotonic endpoints", () => {
  for (const position of [0.05, 0.2, 0.5, 0.8, 0.95]) {
    for (const curve of [-1, 0, 1]) {
      const values = Array.from({ length: 101 }, (_, frame) =>
        audioFadeProgress(frame / 100, curve, position),
      )
      expect(values[0]).toBe(0)
      expect(values[100]).toBeCloseTo(1)
      expect(
        values.every((value, i) => i === 0 || value >= values[i - 1]!),
      ).toBe(true)
      expect(audioFadeProgress(position, curve, position)).toBeCloseTo(
        audioFadeProgress(0.5, curve),
      )
    }
  }
  expect(audioFadeProgress(0.25, 0.5, 0.5)).toBeCloseTo(0.25 ** (2 ** -1.5))
  const moved = {
    ...item,
    audioFade: {
      fadeInFrames: 20,
      fadeOutFrames: 20,
      fadeInCurve: 0,
      fadeOutCurve: 0,
      fadeInCurvePosition: 0.75,
      fadeOutCurvePosition: 0.25,
    },
  }
  const parsed = studioTimelineItemSchema.parse(
    JSON.parse(JSON.stringify(moved)),
  ) as StudioAudioItem
  expect(studioAudioVolume(parsed, 15)).toBeCloseTo(0.5)
  expect(studioAudioVolume(parsed, 55)).toBeCloseTo(0.5)
  expect(
    studioTimelineItemSchema.safeParse({
      ...moved,
      audioFade: { ...moved.audioFade, fadeInCurvePosition: 0 },
    }).success,
  ).toBe(false)
})
