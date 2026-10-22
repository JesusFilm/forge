import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const requireSession = vi.fn()
const loadWatchSearchTranscriptPublicationHealth = vi.fn()

vi.mock("@/auth/session", () => ({ requireSession }))
vi.mock("@/db/client", () => ({ prisma: { id: "prisma" } }))
vi.mock("@/services/typesense-watch-search-transcript-publication", () => ({
  loadWatchSearchTranscriptPublicationHealth,
}))

const { default: TranscriptPublicationPage } = await import("./page")

function healthFixture(
  overrides: Partial<
    Awaited<ReturnType<typeof loadWatchSearchTranscriptPublicationHealth>>
  > = {},
) {
  return {
    projection: null,
    pendingCount: 0,
    claimedCount: 0,
    deadLetterCount: 0,
    oldestPendingCreatedAt: null,
    oldestPendingAgeMs: null,
    stale: false,
    recentDeadLetters: [],
    ...overrides,
  }
}

describe("WatchSearchTranscriptPublicationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireSession.mockResolvedValue({ role: "ADMIN" })
  })

  it("renders the projection revision and healthy freshness state", async () => {
    loadWatchSearchTranscriptPublicationHealth.mockResolvedValue(
      healthFixture({
        projection: {
          transcriptCollection: "watch_search_transcripts_active",
          contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
          transcriptChunkingVersion: "mastra-v1",
          projectionRevision: "42",
          updatedAt: new Date("2026-10-20T00:00:00.000Z"),
        },
        pendingCount: 1,
        claimedCount: 0,
        oldestPendingAgeMs: 5 * 60_000,
        stale: false,
      }),
    )

    const html = renderToStaticMarkup(await TranscriptPublicationPage())

    expect(html).toContain("42")
    expect(html).toContain("watch_search_transcripts_active")
    expect(html).toContain("1 / 0")
    expect(html).toContain("Within the freshness objective")
    expect(html).not.toContain("exceeds")
  })

  it("flags stale pending work and lists dead-lettered transcripts without raw error text", async () => {
    loadWatchSearchTranscriptPublicationHealth.mockResolvedValue(
      healthFixture({
        pendingCount: 2,
        oldestPendingAgeMs: 20 * 60_000,
        stale: true,
        deadLetterCount: 1,
        recentDeadLetters: [
          {
            transcriptId: "transcript-1",
            videoId: "video-1",
            videoEditionId: "edition-1",
            language: "en",
            workKind: "PUBLICATION",
            attemptCount: 8,
            lastErrorCode: "WatchSearchTranscriptPublicationError",
            deadLetteredAt: new Date("2026-10-21T12:00:00.000Z"),
          },
        ],
      }),
    )

    const html = renderToStaticMarkup(await TranscriptPublicationPage())

    expect(html).toContain("Exceeds the 15 minute freshness alert threshold")
    expect(html).toContain("transcript-1")
    expect(html).toContain("video-1")
    expect(html).toContain("WatchSearchTranscriptPublicationError")
    expect(html).not.toContain("embedding")
  })

  it("requires a session before loading publication health", async () => {
    loadWatchSearchTranscriptPublicationHealth.mockResolvedValue(
      healthFixture(),
    )

    await TranscriptPublicationPage()

    expect(requireSession).toHaveBeenCalledOnce()
  })
})
