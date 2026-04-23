import assert from "node:assert/strict"
import test from "node:test"
import { buildVoiceoverInputs } from "./videoEnrichment-voiceover"

test("buildVoiceoverInputs includes the source transcript first", () => {
  assert.deepEqual(
    buildVoiceoverInputs({
      sourceLanguage: "en",
      sourceText: "Hello world.",
      translations: [],
    }),
    [{ language: "en", text: "Hello world." }],
  )
})

test("buildVoiceoverInputs appends translated full-text artifacts", () => {
  assert.deepEqual(
    buildVoiceoverInputs({
      sourceLanguage: "en",
      sourceText: "Hello world.",
      translations: [
        {
          sourceLanguage: "en",
          targetLanguage: "es",
          text: "Hola mundo.",
        },
        {
          sourceLanguage: "en",
          targetLanguage: "fr",
          text: "  ",
        },
      ],
    }),
    [
      { language: "en", text: "Hello world." },
      { language: "es", text: "Hola mundo." },
    ],
  )
})
