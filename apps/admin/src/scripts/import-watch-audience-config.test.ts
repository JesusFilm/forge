import { readFileSync } from "node:fs"
import type { PrismaClient } from "@prisma/client"
import { WatchAudienceConfigurationSchema } from "@forge/experience-schema"
import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_FIXTURE_PATH,
  WATCH_AUDIENCE_BLOCK_SECTION_KEY,
  assertLocalDatabaseUrl,
  diffPaths,
  importWatchAudienceConfig,
  parseArgs,
  planWatchAudienceImport,
} from "./import-watch-audience-config"

const configuration = WatchAudienceConfigurationSchema.parse(
  JSON.parse(readFileSync(DEFAULT_FIXTURE_PATH, "utf8")),
)
const otherBlocks = [
  { t: "watchHomeHero", sectionKey: "watch-home-hero" },
  { t: "text", heading: "Intro" },
]

describe("fixture", () => {
  it("is a strictly valid configuration for all four roles", () => {
    expect(configuration.roles.map((role) => role.id)).toEqual([
      "explore",
      "grow",
      "share",
      "partner",
    ])
  })
})

describe("assertLocalDatabaseUrl", () => {
  it.each([
    "postgresql://forge:forge@localhost:5433/forge_admin",
    "postgresql://forge:forge@127.0.0.1:5433/forge_admin",
    "postgresql://forge:forge@[::1]:5433/forge_admin",
    "postgresql://forge@localhost/forge_admin?host=/var/run/postgresql",
  ])("accepts the local connection %s", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).not.toThrow()
  })

  it.each([
    ["missing", undefined],
    ["unparseable", "not a url"],
    ["railway proxy", "postgresql://u:p@monorail.proxy.rlwy.net:1234/railway"],
    ["railway internal", "postgresql://u:p@postgres.railway.internal:5432/x"],
    ["production host", "postgresql://u:p@admin.jesusfilm.org:5432/x"],
    ["renamed remote host", "postgresql://u:p@db.example.com:5432/x"],
    ["private network", "postgresql://u:p@10.0.0.5:5432/x"],
    ["local-looking name", "postgresql://u:p@localhost.example.com:5432/x"],
    [
      "remote host smuggled via query",
      "postgresql://u:p@db.example.com/x?host=localhost",
    ],
    ["relative socket host", "postgresql://u@localhost/x?host=db.example.com"],
  ])("refuses %s", (_label, url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow()
  })
})

describe("planWatchAudienceImport", () => {
  it("appends one block and leaves every other block untouched, in order", () => {
    const plan = planWatchAudienceImport(otherBlocks, configuration)
    expect(plan.action).toBe("create-block")
    expect(plan.blocks.slice(0, 2)).toEqual(otherBlocks)
    expect(plan.blocks[2]).toEqual({
      t: "watchAudience",
      sectionKey: WATCH_AUDIENCE_BLOCK_SECTION_KEY,
      configuration,
    })
  })

  it("is idempotent: the same configuration changes nothing", () => {
    const first = planWatchAudienceImport(otherBlocks, configuration)
    const second = planWatchAudienceImport(first.blocks, configuration)
    expect(second.action).toBe("unchanged")
    expect(second.blocks).toEqual(first.blocks)
  })

  it("replaces the existing block in place, keeping its key and position", () => {
    const existing = [
      otherBlocks[0],
      { t: "watchAudience", sectionKey: "custom-key", configuration },
      otherBlocks[1],
    ]
    const changed = structuredClone(configuration)
    changed.roles[0].actions.reverse()
    const plan = planWatchAudienceImport(existing, changed)
    expect(plan.action).toBe("update-block")
    expect(plan.blocks[1]).toEqual({
      t: "watchAudience",
      sectionKey: "custom-key",
      configuration: changed,
    })
    expect(plan.blocks[0]).toBe(existing[0])
    expect(plan.blocks[2]).toBe(existing[2])
    expect(existing[1]).toMatchObject({ configuration })
  })

  it("refuses to choose between duplicate blocks", () => {
    const duplicate = { t: "watchAudience", sectionKey: "a", configuration }
    expect(() =>
      planWatchAudienceImport(
        [duplicate, { ...duplicate, sectionKey: "b" }],
        configuration,
      ),
    ).toThrow(/2 watchAudience blocks/)
  })
})

describe("diffPaths", () => {
  it("lists changed paths and caps a full replace", () => {
    expect(diffPaths({ a: [1, 2], b: 1 }, { a: [1, 3], b: 1 })).toEqual({
      paths: ["a.1"],
      truncated: false,
    })
    const big = diffPaths(
      Array.from({ length: 100 }, (_, i) => i),
      Array.from({ length: 100 }, (_, i) => i + 1),
    )
    expect(big.paths).toHaveLength(40)
    expect(big.truncated).toBe(true)
  })
})

describe("parseArgs", () => {
  it("defaults to a dry run of the fixture for en", () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      locale: "en",
      config: DEFAULT_FIXTURE_PATH,
    })
  })
  it("applies only when asked and rejects unknown flags", () => {
    expect(parseArgs(["--apply", "--locale", "fr"]).apply).toBe(true)
    expect(() => parseArgs(["--publish"])).toThrow(/Unknown argument/)
    expect(() => parseArgs(["--locale"])).toThrow(/needs a value/)
  })
})

function fakes({
  blocks = otherBlocks as unknown[],
  draft = null as { id: string } | null,
  hasLocale = true,
} = {}) {
  const prisma = {
    experience: {
      findFirst: vi.fn(async () =>
        hasLocale
          ? { id: "exp-1", locales: [{ id: "loc-1", locale: "en" }] }
          : { id: "exp-1", locales: [] },
      ),
    },
  } as unknown as PrismaClient
  const service = {
    getLocaleDraftState: vi.fn(async () => ({
      effective: { blocks },
      activeDraft: draft,
    })),
    updateLocaleDraft: vi
      .fn<(request: unknown) => Promise<unknown>>()
      .mockResolvedValue({}),
  }
  return { prisma, service }
}

describe("importWatchAudienceConfig", () => {
  it("dry-runs by default: reports the diff and writes nothing", async () => {
    const { prisma, service } = fakes()
    const report = await importWatchAudienceConfig({
      prisma,
      service: service as never,
      configuration,
      locale: "en",
      apply: false,
    })
    expect(report).toMatchObject({
      mode: "dry-run",
      action: "create-block",
      written: false,
      published: false,
      experienceLocaleId: "loc-1",
    })
    expect(report.changedPaths.length).toBeGreaterThan(0)
    expect(service.updateLocaleDraft).not.toHaveBeenCalled()
  })

  it("selects the default template the way the public projection does", async () => {
    const { prisma, service } = fakes()
    await importWatchAudienceConfig({
      prisma,
      service: service as never,
      configuration,
      locale: "fr",
      apply: false,
    })
    expect(prisma.experience.findFirst).toHaveBeenCalledWith({
      where: { isTemplate: true, archivedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { locales: { where: { locale: "fr" }, take: 1 } },
    })
  })

  it("--apply stages exactly one draft write and never publishes", async () => {
    const { prisma, service } = fakes()
    const report = await importWatchAudienceConfig({
      prisma,
      service: service as never,
      configuration,
      locale: "en",
      apply: true,
    })
    expect(report.written).toBe(true)
    expect(service.updateLocaleDraft).toHaveBeenCalledTimes(1)
    const call = service.updateLocaleDraft.mock.calls[0]![0] as {
      input: { id: string; blocks: unknown[] }
      expectedDraftRevision: string | null
    }
    expect(call.input.id).toBe("loc-1")
    expect(call.input.blocks.at(-1)).toMatchObject({ t: "watchAudience" })
    expect(call.expectedDraftRevision).toBeNull()
    expect(Object.keys(service)).not.toContain("publishLocale")
  })

  it("--apply on an already imported draft writes nothing", async () => {
    const { prisma, service } = fakes({
      blocks: [
        ...otherBlocks,
        { t: "watchAudience", sectionKey: "watch-audience", configuration },
      ],
    })
    const report = await importWatchAudienceConfig({
      prisma,
      service: service as never,
      configuration,
      locale: "en",
      apply: true,
    })
    expect(report).toMatchObject({ action: "unchanged", written: false })
    expect(service.updateLocaleDraft).not.toHaveBeenCalled()
  })

  it("fails clearly when the template has no such locale and never creates one", async () => {
    const { prisma, service } = fakes({ hasLocale: false })
    await expect(
      importWatchAudienceConfig({
        prisma,
        service: service as never,
        configuration,
        locale: "en",
        apply: true,
      }),
    ).rejects.toThrow(/never creates templates/)
    expect(service.updateLocaleDraft).not.toHaveBeenCalled()
  })

  it("validates the whole block array with the Experience schema before writing", async () => {
    const { prisma, service } = fakes({
      blocks: [{ t: "notARealBlock" }],
    })
    await expect(
      importWatchAudienceConfig({
        prisma,
        service: service as never,
        configuration,
        locale: "en",
        apply: true,
      }),
    ).rejects.toThrow()
    expect(service.updateLocaleDraft).not.toHaveBeenCalled()
  })
})
