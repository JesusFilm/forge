import assert from "node:assert/strict"
import test from "node:test"
import { createJobSchema } from "./route.helpers"

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
