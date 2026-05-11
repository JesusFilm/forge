// Resolver wiring tests for `watchSetting`. Calls the resolver directly via
// `schema.getFields()` to dodge vitest's transitive-graphql double-instance
// (same pattern as `scene-recommendations.test.ts`, `hybrid-search.test.ts`).
// Auth posture is covered by `public-resolvers.regression.test.ts`; Prisma
// WHERE shape lives in `watch-setting.service.test.ts`.

import { beforeEach, describe, expect, it, vi } from "vitest"

const getMock = vi.fn()
vi.mock("@/services/watch-setting.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/watch-setting.service")
  >("@/services/watch-setting.service")
  return {
    ...actual,
    WatchSettingService: vi.fn(() => ({ get: getMock })),
  }
})

vi.mock("@/db/client", () => ({ prisma: {} }))

import { schema } from "@/graphql/schema"

type ResolverArgs = { locale: string }
type ResolverCtx = {
  services: { watchSetting: { get: typeof getMock } }
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
  const fields = schema.getQueryType()!.getFields()
  const field = fields.watchSetting as unknown as FieldWithResolve
  return field.resolve
}

async function invoke(args: ResolverArgs, ctx?: ResolverCtx) {
  const resolve = getResolver()
  const finalCtx = ctx ?? {
    services: { watchSetting: { get: getMock } },
  }
  return resolve(null, args, finalCtx, {})
}

beforeEach(() => {
  vi.clearAllMocks()
  getMock.mockResolvedValue({
    documentId: "exp-1",
    homepageExperience: null,
    defaultTemplateExperience: null,
  })
})

describe("watchSetting resolver", () => {
  it("passes the locale arg through to WatchSettingService.get", async () => {
    await invoke({ locale: "en" })
    expect(getMock).toHaveBeenCalledWith({ locale: "en" })
  })

  it("returns whatever the service returns (resolver is a thin pass-through)", async () => {
    const homepage = { id: "loc-1", experienceId: "exp-1", locale: "en" }
    getMock.mockResolvedValueOnce({
      documentId: "exp-1",
      homepageExperience: homepage,
      defaultTemplateExperience: null,
    })
    const result = await invoke({ locale: "en" })
    expect(result).toMatchObject({
      documentId: "exp-1",
      homepageExperience: homepage,
      defaultTemplateExperience: null,
    })
  })
})
