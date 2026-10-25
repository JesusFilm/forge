import { beforeEach, describe, expect, it, vi } from "vitest"

import { schema } from "@/graphql/schema"

const createMock = vi.fn()

type ResolverArgs = {
  requestId: string
  eventType: "result_clicked" | "results_viewed" | "load_more"
  client: "web" | "mobile" | "tv"
  resultId?: string | null
  resultType?: "video" | "experience" | null
  position?: number | null
  visibleResultIds?: string[] | null
  routeLanguageSlug?: string | null
  searchLanguageSlug?: string | null
  occurredAt?: string | null
}

type ResolverCtx = {
  services: { watchSearchEvent: { create: typeof createMock } }
}

type FieldWithResolve = {
  resolve: (
    root: unknown,
    args: ResolverArgs,
    ctx: ResolverCtx,
    info: unknown,
  ) => unknown
}

function getResolver(): FieldWithResolve["resolve"] {
  const fields = schema.getMutationType()!.getFields()
  const field = fields.recordWatchSearchEvent as unknown as FieldWithResolve
  return field.resolve
}

async function invoke(args: ResolverArgs) {
  return getResolver()(
    null,
    args,
    {
      services: { watchSearchEvent: { create: createMock } },
    },
    {},
  )
}

describe("recordWatchSearchEvent resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMock.mockResolvedValue({
      id: "event-1",
      requestId: "search_12345678",
      eventType: "result_clicked",
      client: "web",
      resultId: "video-123",
      resultType: "video",
      position: 1,
      occurredAt: new Date("2026-07-15T10:00:00.000Z"),
      createdAt: new Date("2026-07-15T10:00:01.000Z"),
    })
  })

  it("delegates the public search event payload to the service", async () => {
    const input = {
      requestId: "search_12345678",
      eventType: "result_clicked" as const,
      client: "web" as const,
      resultId: "video-123",
      resultType: "video" as const,
      position: 1,
      visibleResultIds: ["video-123", "video-456"],
      routeLanguageSlug: "english",
      searchLanguageSlug: "russian",
      occurredAt: "2026-07-15T10:00:00.000Z",
    }

    const result = await invoke(input)

    expect(createMock).toHaveBeenCalledWith(input)
    expect(result).toMatchObject({
      id: "event-1",
      requestId: "search_12345678",
      eventType: "result_clicked",
    })
  })
})
