import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/feature-flags", () => ({
  isWatchAudienceEnabled: vi.fn(async () => false),
}))

import {
  assertWatchAudienceWriteAllowed,
  hasNewOrChangedWatchAudience,
  WatchAudienceAuthoringDisabledError,
} from "./watch-audience-write-gate"

const audience = {
  t: "watchAudience",
  sectionKey: "audience",
  configuration: { roles: [{ id: "explore", questions: ["a", "b"] }] },
}
// The same block after a Postgres jsonb round trip reorders keys.
const reordered = {
  configuration: { roles: [{ questions: ["a", "b"], id: "explore" }] },
  sectionKey: "audience",
  t: "watchAudience",
}
const text = { t: "text", sectionKey: "text-1", heading: "Hi" }

describe("hasNewOrChangedWatchAudience", () => {
  it.each([
    ["no audience blocks", [text], [{ ...text, heading: "Edited" }]],
    [
      "an identical block with reordered keys",
      [audience, text],
      [text, reordered],
    ],
    ["removing the block", [audience, text], [text]],
  ])("is false for %s", (_label, previous, next) => {
    expect(hasNewOrChangedWatchAudience(previous, next)).toBe(false)
  })

  it.each([
    ["a new block", [text], [text, audience]],
    [
      "a changed configuration",
      [audience],
      [{ ...audience, configuration: { roles: [] } }],
    ],
    ["a changed section key", [audience], [{ ...audience, sectionKey: "x" }]],
    ["a copy of an existing block", [audience], [audience, audience]],
  ])("is true for %s", (_label, previous, next) => {
    expect(hasNewOrChangedWatchAudience(previous, next)).toBe(true)
  })
})

describe("assertWatchAudienceWriteAllowed", () => {
  it("does not read the flag when nothing audience-related changed", async () => {
    const isEnabled = vi.fn(async () => false)
    await assertWatchAudienceWriteAllowed({
      previousBlocks: [audience],
      nextBlocks: [reordered, text],
      isEnabled,
    })
    expect(isEnabled).not.toHaveBeenCalled()
  })

  it.each([
    ["off", async () => false],
    [
      "unreadable",
      async () => {
        throw new Error("flag down")
      },
    ],
  ])("rejects a new or changed block while the flag is %s", async (_s, fn) => {
    await expect(
      assertWatchAudienceWriteAllowed({
        previousBlocks: [],
        nextBlocks: [audience],
        isEnabled: vi.fn(fn),
      }),
    ).rejects.toBeInstanceOf(WatchAudienceAuthoringDisabledError)
  })

  it("allows a new block once the flag is on", async () => {
    await expect(
      assertWatchAudienceWriteAllowed({
        previousBlocks: [],
        nextBlocks: [audience],
        isEnabled: async () => true,
      }),
    ).resolves.toBeUndefined()
  })

  it("defaults to the shared release gate (off)", async () => {
    await expect(
      assertWatchAudienceWriteAllowed({
        previousBlocks: [],
        nextBlocks: [audience],
      }),
    ).rejects.toBeInstanceOf(WatchAudienceAuthoringDisabledError)
  })
})
