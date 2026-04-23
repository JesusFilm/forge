import assert from "node:assert/strict"
import test from "node:test"
import { createJobSchema, getPersistedJobLanguages } from "./route.helpers"

test("accepts create-job payloads with generateVoiceover", () => {
  const parsed = createJobSchema.safeParse({
    inputUrl: "https://example.com/video.mp4",
    language: "en",
    translateTo: ["es", "fr"],
    generateVoiceover: true,
  })

  assert.equal(parsed.success, true)
  if (!parsed.success) {
    return
  }

  assert.equal(parsed.data.generateVoiceover, true)
})

test("rejects non-https input urls", () => {
  const parsed = createJobSchema.safeParse({
    inputUrl: "http://example.com/video.mp4",
  })

  assert.equal(parsed.success, false)
})

test("persists source language first for voiceover jobs", () => {
  assert.deepEqual(
    getPersistedJobLanguages({
      language: "en",
      translateTo: ["es", "fr"],
      generateVoiceover: true,
    }),
    ["en", "es", "fr"],
  )
})

test("persists source-only voiceover jobs truthfully", () => {
  assert.deepEqual(
    getPersistedJobLanguages({
      language: "en",
      generateVoiceover: true,
    }),
    ["en"],
  )
})

test("leaves non-voiceover jobs target-only", () => {
  assert.deepEqual(
    getPersistedJobLanguages({
      language: "en",
      translateTo: ["es", "fr"],
      generateVoiceover: false,
    }),
    ["es", "fr"],
  )
})
