import { chunk, fetchTopUpVideos } from "./topUpFetch"

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

  it("chunks a >100-id set into multiple calls and merges the results (R4)", async () => {
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
