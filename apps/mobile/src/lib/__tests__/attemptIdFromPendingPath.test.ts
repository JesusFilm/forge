import { attemptIdFromPendingPath } from "../downloadLifecycle"
import { buildPendingPath } from "../offlineFiles"

describe("attemptIdFromPendingPath (R26)", () => {
  it("extracts the persisted nonce so a next-launch terminal links to begin", () => {
    const nonce = "abc123-def456"
    const path = buildPendingPath("file:///offline", "washi-gospel-1", nonce)
    // The persisted pendingPath survives the process death, so the same id is
    // recoverable at the background/relaunch terminal event.
    expect(attemptIdFromPendingPath(path)).toBe(nonce)
  })

  it("is stable across two derivations of the same path (same attempt id)", () => {
    const path = buildPendingPath("file:///offline", "ep-1", "n1-n2")
    expect(attemptIdFromPendingPath(path)).toBe(attemptIdFromPendingPath(path))
  })

  it("differs for two distinct attempts of the same video", () => {
    const a = buildPendingPath("file:///offline", "ep-1", "attempt-a")
    const b = buildPendingPath("file:///offline", "ep-1", "attempt-b")
    expect(attemptIdFromPendingPath(a)).not.toBe(attemptIdFromPendingPath(b))
  })

  it("falls back to the raw path when it doesn't match the pending shape", () => {
    expect(
      attemptIdFromPendingPath("file:///offline/ep-1/media.rend-1.mp4"),
    ).toBe("file:///offline/ep-1/media.rend-1.mp4")
  })
})
