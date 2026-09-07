class NarrationFixtureError extends Error {}
import { describe, expect, it } from "vitest"
import { runStudioNarration, StudioRetainedAudioError } from "./runner"
import type { StudioNarrationIdentity } from "@forge/studio-contracts/assets"
const ref = { assetId: "audio", versionId: "audio-v1", digest: "a".repeat(64) }
const identity: StudioNarrationIdentity = {
  text: "Take a quiet breath.",
  role: "settle",
  language: "en",
  provider: "elevenlabs",
  model: "eleven_multilingual_v2",
  voiceId: "voice",
  settings: {},
  pronunciation: null,
}
describe("Explicit narration orchestration", () => {
  it("reuses exact cache matches without touching the paid provider or reserving a call", async () => {
    let paid = 0,
      claims = 0
    const result = await runStudioNarration({
      segments: [{ itemId: "settle", identity, matches: [ref] }],
      reserveMicros: () => 100,
      port: {
        cached: async () => ({ asset: ref, durationMs: 1000 }),
        claim: async () => {
          claims++
          throw new NarrationFixtureError("No paid claim expected")
        },
        narrate: async () => {
          paid++
          throw new NarrationFixtureError("No paid call expected")
        },
        retain: async () => {
          throw new NarrationFixtureError("No new audio expected")
        },
        finish: async () => {},
        attach: async (entries) => ({ entries }),
      },
    })
    expect(result).toEqual({
      entries: [{ itemId: "settle", asset: ref, durationMs: 1000 }],
    })
    expect({ paid, claims }).toEqual({ paid: 0, claims: 0 })
  })
  it("dispatches only changed speech once and never replays an ambiguous consumed claim", async () => {
    const observed: string[] = [],
      finished: unknown[] = []
    const changed = { ...identity, text: "Take one quiet breath." }
    const port = {
      cached: async () => ({ asset: ref, durationMs: 1000 }),
      claim: async () => ({ execute: true, state: "RUNNING" }),
      narrate: async (s: StudioNarrationIdentity) => {
        observed.push(s.text)
        return {
          bytes: Buffer.from("audio"),
          requestId: "provider-request",
          credits: 22,
          actualCostMicros: null,
        }
      },
      retain: async () => ({ asset: ref, durationMs: 1200 }),
      finish: async (_key: string, result: unknown) => {
        finished.push(result)
      },
      attach: async (entries: unknown) => entries,
    }
    await runStudioNarration({
      segments: [
        { itemId: "old", identity, matches: [ref] },
        { itemId: "changed", identity: changed, matches: [] },
      ],
      reserveMicros: () => 100,
      port,
    })
    expect(observed).toEqual([changed.text])
    expect(finished[0]).toMatchObject({
      state: "COMPLETED",
      requestId: "provider-request",
      actualCostMicros: null,
    })
    await expect(
      runStudioNarration({
        segments: [{ itemId: "changed", identity: changed, matches: [] }],
        reserveMicros: () => 100,
        port: {
          ...port,
          claim: async () => ({ execute: false, state: "RUNNING" }),
        },
      }),
    ).rejects.toThrow("ambiguous")
    expect(observed).toHaveLength(1)
  })
})

it("retains undecodable paid bytes in the execution result without attaching or retrying", async () => {
  const finishes: unknown[] = []
  let attached = false
  await expect(
    runStudioNarration({
      segments: [{ itemId: "settle", identity, matches: [] }],
      reserveMicros: () => 100,
      port: {
        cached: async () => null,
        claim: async () => ({ execute: true, state: "RUNNING" }),
        narrate: async () => ({
          bytes: Buffer.from("bad audio"),
          requestId: "paid",
          credits: 22,
          actualCostMicros: null,
        }),
        retain: async () => {
          throw new StudioRetainedAudioError(ref)
        },
        finish: async (_key, input) => {
          finishes.push(input)
        },
        attach: async () => {
          attached = true
        },
      },
    }),
  ).rejects.toThrow("retained")
  expect(attached).toBe(false)
  expect(finishes).toEqual([
    expect.objectContaining({
      state: "AMBIGUOUS",
      retainedAssets: [ref],
      requestId: "paid",
      actualCostMicros: null,
    }),
  ])
})
