/**
 * Execution tests for the public `search` GraphQL query resolver.
 *
 * Invokes the resolver function directly via `schema.getFields()` to
 * dodge vitest's transitive-graphql double-instance issue (same
 * pattern used by `scene-recommendations.test.ts`). Mocks
 * HybridSearchService so we verify resolver wiring + arg validation
 * + mode plumbing without touching the DB or the embedding provider.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const searchMock = vi.fn()
vi.mock("@/services/hybrid-search.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/hybrid-search.service")
  >("@/services/hybrid-search.service")
  return {
    ...actual,
    HybridSearchService: vi.fn(() => ({ search: searchMock })),
  }
})

vi.mock("@/db/client", () => ({ prisma: {} }))

import { schema } from "@/graphql/schema"

type ResolverArgs = {
  q: string
  locale: string
  type?: "video" | "experience"
  limit?: number
  offset?: number
  mode?: string | null
}

type FieldWithResolve = {
  resolve: (
    root: unknown,
    args: ResolverArgs,
    ctx: unknown,
    info: unknown,
  ) => unknown
}

function getResolver(): FieldWithResolve["resolve"] {
  const fields = schema.getQueryType()!.getFields()
  const field = fields.search as unknown as FieldWithResolve
  return field.resolve
}

async function invoke(args: ResolverArgs) {
  const resolve = getResolver()
  return resolve(null, args, {}, {})
}

beforeEach(() => {
  vi.clearAllMocks()
  searchMock.mockResolvedValue({
    results: [],
    hasMore: false,
    query: "",
    searchMode: "hybrid",
  })
})

describe("Query.search resolver", () => {
  it("rejects empty / whitespace-only q", async () => {
    await expect(invoke({ q: "   ", locale: "en" })).rejects.toThrow(/q/)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it("rejects empty locale", async () => {
    await expect(invoke({ q: "jesus", locale: "" })).rejects.toThrow(/locale/)
  })

  it("rejects unknown content type", async () => {
    // Pothos enum normally rejects this at parse time; the resolver also
    // guards in case a caller passes a raw string through a custom client.
    await expect(
      invoke({
        q: "jesus",
        locale: "en",
        type: "foo" as unknown as "video",
      }),
    ).rejects.toThrow(/type/)
  })

  it("forwards canonical mode='keyword-first' to the service", async () => {
    await invoke({ q: "jesus", locale: "en", mode: "keyword-first" })
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "keyword-first" }),
    )
  })

  it("forwards mode='hybrid' explicitly", async () => {
    await invoke({ q: "jesus", locale: "en", mode: "hybrid" })
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "hybrid" }),
    )
  })

  it("forwards arbitrary mode values verbatim (service warn-and-falls-back)", async () => {
    await invoke({ q: "jesus", locale: "en", mode: "garbage" })
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "garbage" }),
    )
  })

  it("treats empty mode (mode: '') as undefined", async () => {
    await invoke({ q: "jesus", locale: "en", mode: "" })
    const call = searchMock.mock.calls[0]![0]
    expect(call.mode).toBeUndefined()
  })

  it("treats null mode as undefined", async () => {
    await invoke({ q: "jesus", locale: "en", mode: null })
    const call = searchMock.mock.calls[0]![0]
    expect(call.mode).toBeUndefined()
  })

  it("treats missing mode as undefined", async () => {
    await invoke({ q: "jesus", locale: "en" })
    const call = searchMock.mock.calls[0]![0]
    expect(call.mode).toBeUndefined()
  })

  it("forwards trimmed q + locale + limit + offset to the service", async () => {
    await invoke({
      q: "  jesus  ",
      locale: "es",
      limit: 5,
      offset: 10,
    })
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "jesus",
        locale: "es",
        limit: 5,
        offset: 10,
      }),
    )
  })
})

describe("schema description on Query.search.mode arg", () => {
  it("disambiguates from the searchMode response field", () => {
    const field = schema.getQueryType()!.getFields().search!
    const modeArg = field.args.find((a) => a.name === "mode")
    expect(modeArg).toBeDefined()
    const description = modeArg!.description ?? ""
    expect(description).toMatch(/searchMode/)
    expect(description.toLowerCase()).toMatch(/orthogonal/)
  })
})
