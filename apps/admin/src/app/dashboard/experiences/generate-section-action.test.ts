import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import type { DraftVideoSection } from "@forge/experience-schema"

import {
  runGenerateSectionAction,
  type GenerateSectionActionOverrides,
} from "./generate-section-action"
import type { VideoContextPack } from "@/services/experience-ai/video-context-pack.service"

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }

const LOCALE = {
  id: "loc1",
  status: "DRAFT",
  experienceId: "exp1",
  experience: { ownerId: "admin-1", archivedAt: null },
}

const PACK: VideoContextPack = {
  video: {
    videoId: "vid1",
    slug: "the-resurrection",
    title: "The Resurrection",
    description: "A story of the risen Christ.",
    previewImageUrl: "https://example.com/i.jpg",
    previewStreamUrl: "https://example.com/v.m3u8",
    label: "FEATURE_FILM",
  },
  studyQuestions: [{ text: "Why does the resurrection matter?", order: 1 }],
  citations: [
    {
      reference: "John 20:19-29",
      osisId: "John.20.19",
      chapterStart: 20,
      chapterEnd: null,
      verseStart: 19,
      verseEnd: 29,
    },
  ],
  scene: null,
  transcript: null,
  provenance: {
    studyQuestions: true,
    citations: true,
    scene: false,
    transcript: false,
    localeFallback: null,
  },
}

const VALID_SECTION: DraftVideoSection = {
  blocks: [
    { t: "videoHero", candidateRef: "v01", heading: "The Resurrection" },
    {
      t: "relatedQuestions",
      questions: [
        { question: "Why does the resurrection matter?", answer: "Because..." },
      ],
    },
    {
      t: "bibleQuotesCarousel",
      quotes: [
        {
          reference: "John 20:19-29",
          osisId: "John.20.19",
          chapterStart: 20,
          verseStart: 19,
          verseEnd: 29,
        },
      ],
    },
  ],
}

function mockPrisma(locale: unknown = LOCALE): PrismaClient {
  return {
    experienceLocale: { findUnique: vi.fn().mockResolvedValue(locale) },
  } as unknown as PrismaClient
}

const INPUT = { localeId: "loc1", locale: "en", anchorVideoId: "vid1" }

function overrides(
  o: Partial<GenerateSectionActionOverrides> = {},
): GenerateSectionActionOverrides {
  return {
    remoteEnabled: true,
    loadPack: (async () => PACK) as GenerateSectionActionOverrides["loadPack"],
    launchRemoteSection: (async () => ({
      ok: true,
      draft: VALID_SECTION,
    })) as GenerateSectionActionOverrides["launchRemoteSection"],
    ...o,
  }
}

describe("runGenerateSectionAction", () => {
  it("returns a normalized, stageable section + review on the happy path", async () => {
    const out = await runGenerateSectionAction(
      { prisma: mockPrisma(), user: ADMIN },
      INPUT,
      overrides(),
    )
    expect(out.ok).toBe(true)
    if (out.ok) {
      // candidateRef v01 resolved to the real videoId.
      expect(JSON.stringify(out.draft.blocks)).toContain("vid1")
      // The review ledger flags the anchor + scripture + needs_verification FAQ.
      const kinds = out.review.referenceLedger.map((e) => e.sourceKind)
      expect(kinds).toContain("video_candidate")
      expect(kinds).toContain("scripture")
      expect(kinds).toContain("needs_verification")
    }
  })

  it("LOCALE_NOT_FOUND when the locale is missing", async () => {
    const out = await runGenerateSectionAction(
      { prisma: mockPrisma(null), user: ADMIN },
      INPUT,
      overrides(),
    )
    expect(out).toMatchObject({ ok: false, code: "LOCALE_NOT_FOUND" })
  })

  it("FORBIDDEN for a viewer", async () => {
    const out = await runGenerateSectionAction(
      { prisma: mockPrisma(), user: { id: "v", role: "VIEWER" } },
      INPUT,
      overrides(),
    )
    expect(out).toMatchObject({ ok: false, code: "FORBIDDEN" })
  })

  it("ANCHOR_NOT_FOUND when the anchor is missing / not playable", async () => {
    const out = await runGenerateSectionAction(
      { prisma: mockPrisma(), user: ADMIN },
      INPUT,
      overrides({
        loadPack: (async () =>
          null) as GenerateSectionActionOverrides["loadPack"],
      }),
    )
    expect(out).toMatchObject({ ok: false, code: "ANCHOR_NOT_FOUND" })
  })

  it("NO_GROUNDING when the anchor has neither study questions nor citations", async () => {
    const empty: VideoContextPack = {
      ...PACK,
      studyQuestions: [],
      citations: [],
      provenance: {
        ...PACK.provenance,
        studyQuestions: false,
        citations: false,
      },
    }
    const out = await runGenerateSectionAction(
      { prisma: mockPrisma(), user: ADMIN },
      INPUT,
      overrides({
        loadPack: (async () =>
          empty) as GenerateSectionActionOverrides["loadPack"],
      }),
    )
    expect(out).toMatchObject({ ok: false, code: "NO_GROUNDING" })
  })

  it("NOT_CONFIGURED when the remote section flag is off", async () => {
    const out = await runGenerateSectionAction(
      { prisma: mockPrisma(), user: ADMIN },
      INPUT,
      overrides({ remoteEnabled: false }),
    )
    expect(out).toMatchObject({ ok: false, code: "NOT_CONFIGURED" })
  })

  it("SCHEMA_MISMATCH when the generator fails to produce a valid section", async () => {
    const out = await runGenerateSectionAction(
      { prisma: mockPrisma(), user: ADMIN },
      INPUT,
      overrides({
        launchRemoteSection: (async () => ({
          ok: false,
          reason: "generation_failed",
          retryable: false,
        })) as GenerateSectionActionOverrides["launchRemoteSection"],
      }),
    )
    expect(out).toMatchObject({ ok: false, code: "SCHEMA_MISMATCH" })
  })

  it("UPSTREAM_ERROR on a transient transport failure", async () => {
    const out = await runGenerateSectionAction(
      { prisma: mockPrisma(), user: ADMIN },
      INPUT,
      overrides({
        launchRemoteSection: (async () => ({
          ok: false,
          reason: "network_error",
          retryable: true,
        })) as GenerateSectionActionOverrides["launchRemoteSection"],
      }),
    )
    expect(out).toMatchObject({ ok: false, code: "UPSTREAM_ERROR" })
  })
})
