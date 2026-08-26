import { describe, expect, it, vi } from "vitest"

import type { StorefrontCuratorConfig } from "../../config/env"
import type { StorefrontMcpResult } from "../../services/storefront-admin-mcp-client"
import {
  buildStorefrontHomepageCurationWorkflow,
  runStorefrontHomepageCuration,
  storefrontCalendarSignals,
  storefrontHomepageCurationWorkflow,
} from "./storefront-homepage-curation"

function config(
  mode: StorefrontCuratorConfig["mode"] = "dry_run",
  overrides: Partial<StorefrontCuratorConfig> = {},
): StorefrontCuratorConfig {
  return {
    mode,
    model: "openai/gpt-5.4-mini",
    modelApiKeyPresent: true,
    enabledLocales: ["en"],
    scheduleEnabled: false,
    recentLimit: 12,
    mcpUrl: "https://admin.example/mcp",
    allowedHosts: "admin.example,auth.example",
    accessToken: "access-1",
    timeoutMs: 5_000,
    maxResponseBytes: 64 * 1024,
    userAgent: "storefront-test/1.0",
    ...overrides,
  }
}

const inventoryItem = (id: string, title: string) => ({
  id,
  coreId: `core-${id}`,
  slug: `slug-${id}`,
  title,
  description: null,
  label: "SHORT_FILM",
  availability: "AUDIO" as const,
  watchLanguageSlug: "english",
  parentSlug: null,
  parentTitle: null,
  publishedAt: "2026-08-18T00:00:00.000Z",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
})

function context(
  hasDraft = false,
  activeDraft: Record<string, unknown> | null = hasDraft
    ? { id: "human-draft" }
    : null,
) {
  const canonical = {
    id: "homepage-en",
    experienceId: "experience-home",
    locale: "en",
    blocks: [
      { t: "watchHomeHero", sectionKey: "homepage-hero" },
      {
        t: "mediaCollection",
        sectionKey: "human-feature",
        variant: "carousel",
        items: [{ videoId: "human-video" }],
      },
      {
        t: "mediaCollection",
        sectionKey: "storefront-curator-new_releases",
        variant: "carousel",
        title: "Last week's picks",
        items: [{ videoId: "old-video" }],
      },
    ],
    updatedAt: "2026-08-20T12:00:00.000Z",
  }
  return {
    locale: "en",
    generatedAt: "2026-08-21T12:00:00.000Z",
    homepageMatchCount: 1,
    homepage: {
      experienceId: "experience-home",
      canonical,
      hasDraft,
      activeDraft,
    },
    targetLanguage: {
      id: "language-en",
      bcp47: "en",
      slug: "english",
      name: { en: "English" },
    },
    inventory: {
      language: { slug: "english", bcp47: "en", name: "English" },
      counts: {
        audioCollections: 0,
        audioVideos: 2,
        subtitleOnlyVideos: 0,
        total: 2,
      },
      promoted: [
        inventoryItem("video-1", "Hope"),
        inventoryItem("video-2", "Peace"),
      ],
      audioCollections: [] as Array<ReturnType<typeof inventoryItem>>,
      audioVideos: [
        inventoryItem("video-1", "Hope"),
        inventoryItem("video-2", "Peace"),
      ],
      subtitleOnlyVideos: [],
    },
    recentTranslations: [
      {
        videoId: "video-3",
        coreId: "core-video-3",
        videoSlug: "slug-video-3",
        title: "Grace",
        label: "SHORT_FILM",
        language: {
          id: "language-es",
          bcp47: "es",
          slug: "spanish",
          name: { en: "Spanish" },
        },
        availability: ["audio" as const],
        aiGenerated: false,
        updatedAt: "2026-08-20T11:00:00.000Z",
      },
      {
        videoId: "video-4",
        coreId: "core-video-4",
        videoSlug: "slug-video-4",
        title: "Mercy",
        label: "SHORT_FILM",
        language: {
          id: "language-es",
          bcp47: "es",
          slug: "spanish",
          name: { en: "Spanish" },
        },
        availability: ["audio" as const, "subtitles" as const],
        aiGenerated: false,
        updatedAt: "2026-08-19T11:00:00.000Z",
      },
    ],
  }
}

const releasesDecision = {
  action: "stage" as const,
  summary: "Fresh English releases merit one concise update.",
  evidence: ["Two recently updated playable English videos."],
  sections: [
    {
      slot: "new_releases" as const,
      title: "New to Watch",
      variant: "carousel" as const,
      items: [{ videoId: "video-1" }, { videoId: "video-2" }],
    },
  ],
}

function successfulAdmin(homepageContext = context()) {
  return vi.fn(
    async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<StorefrontMcpResult<unknown>> => {
      if (name === "storefront.homepage.context") {
        return { ok: true, data: homepageContext }
      }
      if (name === "experience.locale.validate") {
        return { ok: true, data: { valid: true, issues: [] } }
      }
      if (name === "experience.media.check") {
        const blocks = args.blocks as Array<{ items: unknown[] }>
        const count = blocks.reduce((sum, block) => sum + block.items.length, 0)
        return {
          ok: true,
          data: {
            videos: Array.from({ length: count }, () => ({
              availability: { acceptable: true },
            })),
            unresolvedReferences: [],
          },
        }
      }
      if (name === "storefront.homepage.stage") {
        return {
          ok: true,
          data: {
            locale: { id: "homepage-en" },
            draftAttribution: {
              operationId: args.operationId,
              candidateDigest: args.candidateDigest,
            },
            previewUrl: "https://watch.example/preview/storefront",
          },
        }
      }
      if (name === "experience.locale.preview") {
        return {
          ok: true,
          data: { previewUrl: "https://watch.example/preview/storefront" },
        }
      }
      return { ok: false, reason: "rejected", retryable: false }
    },
  )
}

describe("storefront homepage curation workflow", () => {
  it("defaults off without contacting Admin or the model", async () => {
    const callAdmin = vi.fn()
    const curate = vi.fn()

    await expect(
      runStorefrontHomepageCuration(
        {},
        { config: config("off"), callAdmin, curate },
      ),
    ).resolves.toMatchObject({ ok: true, mode: "off", reason: "off" })
    expect(callAdmin).not.toHaveBeenCalled()
    expect(curate).not.toHaveBeenCalled()
  })

  it("refuses a locale outside the configured pilot before Admin or model calls", async () => {
    const callAdmin = vi.fn()
    const curate = vi.fn()

    await expect(
      runStorefrontHomepageCuration(
        { locale: "es" },
        { config: config("dry_run"), callAdmin, curate },
      ),
    ).resolves.toMatchObject({
      ok: false,
      locale: "es",
      reason: "locale_disabled",
    })
    expect(callAdmin).not.toHaveBeenCalled()
    expect(curate).not.toHaveBeenCalled()
  })

  it("canonicalizes an enabled locale before context, prompting, and output", async () => {
    const callAdmin = successfulAdmin()
    const curate = vi.fn(async () => ({
      action: "no_change" as const,
      summary: "The existing English storefront is still timely.",
      evidence: [],
      sections: [],
    }))

    await expect(
      runStorefrontHomepageCuration(
        { locale: "EN" },
        { config: config("dry_run"), callAdmin, curate },
      ),
    ).resolves.toMatchObject({
      ok: true,
      locale: "en",
      reason: "no_change",
      candidateDiffers: false,
      draftStaged: false,
      writeOutcome: "no_change",
    })
    expect(callAdmin).toHaveBeenCalledWith("storefront.homepage.context", {
      locale: "en",
      recentLimit: 12,
    })
    expect(callAdmin).toHaveBeenCalledTimes(1)
    expect(curate).toHaveBeenCalledWith(
      expect.stringContaining('decision for locale "en"'),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    )
  })

  it("refuses a missing model credential before reading Admin context", async () => {
    const callAdmin = vi.fn()
    const curate = vi.fn()

    await expect(
      runStorefrontHomepageCuration(
        {},
        {
          config: config("dry_run", { modelApiKeyPresent: false }),
          callAdmin,
          curate,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "model_api_key_missing",
    })
    expect(callAdmin).not.toHaveBeenCalled()
    expect(curate).not.toHaveBeenCalled()
  })

  it("bounds an unresponsive curator model call", async () => {
    const callAdmin = successfulAdmin()
    const curate = vi.fn(() => new Promise<never>(() => undefined))

    await expect(
      runStorefrontHomepageCuration(
        {},
        {
          config: config(),
          callAdmin,
          curate,
          agentTimeoutMs: 5,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "agent_unavailable",
    })
    expect(curate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    )
  })

  it("refuses to touch a homepage with an active shared draft", async () => {
    const callAdmin = successfulAdmin(context(true))
    const curate = vi.fn()

    await expect(
      runStorefrontHomepageCuration(
        {},
        { config: config(), callAdmin, curate },
      ),
    ).resolves.toMatchObject({ reason: "active_draft", changed: false })
    expect(curate).not.toHaveBeenCalled()
    expect(callAdmin).toHaveBeenCalledTimes(1)
  })

  it("validates a dry run while preserving human-authored sections", async () => {
    const callAdmin = successfulAdmin()
    const result = await runStorefrontHomepageCuration(
      { scheduledFor: "2026-08-21T12:00:00.000Z" },
      {
        config: config("dry_run"),
        callAdmin,
        curate: vi.fn(async () => releasesDecision),
      },
    )

    expect(result).toMatchObject({
      ok: true,
      reason: "dry_run_complete",
      changed: true,
      sectionKeys: ["storefront-curator-new_releases"],
      previewUrl: null,
    })
    const validateCall = callAdmin.mock.calls.find(
      ([name]) => name === "experience.locale.validate",
    )
    const blocks = (validateCall?.[1].draft as { blocks: unknown[] }).blocks
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sectionKey: "homepage-hero" }),
        expect.objectContaining({ sectionKey: "human-feature" }),
        expect.objectContaining({
          sectionKey: "storefront-curator-new_releases",
          title: "New to Watch",
        }),
      ]),
    )
    expect(
      blocks.filter(
        (block) =>
          (block as { sectionKey?: string }).sectionKey ===
          "storefront-curator-new_releases",
      ),
    ).toHaveLength(1)
    expect(callAdmin).not.toHaveBeenCalledWith(
      "storefront.homepage.stage",
      expect.anything(),
    )
  })

  it("stages with an optimistic guard and returns the Admin preview", async () => {
    const callAdmin = successfulAdmin()
    const result = await runStorefrontHomepageCuration(
      { locale: "en" },
      {
        config: config("stage"),
        callAdmin,
        curate: vi.fn(async () => releasesDecision),
        createOperationId: () => "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
      },
    )

    expect(result).toMatchObject({
      ok: true,
      mode: "stage",
      reason: "staged",
      candidateDiffers: true,
      draftStaged: true,
      operationId: "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
      previewUrl: "https://watch.example/preview/storefront",
    })
    expect(callAdmin).toHaveBeenCalledWith(
      "storefront.homepage.stage",
      expect.objectContaining({
        localeId: "homepage-en",
        expectedCanonicalUpdatedAt: "2026-08-20T12:00:00.000Z",
        operationId: "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
        candidateDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    )
    expect(callAdmin.mock.calls.map(([name]) => name)).not.toContain(
      "experience.locale.publish",
    )
  })

  it.each([
    {
      failure: { ok: false, reason: "network_error", retryable: true },
      scenario: "lost network response",
    },
    {
      failure: {
        ok: false,
        reason: "rpc_error",
        retryable: true,
        rpcCode: -32_603,
      },
      scenario: "retryable internal RPC error",
    },
  ] as const)(
    "reconciles a committed stage after a $scenario",
    async ({ failure }) => {
      const operationId = "c6d38f67-8e52-477d-9c97-d50ac32d25a8"
      let candidateDigest: string | undefined
      let contextReads = 0
      const callAdmin = vi.fn(
        async (
          name: string,
          args: Record<string, unknown>,
        ): Promise<StorefrontMcpResult<unknown>> => {
          if (name === "storefront.homepage.context") {
            contextReads += 1
            return {
              ok: true,
              data:
                contextReads === 1
                  ? context()
                  : context(true, {
                      id: "draft-home-en",
                      revisedByKind: "AI",
                      operationId,
                      candidateDigest,
                    }),
            }
          }
          if (name === "experience.locale.validate") {
            return { ok: true, data: { valid: true, issues: [] } }
          }
          if (name === "experience.media.check") {
            return {
              ok: true,
              data: {
                videos: [
                  { availability: { acceptable: true } },
                  { availability: { acceptable: true } },
                ],
                unresolvedReferences: [],
              },
            }
          }
          if (name === "storefront.homepage.stage") {
            candidateDigest = args.candidateDigest as string
            return failure
          }
          if (name === "experience.locale.preview") {
            return {
              ok: true,
              data: { previewUrl: "https://watch.example/preview/reconciled" },
            }
          }
          return { ok: false, reason: "rejected", retryable: false }
        },
      )

      await expect(
        runStorefrontHomepageCuration(
          { locale: "en" },
          {
            config: config("stage"),
            callAdmin,
            curate: vi.fn(async () => releasesDecision),
            createOperationId: () => operationId,
          },
        ),
      ).resolves.toMatchObject({
        ok: true,
        reason: "staged",
        candidateDiffers: true,
        draftStaged: true,
        changed: true,
        operationId,
        previewUrl: "https://watch.example/preview/reconciled",
      })
      expect(
        callAdmin.mock.calls.filter(
          ([name]) => name === "storefront.homepage.stage",
        ),
      ).toHaveLength(1)
      expect(
        callAdmin.mock.calls.filter(
          ([name]) => name === "storefront.homepage.context",
        ),
      ).toHaveLength(2)
    },
  )

  it("reports an unknown stage outcome when reconciliation attribution does not match", async () => {
    const operationId = "c6d38f67-8e52-477d-9c97-d50ac32d25a8"
    let contextReads = 0
    const callAdmin = successfulAdmin()
    callAdmin.mockImplementation(async (name, args) => {
      if (name === "storefront.homepage.context") {
        contextReads += 1
        return {
          ok: true,
          data:
            contextReads === 1
              ? context()
              : context(true, {
                  id: "different-draft",
                  revisedByKind: "AI",
                  operationId: "6d32b850-e42b-4d36-88a9-1bb2b3be91f0",
                  candidateDigest: args.candidateDigest,
                }),
        }
      }
      if (name === "storefront.homepage.stage") {
        return { ok: false, reason: "timeout", retryable: true }
      }
      return successfulAdmin()(name, args)
    })

    await expect(
      runStorefrontHomepageCuration(
        { locale: "en" },
        {
          config: config("stage"),
          callAdmin,
          curate: vi.fn(async () => releasesDecision),
          createOperationId: () => operationId,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "stage_outcome_unknown",
      candidateDiffers: true,
      draftStaged: false,
      changed: false,
      operationId,
      previewUrl: null,
    })
    expect(callAdmin).not.toHaveBeenCalledWith(
      "experience.locale.preview",
      expect.anything(),
    )
  })

  it("does not reconcile a rate-limited stage rejection", async () => {
    const callAdmin = successfulAdmin()
    callAdmin.mockImplementation(async (name, args) => {
      if (name === "storefront.homepage.stage") {
        return {
          ok: false,
          reason: "rate_limited",
          retryable: true,
          status: 429,
        }
      }
      return successfulAdmin()(name, args)
    })

    await expect(
      runStorefrontHomepageCuration(
        { locale: "en" },
        {
          config: config("stage"),
          callAdmin,
          curate: vi.fn(async () => releasesDecision),
          createOperationId: () => "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "admin_unavailable",
      writeOutcome: "no_write",
      draftStaged: false,
      notes: ["rate_limited"],
    })
    expect(
      callAdmin.mock.calls.filter(
        ([name]) => name === "storefront.homepage.context",
      ),
    ).toHaveLength(1)
    expect(callAdmin).not.toHaveBeenCalledWith(
      "experience.locale.preview",
      expect.anything(),
    )
  })

  it("reports unknown when an ambiguous stage cannot be reconciled", async () => {
    let contextReads = 0
    const callAdmin = successfulAdmin()
    callAdmin.mockImplementation(async (name, args) => {
      if (name === "storefront.homepage.context") {
        contextReads += 1
        return contextReads === 1
          ? { ok: true, data: context() }
          : { ok: false, reason: "network_error", retryable: true }
      }
      if (name === "storefront.homepage.stage") {
        return { ok: false, reason: "timeout", retryable: true }
      }
      return successfulAdmin()(name, args)
    })

    await expect(
      runStorefrontHomepageCuration(
        { locale: "EN" },
        {
          config: config("stage"),
          callAdmin,
          curate: vi.fn(async () => releasesDecision),
          createOperationId: () => "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      locale: "en",
      reason: "stage_outcome_unknown",
      writeOutcome: "stage_outcome_unknown",
      draftStaged: false,
      notes: ["timeout", "network_error"],
    })
    expect(
      callAdmin.mock.calls.filter(
        ([name, args]) =>
          name === "storefront.homepage.context" && args.locale === "en",
      ),
    ).toHaveLength(2)
  })

  it("checks a language spotlight against that language's media", async () => {
    const callAdmin = successfulAdmin()
    const decision = {
      action: "stage" as const,
      summary: "Recent Spanish translations support a spotlight.",
      evidence: ["Two videos received playable Spanish translations."],
      sections: [
        {
          slot: "language_spotlight" as const,
          title: "Discover Spanish",
          variant: "carousel" as const,
          items: [
            { videoId: "video-3", languageId: "language-es" },
            { videoId: "video-4", languageId: "language-es" },
          ],
        },
      ],
    }

    await expect(
      runStorefrontHomepageCuration(
        {},
        {
          config: config("dry_run"),
          callAdmin,
          curate: vi.fn(async () => decision),
        },
      ),
    ).resolves.toMatchObject({ reason: "dry_run_complete" })
    expect(callAdmin).toHaveBeenCalledWith(
      "experience.media.check",
      expect.objectContaining({ targetLocale: "es" }),
    )
  })

  it("accepts inventory-backed collection parents without leaf media checks", async () => {
    const collectionContext = context()
    collectionContext.inventory.audioCollections = [
      inventoryItem("collection-1", "Stories of Hope"),
      inventoryItem("collection-2", "Stories of Peace"),
    ]
    collectionContext.inventory.promoted = [
      ...collectionContext.inventory.audioCollections,
    ]
    const callAdmin = successfulAdmin(collectionContext)
    const decision = {
      ...releasesDecision,
      sections: [
        {
          ...releasesDecision.sections[0],
          items: [{ videoId: "collection-1" }, { videoId: "collection-2" }],
        },
      ],
    }

    await expect(
      runStorefrontHomepageCuration(
        {},
        {
          config: config(),
          callAdmin,
          curate: vi.fn(async () => decision),
        },
      ),
    ).resolves.toMatchObject({ reason: "dry_run_complete" })
    expect(callAdmin).not.toHaveBeenCalledWith(
      "experience.media.check",
      expect.anything(),
    )
  })

  it("rejects a collection attributed to a non-target language", async () => {
    const collectionContext = context()
    collectionContext.inventory.audioCollections = [
      inventoryItem("collection-1", "Stories of Hope"),
      inventoryItem("collection-2", "Stories of Peace"),
    ]
    const callAdmin = successfulAdmin(collectionContext)
    const decision = {
      ...releasesDecision,
      sections: [
        {
          ...releasesDecision.sections[0],
          items: [
            { videoId: "collection-1", languageId: "language-es" },
            { videoId: "collection-2" },
          ],
        },
      ],
    }

    await expect(
      runStorefrontHomepageCuration(
        {},
        {
          config: config(),
          callAdmin,
          curate: vi.fn(async () => decision),
        },
      ),
    ).resolves.toMatchObject({
      reason: "invalid_proposal",
      notes: ["collection_language_not_evidenced"],
    })
    expect(callAdmin).not.toHaveBeenCalledWith(
      "experience.media.check",
      expect.anything(),
    )
  })

  it("rejects collection identifiers absent from authoritative inventory", async () => {
    const collectionContext = context()
    collectionContext.inventory.audioCollections = [
      inventoryItem("collection-1", "Stories of Hope"),
    ]
    const callAdmin = successfulAdmin(collectionContext)
    const decision = {
      ...releasesDecision,
      sections: [
        {
          ...releasesDecision.sections[0],
          items: [
            { videoId: "collection-1" },
            { videoId: "collection-not-in-inventory" },
          ],
        },
      ],
    }

    await expect(
      runStorefrontHomepageCuration(
        {},
        {
          config: config(),
          callAdmin,
          curate: vi.fn(async () => decision),
        },
      ),
    ).resolves.toMatchObject({
      reason: "invalid_proposal",
      notes: ["unknown_video:collection-not-in-inventory"],
    })
    expect(callAdmin).not.toHaveBeenCalledWith(
      "experience.media.check",
      expect.anything(),
    )
  })

  it("still checks leaf videos through experience.media.check", async () => {
    const callAdmin = successfulAdmin()

    await expect(
      runStorefrontHomepageCuration(
        {},
        {
          config: config(),
          callAdmin,
          curate: vi.fn(async () => releasesDecision),
        },
      ),
    ).resolves.toMatchObject({ reason: "dry_run_complete" })
    expect(callAdmin).toHaveBeenCalledWith(
      "experience.media.check",
      expect.objectContaining({
        blocks: [
          expect.objectContaining({
            items: [{ videoId: "video-1" }, { videoId: "video-2" }],
          }),
        ],
        targetLocale: "en",
      }),
    )
  })

  it("replaces curated sections at the first prior curator position", async () => {
    const homepageContext = context()
    const [hero, human, priorCurated] =
      homepageContext.homepage.canonical.blocks
    homepageContext.homepage.canonical.blocks = [hero, priorCurated, human]
    const callAdmin = successfulAdmin(homepageContext)

    await runStorefrontHomepageCuration(
      {},
      {
        config: config(),
        callAdmin,
        curate: vi.fn(async () => releasesDecision),
      },
    )

    const validateCall = callAdmin.mock.calls.find(
      ([name]) => name === "experience.locale.validate",
    )
    const blocks = (validateCall?.[1].draft as { blocks: unknown[] }).blocks
    expect(blocks).toEqual([
      hero,
      expect.objectContaining({
        sectionKey: "storefront-curator-new_releases",
        title: "New to Watch",
      }),
      human,
    ])
  })

  it("appends curated sections when the homepage has no prior curator slot", async () => {
    const homepageContext = context()
    const retained = homepageContext.homepage.canonical.blocks.filter(
      (block) => !block.sectionKey.startsWith("storefront-curator-"),
    )
    homepageContext.homepage.canonical.blocks = retained
    const callAdmin = successfulAdmin(homepageContext)

    await runStorefrontHomepageCuration(
      {},
      {
        config: config(),
        callAdmin,
        curate: vi.fn(async () => releasesDecision),
      },
    )

    const validateCall = callAdmin.mock.calls.find(
      ([name]) => name === "experience.locale.validate",
    )
    const blocks = (validateCall?.[1].draft as { blocks: unknown[] }).blocks
    expect(blocks).toEqual([
      ...retained,
      expect.objectContaining({
        sectionKey: "storefront-curator-new_releases",
      }),
    ])
  })

  it("rejects identifiers that were not present in MCP evidence", async () => {
    const callAdmin = successfulAdmin()
    const decision = {
      ...releasesDecision,
      sections: [
        {
          ...releasesDecision.sections[0],
          items: [{ videoId: "invented-video" }, { videoId: "video-2" }],
        },
      ],
    }
    await expect(
      runStorefrontHomepageCuration(
        {},
        {
          config: config(),
          callAdmin,
          curate: vi.fn(async () => decision),
        },
      ),
    ).resolves.toMatchObject({
      reason: "invalid_proposal",
      notes: ["unknown_video:invented-video"],
    })
    expect(callAdmin).not.toHaveBeenCalledWith(
      "experience.locale.validate",
      expect.anything(),
    )
  })

  it("keeps the weekly trigger absent unless its independent flag is enabled", () => {
    expect("getScheduleConfigs" in storefrontHomepageCurationWorkflow).toBe(
      false,
    )
    const enabledSchedules = (
      buildStorefrontHomepageCurationWorkflow(true) as unknown as {
        getScheduleConfigs: () => Array<{ cron: string; timezone?: string }>
      }
    ).getScheduleConfigs()
    expect(enabledSchedules).toEqual([{ cron: "0 6 * * 1", timezone: "UTC" }])
    expect(
      storefrontCalendarSignals(
        new Date("2027-03-15T12:00:00.000Z"),
      ).celebrations.find((item) => item.key === "easter"),
    ).toMatchObject({ date: "2027-03-28", activeWindow: true })
  })
})
