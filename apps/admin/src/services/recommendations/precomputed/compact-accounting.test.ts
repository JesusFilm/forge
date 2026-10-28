import { describe, expect, it } from "vitest"
import { advanceCompactPendingCutoff } from "./compact-accounting"

describe("compact A/B pending cutoff", () => {
  it("expires finalized pending playback without another write and respects the cohort ceiling", () => {
    const summary = {
      pending_playbacks: "2",
      pending_deadlines: [
        "2026-10-28T00:02:00.000Z",
        "2026-10-28T00:05:00.000Z",
      ],
      captured_cutoff_at: "2026-10-28T00:01:00.000Z",
      cutoff_ceiling_at: "2026-10-28T00:04:00.000Z",
    }
    expect(
      advanceCompactPendingCutoff(
        summary,
        new Date("2026-10-28T00:03:00.000Z"),
      ),
    ).toMatchObject({ pending_playbacks: "1" })
    expect(
      advanceCompactPendingCutoff(
        summary,
        new Date("2026-10-28T00:06:00.000Z"),
      ),
    ).toMatchObject({ pending_playbacks: "1" })
  })
})
