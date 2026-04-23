import assert from "node:assert/strict"
import test from "node:test"
import {
  buildJobArtifactFilename,
  buildJobArtifactUrl,
  parseJobArtifactFilename,
} from "./job-artifacts"

test("buildJobArtifactFilename keeps the storage artifact naming shape", () => {
  assert.equal(
    buildJobArtifactFilename("voiceover-es", "mp3"),
    "voiceover-es.mp3",
  )
})

test("buildJobArtifactUrl points at the authenticated manager download route", () => {
  assert.equal(
    buildJobArtifactUrl("job-123", "translation-es", "json"),
    "/api/jobs/job-123/artifacts/translation-es.json",
  )
})

test("parseJobArtifactFilename extracts artifact type and extension", () => {
  assert.deepEqual(parseJobArtifactFilename("voiceover-en.mp3"), {
    artifactType: "voiceover-en",
    ext: "mp3",
  })
  assert.equal(parseJobArtifactFilename("voiceover-en"), null)
})
