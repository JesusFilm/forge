import assert from "node:assert/strict"
import test from "node:test"
import { getLanguageBadges } from "./jobs-table-presenter"
import type { JobRecord } from "@/types/job"

function makeJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job_123",
    muxAssetId: "asset_123",
    muxPlaybackId: "playback_123",
    languages: [],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

test("getLanguageBadges keeps source-only voiceover jobs visible after reload", () => {
  const badges = getLanguageBadges(
    makeJobRecord({
      languages: ["en"],
      options: { generateVoiceover: true },
    }),
    new Map([["en", "English"]]),
  )

  assert.deepEqual(badges, [
    {
      key: "english",
      text: "🇺🇸 English",
    },
  ])
})
