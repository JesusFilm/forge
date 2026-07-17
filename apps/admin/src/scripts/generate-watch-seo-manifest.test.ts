import { describe, expect, it, vi } from "vitest"
import {
  assertNotProdUrl,
  CliConfigError,
  parseGenerateWatchSeoManifestArgs,
  runGenerateWatchSeoManifest,
} from "./generate-watch-seo-manifest"

const manifest = {
  version: "version-1",
  generatedAt: "2026-06-12T12:00:00.000Z",
  videoRouteGroups: [
    {
      contentSlug: "great-commission-and-ascension",
      alternates: [
        { hreflang: "en", languageSlug: "english" },
        { hreflang: "es", languageSlug: "spanish" },
      ],
    },
  ],
  episodeRouteGroups: [
    {
      parentSlug: "jesus",
      childSlug: "great-commission-and-ascension",
      alternates: [{ hreflang: "en", languageSlug: "english" }],
    },
  ],
  skippedHreflangValues: { "zh-Hans": 1 },
}

function makeSnapshot() {
  return {
    key: "latest",
    version: manifest.version,
    generatedAt: new Date(manifest.generatedAt),
    payload: manifest,
    payloadSizeBytes: 512,
    createdAt: new Date("2026-06-12T12:00:01.000Z"),
    updatedAt: new Date("2026-06-12T12:00:02.000Z"),
  }
}

function makeStdout() {
  const chunks: string[] = []
  return {
    stream: {
      write(chunk: string) {
        chunks.push(chunk)
      },
    },
    lines() {
      return chunks.join("").trim().split("\n").filter(Boolean)
    },
  }
}

describe("parseGenerateWatchSeoManifestArgs", () => {
  it("defaults to summary-only output", () => {
    expect(parseGenerateWatchSeoManifestArgs([])).toEqual({
      printManifest: false,
    })
  })

  it("enables explicit print mode", () => {
    expect(parseGenerateWatchSeoManifestArgs(["--print"])).toEqual({
      printManifest: true,
    })
  })

  it("rejects unknown arguments", () => {
    expect(() => parseGenerateWatchSeoManifestArgs(["--verbose"])).toThrow(
      CliConfigError,
    )
  })
})

describe("assertNotProdUrl", () => {
  it("refuses production-like and unparseable URLs", () => {
    expect(() =>
      assertNotProdUrl("postgresql://user:pass@some-host.railway.app:5432/db"),
    ).toThrow(/railway\.app/)
    expect(() =>
      assertNotProdUrl("postgresql://user:pass@admin.jesusfilm.org:5432/db"),
    ).toThrow(/jesusfilm\.org/)
    expect(() => assertNotProdUrl("not a url")).toThrow(/parseable URL/i)
    expect(() => assertNotProdUrl(undefined)).toThrow(/required/i)
  })

  it("allows local database hosts", () => {
    expect(() =>
      assertNotProdUrl("postgresql://forge:forge@localhost:5432/forge_admin"),
    ).not.toThrow()
    expect(() =>
      assertNotProdUrl("postgresql://forge:forge@127.0.0.1:5432/forge_admin"),
    ).not.toThrow()
    expect(() =>
      assertNotProdUrl("postgresql://forge:forge@db:5432/forge_admin"),
    ).not.toThrow()
  })
})

describe("runGenerateWatchSeoManifest", () => {
  it("refreshes the snapshot and prints a summary without the manifest payload", async () => {
    const stdout = makeStdout()
    const refreshWatchSeoManifest = vi.fn().mockResolvedValue({
      status: "refreshed",
      reason: "operator-script",
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      payloadSizeBytes: 512,
      counts: {
        videoRouteGroups: 1,
        episodeRouteGroups: 1,
        alternateLinks: 3,
        skippedHreflangValues: 1,
      },
      durationMs: 42,
    })
    const getLatestSnapshot = vi.fn().mockResolvedValue(makeSnapshot())

    await runGenerateWatchSeoManifest(
      { printManifest: false },
      {
        prisma: {} as never,
        refreshWatchSeoManifest,
        getLatestSnapshot,
        stdout: stdout.stream,
      },
    )

    expect(refreshWatchSeoManifest).toHaveBeenCalledWith({
      prisma: {},
      reason: "operator-script",
    })
    const lines = stdout.lines()
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toEqual({
      event: "watch_seo_manifest.generate.complete",
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      payloadSizeBytes: 512,
      counts: {
        videoRouteGroups: 1,
        episodeRouteGroups: 1,
        alternateLinks: 3,
        skippedHreflangValues: 1,
      },
      durationMs: 42,
    })
  })

  it("prints the full manifest only when --print was requested", async () => {
    const stdout = makeStdout()
    const refreshWatchSeoManifest = vi.fn().mockResolvedValue({
      status: "refreshed",
      reason: "operator-script",
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      payloadSizeBytes: 512,
      counts: {
        videoRouteGroups: 1,
        episodeRouteGroups: 1,
        alternateLinks: 3,
        skippedHreflangValues: 1,
      },
      durationMs: 42,
    })

    await runGenerateWatchSeoManifest(
      { printManifest: true },
      {
        prisma: {} as never,
        refreshWatchSeoManifest,
        getLatestSnapshot: vi.fn().mockResolvedValue(makeSnapshot()),
        stdout: stdout.stream,
      },
    )

    const lines = stdout.lines()
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!)).toEqual({
      event: "watch_seo_manifest.generate.manifest",
      manifest,
    })
  })

  it("does not print a stale success summary when refresh fails", async () => {
    const stdout = makeStdout()
    const getLatestSnapshot = vi.fn()

    await expect(
      runGenerateWatchSeoManifest(
        { printManifest: false },
        {
          prisma: {} as never,
          refreshWatchSeoManifest: vi.fn().mockResolvedValue({
            status: "failed",
            reason: "operator-script",
            detail: "db unavailable",
            durationMs: 12,
          }),
          getLatestSnapshot,
          stdout: stdout.stream,
        },
      ),
    ).rejects.toThrow(/db unavailable/)

    expect(getLatestSnapshot).not.toHaveBeenCalled()
    expect(stdout.lines()).toEqual([])
  })
})
