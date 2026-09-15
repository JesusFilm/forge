import { expect, it } from "vitest"
import { narrationEstimate, narrationReserve, readStudioRates } from "./rates"
const identity = {
  text: "Peace in the storm.",
  role: "reflection",
  language: "en",
  provider: "elevenlabs",
  model: "eleven_multilingual_v2",
  voiceId: "voice",
  settings: {},
  pronunciation: null,
}
it("allows unpriced narration without inventing a zero dollar estimate", () => {
  expect(narrationEstimate(null, identity)).toBeNull()
  expect(narrationReserve(null, identity)).toBe(0)
  expect(readStudioRates(undefined)).toBeNull()
})
it("keeps matched rates and rejects unsupported providers", () => {
  const card = {
    basis: "test",
    verifiedUntil: "2099-01-01T00:00:00.000Z",
    narration: [
      {
        model: identity.model,
        voiceId: identity.voiceId,
        microsPerCharacter: 5,
      },
    ],
    voice: [],
    music: [],
  }
  expect(narrationEstimate(card, identity)).toBe(identity.text.length * 5)
  expect(
    narrationEstimate(card, { ...identity, voiceId: "another" }),
  ).toBeNull()
  expect(() =>
    narrationReserve(null, { ...identity, provider: "unsupported" }),
  ).toThrow("Unsupported narration provider")
})
