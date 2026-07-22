import { chunk, fetchTopUpVideos, resolveHydrationVideos } from "../topUpFetch"
import type { WatchHomeVideoInput } from "../model"

describe("chunk", () => {
  it("splits into <=size chunks", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`)
    expect(chunk(ids, 100).map((c) => c.length)).toEqual([100, 100, 50])
  })

  it("returns [] for empty input and one chunk at exactly the cap", () => {
    expect(chunk([], 100)).toEqual([])
    expect(
      chunk(
        Array.from({ length: 100 }, (_, i) => i),
        100,
      ),
    ).toHaveLength(1)
  })
})

describe("fetchTopUpVideos", () => {
  it("fires a single call for a <=100-id set and returns the records", async () => {
    const query = jest
      .fn()
      .mockResolvedValue({ data: { watchHomeVideos: [{ coreId: "x" }] } })
    const out = await fetchTopUpVideos({ query } as never, ["x"], "cache-first")
    expect(query).toHaveBeenCalledTimes(1)
    expect(out).toEqual([{ coreId: "x" }])
  })

  it("chunks a >100-id set into multiple calls and merges the results", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `c-${i}`)
    const query = jest.fn(({ variables }) =>
      Promise.resolve({
        data: {
          watchHomeVideos: (variables.coreIds as string[]).map((id) => ({
            coreId: id,
          })),
        },
      }),
    )
    const out = await fetchTopUpVideos({ query } as never, ids, "network-only")
    expect(query).toHaveBeenCalledTimes(2) // 100 + 50
    expect(out).toHaveLength(150)
  })

  it("rejects fail-fast when any chunk rejects (a rejected top-up must degrade)", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `c-${i}`)
    let call = 0
    const query = jest.fn(() =>
      call++ === 0
        ? Promise.resolve({ data: { watchHomeVideos: [] } })
        : Promise.reject(new Error("boom")),
    )
    await expect(
      fetchTopUpVideos({ query } as never, ids, "network-only"),
    ).rejects.toThrow("boom")
  })
})

describe("resolveHydrationVideos", () => {
  const fresh: WatchHomeVideoInput[] = [{ coreId: "6_Acts0401", slug: "a" }]
  const lastGood: WatchHomeVideoInput[] = [{ coreId: "6_Acts0402", slug: "b" }]

  it("on success uses the fresh records and remembers them as the next last-good", () => {
    const r = resolveHydrationVideos({ ok: true, videos: fresh }, lastGood)
    expect(r.hydrationVideos).toBe(fresh)
    expect(r.nextLastGood).toBe(fresh)
  })

  it("on an EMPTY success uses empty but keeps the prior last-good (no clobber)", () => {
    const r = resolveHydrationVideos({ ok: true, videos: [] }, lastGood)
    expect(r.hydrationVideos).toEqual([])
    expect(r.nextLastGood).toBe(lastGood)
  })

  it("on failure reuses the last-good and leaves it unchanged", () => {
    const r = resolveHydrationVideos({ ok: false }, lastGood)
    expect(r.hydrationVideos).toBe(lastGood)
    expect(r.nextLastGood).toBe(lastGood)
  })

  it("on failure with NO last-good yields empty (first-launch degrade, never throws)", () => {
    const r = resolveHydrationVideos({ ok: false }, null)
    expect(r.hydrationVideos).toEqual([])
    expect(r.nextLastGood).toBeNull()
  })
})
