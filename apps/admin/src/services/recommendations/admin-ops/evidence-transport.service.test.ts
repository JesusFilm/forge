import { describe, expect, it, vi, afterEach } from "vitest"
vi.mock("../evidence-observability", () => ({
  evidenceCollector: vi.fn().mockResolvedValue(null),
  disconnectEvidenceCollector: vi.fn(),
}))
import { loadEvidenceTransportOverview } from "./evidence-transport.service"
const now = new Date("2026-09-09T12:30:00.000Z")
const accepted = "facts|accepted|none|none|none|unknown|200|unknown"
afterEach(() => vi.useRealTimers())
describe("operational evidence aggregate", () => {
  it("reads a fixed bounded window with both sources and suppresses tiny groups", async () => {
    const read = vi.fn(async (_keys: string[]) =>
      Array.from(
        { length: 48 },
        (_, i): Record<string, string> =>
          i === 0 ? { [accepted]: "3" } : i === 24 ? { [accepted]: "2" } : {},
      ),
    )
    const result = await loadEvidenceTransportOverview(now, read)
    expect(read.mock.calls[0][0]).toHaveLength(48)
    expect(result.start.toISOString()).toBe("2026-09-08T13:00:00.000Z")
    expect(result.end).toEqual(now)
    expect(result.state).toBe("observed")
    expect(result.suppressed).toBe(true)
    expect(result.rows).toEqual([
      expect.objectContaining({ source: "web", action: "facts", count: 3 }),
    ])
  })
  it("distinguishes absent observations and outages from healthy zero", async () => {
    expect(
      (
        await loadEvidenceTransportOverview(now, async () =>
          Array.from({ length: 48 }, () => ({})),
        )
      ).state,
    ).toBe("unknown")
    expect(
      (
        await loadEvidenceTransportOverview(now, async () => {
          throw new Error("secret")
        })
      ).state,
    ).toBe("unknown")
  })
  it("reports missing sources, overflow and invalid collector data as partial without returning raw data", async () => {
    const buckets = Array.from(
      { length: 48 },
      () => ({}) as Record<string, string>,
    )
    buckets[0] = { [accepted]: "4", overflow: "1", "private-capability": "5" }
    const result = await loadEvidenceTransportOverview(now, async () => buckets)
    expect(result.state).toBe("partial")
    expect(JSON.stringify(result)).not.toContain("private-capability")
  })
  it("bounds a stalled read to 150ms", async () => {
    vi.useFakeTimers()
    const pending = loadEvidenceTransportOverview(
      now,
      () => new Promise(() => {}),
    )
    await vi.advanceTimersByTimeAsync(151)
    expect((await pending).state).toBe("unknown")
  })
})
