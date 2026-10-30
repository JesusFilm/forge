import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const fixture = vi.hoisted(() => ({
  write: vi.fn(),
  prepare: vi.fn(),
  config: {
    generationId: "private",
    scope: "private_pilot",
    corpusPath: "/private/corpus.json",
    corpusSha256: "a".repeat(64),
    sourceIds: ["source"],
    runs: [
      {
        directory: "/private/child/run",
        manifestSha256: "b".repeat(64),
        resultSha256: "c".repeat(64),
      },
    ],
  },
}))
vi.mock("node:fs/promises", () => ({
  readFile: async () => JSON.stringify(fixture.config),
  writeFile: fixture.write,
}))
vi.mock(
  "../services/precomputed-recommendations/shared-reading-import",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../services/precomputed-recommendations/shared-reading-import")
    >()),
    prepareSharedReadingImport: fixture.prepare,
  }),
)
import { main } from "./import-shared-reading-recommendations"
beforeEach(() => {
  fixture.prepare.mockResolvedValue({
    inspectedRunDirectories: ["/private/child/run", "/private/parent/run"],
    summary: { sources: 1 },
    inputDigest: "a".repeat(64),
    submissions: [
      { action: "shared_reading_start" },
      { action: "shared_reading_complete" },
    ],
  })
  fixture.write.mockReset()
  vi.spyOn(console, "log").mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
describe("explicit private import CLI", () => {
  it("does not use network or write by default", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    await main(["--config", "/private/config.json"])
    expect(fetch).not.toHaveBeenCalled()
    expect(fixture.write).not.toHaveBeenCalled()
  })
  it("refuses an export inside any linked parent, and exclusively creates explicit new output", async () => {
    await expect(
      main([
        "--config",
        "/private/config.json",
        "--export",
        "/private/parent/run/new.json",
      ]),
    ).rejects.toThrow("outside inspected")
    expect(fixture.write).not.toHaveBeenCalled()
    await main([
      "--config",
      "/private/config.json",
      "--export",
      "/private/outputs/new.json",
    ])
    expect(fixture.write).toHaveBeenCalledWith(
      "/private/outputs/new.json",
      expect.any(String),
      { flag: "wx", mode: 0o600 },
    )
  })
  it("fails closed on a transport failure without retries or sending complete", async () => {
    vi.stubEnv(
      "ADMIN_RECOMMENDATION_INGEST_URL",
      "https://admin.example/ingest",
    )
    vi.stubEnv("ADMIN_MASTRA_RECOMMENDATION_API_KEY", "operator-test-only")
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("blocked", { status: 409 }))
    vi.stubGlobal("fetch", fetch)
    await expect(
      main(["--config", "/private/config.json", "--submit"]),
    ).rejects.toThrow("HTTP 409")
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" })
  })
  it("requires the completion response rather than assuming HTTP 200 means complete", async () => {
    vi.stubEnv(
      "ADMIN_RECOMMENDATION_INGEST_URL",
      "https://admin.example/ingest",
    )
    vi.stubEnv("ADMIN_MASTRA_RECOMMENDATION_API_KEY", "operator-test-only")
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ result: { state: "incomplete" } }),
      )
    vi.stubGlobal("fetch", fetch)
    await expect(
      main(["--config", "/private/config.json", "--submit"]),
    ).rejects.toThrow("did not complete")
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
