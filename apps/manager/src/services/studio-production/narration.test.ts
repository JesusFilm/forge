import { expect, it, vi } from "vitest"
import { narrationQuote } from "./narration"
const config = vi.hoisted(() => ({
  STUDIO_PRODUCTION_RATE_CARD: undefined as string | undefined,
}))
vi.mock("@/config/env", () => ({ env: config }))
it("keeps the known reservation subtotal when part of the script is unpriced", async () => {
  config.STUDIO_PRODUCTION_RATE_CARD = JSON.stringify({
    basis: "test",
    verifiedUntil: "2099-01-01T00:00:00.000Z",
    music: [],
    voice: [],
    narration: [
      {
        model: "eleven_multilingual_v2",
        voiceId: "known",
        microsPerCharacter: 5,
      },
    ],
  })
  const identity = {
    text: "Peace.",
    role: "reflection",
    language: "en",
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    voiceId: "known",
    settings: {},
    pronunciation: null,
  }
  const call = vi.fn().mockResolvedValue({
    projectId: "project",
    revision: 1,
    segments: [
      { itemId: "a", identity, matches: [], pronunciationLocators: [] },
      {
        itemId: "b",
        identity: { ...identity, voiceId: "unknown" },
        matches: [],
        pronunciationLocators: [],
      },
      { itemId: "c", identity, matches: [], pronunciationLocators: [] },
    ],
  })
  const quote = await narrationQuote(call, {
    projectId: "project",
    expectedRevision: 1,
  })
  expect(quote.estimateMicros).toBeNull()
  expect(quote.reservationMicros).toBe(30)
  expect(quote.unavailable).toContain("charges still apply")
})
