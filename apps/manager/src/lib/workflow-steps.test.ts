import assert from "node:assert/strict"
import test from "node:test"
import { buildInitialSteps } from "./workflow-steps"

test("voiceover starts skipped unless explicitly requested", () => {
  const steps = buildInitialSteps()
  assert.equal(steps.at(-1)?.name, "voiceover")
  assert.equal(steps.at(-1)?.status, "skipped")
})

test("voiceover starts pending when generateVoiceover is enabled", () => {
  const steps = buildInitialSteps({ generateVoiceover: true })
  assert.equal(steps.at(-1)?.name, "voiceover")
  assert.equal(steps.at(-1)?.status, "pending")
})
