import assert from "node:assert/strict"
import test from "node:test"
import { getArtifactsForStep } from "./live-job-steps-table-artifacts"

test("returns exact artifact matches for non-language steps", () => {
  const artifacts = {
    transcript: "https://example.com/transcript.json",
    "translation-es": "https://example.com/translation-es.json",
  }

  assert.deepEqual(getArtifactsForStep("transcription", artifacts), [
    {
      key: "transcript",
      url: "https://example.com/transcript.json",
    },
  ])
})

test("returns per-language translation artifacts by prefix", () => {
  const artifacts = {
    metadata: "https://example.com/metadata.json",
    "translation-fr": "https://example.com/translation-fr.json",
    "translation-es": "https://example.com/translation-es.json",
  }

  assert.deepEqual(getArtifactsForStep("translation", artifacts), [
    {
      key: "translation-es",
      url: "https://example.com/translation-es.json",
    },
    {
      key: "translation-fr",
      url: "https://example.com/translation-fr.json",
    },
  ])
})

test("returns per-language voiceover artifacts and keeps legacy singular keys", () => {
  const artifacts = {
    voiceover: "https://example.com/voiceover.mp3",
    "voiceover-en": "https://example.com/voiceover-en.mp3",
    "voiceover-es": "https://example.com/voiceover-es.mp3",
  }

  assert.deepEqual(getArtifactsForStep("voiceover", artifacts), [
    {
      key: "voiceover",
      url: "https://example.com/voiceover.mp3",
    },
    {
      key: "voiceover-en",
      url: "https://example.com/voiceover-en.mp3",
    },
    {
      key: "voiceover-es",
      url: "https://example.com/voiceover-es.mp3",
    },
  ])
})
