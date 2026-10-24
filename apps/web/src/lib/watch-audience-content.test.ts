import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { adminGraphql } from "@forge/admin-graphql"
import { adminWatchExperienceFragment } from "@forge/admin-graphql/fragments"
import {
  buildASTSchema,
  parse,
  print,
  validate,
  visit,
  type DocumentNode,
} from "graphql"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock, unstableCacheCalls } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  unstableCacheCalls: [] as {
    keyParts: unknown[]
    options: { revalidate?: unknown; tags?: unknown }
  }[],
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    keyParts: unknown[],
    options?: { revalidate?: unknown; tags?: unknown },
  ) => {
    unstableCacheCalls.push({ keyParts, options: options ?? {} })
    return fn
  },
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  }
})

vi.mock("@/lib/admin-client", () => ({ default: { query: queryMock } }))

import {
  WATCH_AUDIENCE_CODE_CONFIG,
  watchAudienceFrame,
  type WatchAudienceActionTarget,
  type WatchAudienceConfig,
} from "@/lib/watch-audience-config"
import { WATCH_CACHE_TAG_GROUPS } from "@/lib/watch-cache-tags"
import {
  MAX_WATCH_AUDIENCE_JSON_LENGTH,
  WATCH_AUDIENCE_CACHE_TAGS,
  WatchAudienceLoadError,
  isWatchAudienceFieldSchemaLag,
  loadWatchAudience,
  omitWatchAudienceSelection,
  parseWatchAudienceConfig,
  parseWatchAudienceJson,
  partitionWatchAudienceBlockLag,
  projectWatchAudience,
  resolveWatchAudience,
} from "./watch-audience-content"

function clone(): WatchAudienceConfig {
  return structuredClone(WATCH_AUDIENCE_CODE_CONFIG)
}

function withTarget(
  roleId: string,
  actionId: string,
  target: unknown,
): WatchAudienceConfig {
  const config = clone()
  const action = config.roles
    .find((role) => role.id === roleId)!
    .actions.find((candidate) => candidate.id === actionId)!
  ;(action as { target: unknown }).target = target
  return config
}

const wire = (config: unknown, overrides: Record<string, unknown> = {}) => ({
  configJson: JSON.stringify(config),
  rejected: false,
  sourceLocale: "en",
  sourceBlockId: "watch-audience",
  ...overrides,
})

describe("parseWatchAudienceConfig", () => {
  it("round-trips a valid configuration with order and weights intact", () => {
    const parsed = parseWatchAudienceJson(JSON.stringify(clone()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.config).toEqual(clone())
    expect(parsed.droppedActions).toBe(0)
    const explore = parsed.config.roles.find((role) => role.id === "explore")!
    expect(explore.actions.map((action) => action.id)).toEqual(
      clone()
        .roles.find((role) => role.id === "explore")!
        .actions.map((action) => action.id),
    )
  })

  it("ignores fields a newer Admin might add", () => {
    const config = clone() as WatchAudienceConfig & Record<string, unknown>
    config.futureField = { anything: true }
    ;(config.roles[0] as unknown as Record<string, unknown>).futureRoleField = 1
    expect(parseWatchAudienceConfig(config).ok).toBe(true)
  })

  it.each([
    [
      "malformed absolute HTTPS",
      { kind: "resource", url: "https:example.com" },
    ],
    ["javascript:", { kind: "resource", url: "javascript:alert(1)" }],
    ["protocol-relative", { kind: "resource", url: "//evil.example/x" }],
    ["http", { kind: "resource", url: "http://example.com/x" }],
    ["credentials", { kind: "resource", url: "https://user:pw@example.com/" }],
    ["whitespace", { kind: "resource", url: "https://example.com/a b" }],
    [
      "control character",
      { kind: "resource", url: "https://example.com/\u0001" },
    ],
    ["malformed", { kind: "resource", url: "not a url" }],
    ["traversal slug", { kind: "video", slug: "../jesus" }],
    ["uppercase slug", { kind: "video", slug: "Jesus" }],
  ])(
    "drops the action with a %s destination and every score that pointed at it",
    (_label, target) => {
      const config = withTarget("explore", "explore-full-film", target)
      const before = config.roles.find((role) => role.id === "explore")!
      const scoredBefore = before.questions.some((question) =>
        question.options.some((option) =>
          option.scores.some((score) => score.actionId === "explore-full-film"),
        ),
      )
      expect(scoredBefore).toBe(true)

      const parsed = parseWatchAudienceConfig(config)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const explore = parsed.config.roles.find((role) => role.id === "explore")!
      expect(parsed.droppedActions).toBe(1)
      expect(explore.actions.map((action) => action.id)).toEqual(
        before.actions
          .map((action) => action.id)
          .filter((id) => id !== "explore-full-film"),
      )
      for (const question of explore.questions) {
        for (const option of question.options) {
          expect(option.scores.map((score) => score.actionId)).not.toContain(
            "explore-full-film",
          )
        }
      }
      // The rest of the role is untouched, including weights and option order.
      const keptBefore = before.questions.map((question) =>
        question.options.map((option) =>
          option.scores.filter(
            (score) => score.actionId !== "explore-full-film",
          ),
        ),
      )
      expect(
        explore.questions.map((question) =>
          question.options.map((option) => option.scores),
        ),
      ).toEqual(keptBefore)
    },
  )

  it("rejects the whole configuration when a role loses every action", () => {
    const config = clone()
    const share = config.roles.find((role) => role.id === "share")!
    for (const action of share.actions) {
      ;(action as { target: WatchAudienceActionTarget }).target = {
        kind: "resource",
        url: "javascript:void(0)",
      }
    }
    expect(parseWatchAudienceConfig(config)).toEqual({
      ok: false,
      reason: "action-count:roles.share.actions",
    })
  })

  it("rejects an unknown target kind and an unknown current-video control", () => {
    expect(
      parseWatchAudienceConfig(
        withTarget("explore", "explore-full-film", {
          kind: "iframe",
          url: "x",
        }),
      ).ok,
    ).toBe(false)
    expect(
      parseWatchAudienceConfig(
        withTarget("explore", "explore-full-film", {
          kind: "current-video",
          target: "delete",
        }),
      ).ok,
    ).toBe(false)
  })

  it("rejects a score that points at an action that never existed", () => {
    const config = clone()
    config.roles[0].questions[0].options[0].scores.push({
      actionId: "never-existed",
      weight: 1,
    })
    const parsed = parseWatchAudienceConfig(config)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toMatch(/^dangling-action:/)
  })

  it("rejects bad cardinality and weights", () => {
    const twoQuestions = clone()
    twoQuestions.roles[1].questions.pop()
    expect(parseWatchAudienceConfig(twoQuestions).ok).toBe(false)

    const threeRoles = clone()
    threeRoles.roles.pop()
    expect(parseWatchAudienceConfig(threeRoles)).toEqual({
      ok: false,
      reason: "role-set",
    })

    for (const weight of [0, 11, 1.5, "3"]) {
      const bad = clone()
      ;(
        bad.roles[0].questions[0].options[0].scores[0] as { weight: unknown }
      ).weight = weight
      expect(parseWatchAudienceConfig(bad).ok).toBe(false)
    }
  })

  it("bounds the work before it iterates an oversized list", () => {
    const huge = clone()
    huge.roles[0].actions = Array.from({ length: 200_000 }, (_, i) => ({
      id: `a${i}`,
      title: "t",
      body: "b",
      target: { kind: "languages" as const },
    }))
    expect(parseWatchAudienceConfig(huge)).toEqual({
      ok: false,
      reason: "malformed-structure",
    })
  })

  it("refuses an oversized or malformed body without echoing it", () => {
    expect(
      parseWatchAudienceJson("x".repeat(MAX_WATCH_AUDIENCE_JSON_LENGTH + 1)),
    ).toEqual({ ok: false, reason: "too-large" })
    const parsed = parseWatchAudienceJson('{"roles": SECRET-FRAGMENT')
    expect(parsed).toEqual({ ok: false, reason: "invalid-json" })
    expect(JSON.stringify(parsed)).not.toContain("SECRET")
  })

  it("accepts the largest legal payload inside the JSON cap", () => {
    // 4 roles x 8 actions x 3 questions x 6 options, all copy at its limit.
    const config = clone()
    for (const role of config.roles) {
      const base = role.actions[0]
      role.actions = Array.from({ length: 8 }, (_, i) => ({
        ...base,
        id: `action-${i}`,
        title: "あ".repeat(80),
        body: "あ".repeat(160),
      }))
      for (const question of role.questions) {
        question.options = Array.from({ length: 6 }, (_, o) => ({
          id: `option-${o}`,
          label: "あ".repeat(60),
          hint: "あ".repeat(80),
          reason: "あ".repeat(80),
          scores: role.actions.map((action) => ({
            actionId: action.id,
            weight: 10,
          })),
        }))
      }
    }
    const json = JSON.stringify(config)
    expect(json.length).toBeLessThan(MAX_WATCH_AUDIENCE_JSON_LENGTH)
    expect(parseWatchAudienceJson(json).ok).toBe(true)
  })
})

describe("projectWatchAudience", () => {
  it("preserves the resolved source language independently from the requested page", () => {
    expect(
      projectWatchAudience(wire(clone(), { sourceLocale: "ar" })),
    ).toMatchObject({ kind: "authored", sourceLocale: "ar" })
    expect(
      projectWatchAudience(wire(clone(), { sourceLocale: "en" })),
    ).toMatchObject({ kind: "authored", sourceLocale: "en" })
  })

  it("is absent only when Admin returned no projection", () => {
    expect(projectWatchAudience(null)).toEqual({ kind: "absent" })
  })

  it("never falls back for a present-but-unusable authored configuration", () => {
    for (const projection of [
      wire(clone(), { rejected: true, configJson: null }),
      wire(clone(), { rejected: true }),
      wire(clone(), { configJson: null }),
      wire(clone(), { configJson: "not json" }),
      wire(withTarget("explore", "explore-full-film", { kind: "x" })),
    ]) {
      const resolution = projectWatchAudience(projection)
      expect(resolution).toEqual({ kind: "rejected" })
      expect(watchAudienceFrame(resolution)).toBeNull()
    }
  })

  it("keeps the temporary code fallback for absent and nothing else", () => {
    expect(watchAudienceFrame({ kind: "absent" })?.config).toBe(
      WATCH_AUDIENCE_CODE_CONFIG,
    )
    expect(watchAudienceFrame(undefined)?.config).toBe(
      WATCH_AUDIENCE_CODE_CONFIG,
    )
    expect(watchAudienceFrame({ kind: "unavailable" })).toBeNull()
    expect(watchAudienceFrame({ kind: "rejected" })).toBeNull()
  })

  it("changes identity with authored weights and order but not with a re-read", () => {
    const base = projectWatchAudience(wire(clone()))
    const again = projectWatchAudience(wire(clone()))
    const reweighted = clone()
    reweighted.roles[0].questions[0].options[0].scores[0].weight = 9
    const reordered = clone()
    reordered.roles[0].actions.reverse()
    const identity = (r: ReturnType<typeof projectWatchAudience>) =>
      r.kind === "authored" ? r.identity : null
    expect(identity(base)).toBe(identity(again))
    expect(identity(projectWatchAudience(wire(reweighted)))).not.toBe(
      identity(base),
    )
    expect(identity(projectWatchAudience(wire(reordered)))).not.toBe(
      identity(base),
    )
    expect(
      identity(projectWatchAudience(wire(clone(), { sourceLocale: "fr" }))),
    ).not.toBe(identity(base))
  })
})

describe("schema lag classification", () => {
  const field = 'Cannot query field "watchAudience" on type "WatchSetting".'

  it("matches only validation errors that name the new field or type", () => {
    expect(
      isWatchAudienceFieldSchemaLag({ errors: [{ message: field }] }),
    ).toBe(true)
    expect(
      isWatchAudienceFieldSchemaLag({
        error: { errors: [{ message: `${field} Did you mean "x"?` }] } as never,
      }),
    ).toBe(true)
  })

  it.each([
    ["no errors", {}],
    [
      "an unrelated validation error",
      {
        errors: [
          { message: 'Cannot query field "nope" on type "WatchSetting".' },
        ],
      },
    ],
    [
      "the lag message mixed with another error",
      { errors: [{ message: field }, { message: "Something else broke" }] },
    ],
    [
      "an execution error that happens to quote the message",
      { errors: [{ message: field, path: ["watchSetting", "watchAudience"] }] },
    ],
    [
      "a non-validation code",
      {
        errors: [
          { message: field, extensions: { code: "INTERNAL_SERVER_ERROR" } },
        ],
      },
    ],
  ])("does not treat %s as schema lag", (_label, result) => {
    expect(isWatchAudienceFieldSchemaLag(result as never)).toBe(false)
  })

  it("splits the block-type lag from everything else", () => {
    const partition = partitionWatchAudienceBlockLag({
      errors: [
        { message: 'Unknown type "WatchAudienceBlock".' },
        {
          message:
            'Cannot query field "title" on type "WatchHomeCategoryRailBlock".',
        },
        { message: 'Unknown type "WatchAudienceBlock".', path: ["x"] },
      ],
    })
    expect(partition.audience).toBe(true)
    expect(partition.rest.errors).toHaveLength(2)
    expect(
      partitionWatchAudienceBlockLag({ errors: [{ message: "other" }] })
        .audience,
    ).toBe(false)
  })
})

describe("loadWatchAudience", () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  it("asks for the requested locale only, with no request-bound options", async () => {
    queryMock.mockResolvedValue({
      data: { watchSetting: { watchAudience: wire(clone()) } },
    })
    const resolution = await loadWatchAudience("fr")
    expect(resolution.kind).toBe("authored")
    expect(queryMock).toHaveBeenCalledTimes(1)
    const call = queryMock.mock.calls[0][0]
    expect(call.variables).toEqual({ locale: "fr" })
    expect(Object.keys(call).sort()).toEqual([
      "fetchPolicy",
      "query",
      "variables",
    ])
    expect(print(call.query)).toContain("watchAudience(locale: $locale)")
  })

  it("is absent when Admin has no setting or no authored block", async () => {
    queryMock.mockResolvedValueOnce({ data: { watchSetting: null } })
    queryMock.mockResolvedValueOnce({
      data: { watchSetting: { watchAudience: null } },
    })
    expect(await loadWatchAudience("en")).toEqual({ kind: "absent" })
    expect(await loadWatchAudience("de")).toEqual({ kind: "absent" })
  })

  it("is rejected, not absent, when Admin reports an unusable authored block", async () => {
    queryMock.mockResolvedValue({
      data: {
        watchSetting: {
          watchAudience: wire(null, { configJson: null, rejected: true }),
        },
      },
    })
    expect(await loadWatchAudience("en")).toEqual({ kind: "rejected" })
  })

  it("treats an Admin that predates the field as absent after one query", async () => {
    queryMock.mockRejectedValue({
      errors: [
        {
          message: 'Cannot query field "watchAudience" on type "WatchSetting".',
        },
      ],
    })
    expect(await loadWatchAudience("en")).toEqual({ kind: "absent" })
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it("treats a lag message returned in the result the same way", async () => {
    queryMock.mockResolvedValue({
      errors: [
        {
          message: 'Cannot query field "watchAudience" on type "WatchSetting".',
        },
      ],
    })
    expect(await loadWatchAudience("en")).toEqual({ kind: "absent" })
  })

  it.each([
    [
      "a network failure",
      () => queryMock.mockRejectedValue(new Error("fetch failed")),
    ],
    [
      "an unrelated validation error",
      () =>
        queryMock.mockResolvedValue({
          errors: [
            { message: 'Cannot query field "zzz" on type "WatchSetting".' },
          ],
        }),
    ],
    [
      "an execution error quoting the lag text",
      () =>
        queryMock.mockResolvedValue({
          errors: [
            {
              message:
                'Cannot query field "watchAudience" on type "WatchSetting".',
              path: ["watchSetting"],
            },
          ],
        }),
    ],
    [
      "the lag text mixed with another error",
      () =>
        queryMock.mockRejectedValue({
          errors: [
            {
              message:
                'Cannot query field "watchAudience" on type "WatchSetting".',
            },
            { message: "Rate limit exceeded" },
          ],
        }),
    ],
  ])(
    "surfaces %s as a diagnosable error and does not retry",
    async (_l, arrange) => {
      arrange()
      await expect(loadWatchAudience("en")).rejects.toBeInstanceOf(
        WatchAudienceLoadError,
      )
      expect(queryMock).toHaveBeenCalledTimes(1)
    },
  )

  it("keeps the failure cause", async () => {
    const cause = new Error("fetch failed")
    queryMock.mockRejectedValue(cause)
    await expect(loadWatchAudience("en")).rejects.toMatchObject({
      message: "Watch audience query failed: fetch failed",
      cause,
    })
  })
})

describe("ISR safety", () => {
  const source = readFileSync(
    resolve(__dirname, "watch-audience-content.ts"),
    "utf8",
  )

  it("reads no request state, so the shared cache can never hold one visitor's data", () => {
    expect(source).not.toMatch(/next\/headers|\bcookies\s*\(|\bheaders\s*\(/)
    expect(source).not.toMatch(/\bauthorization\b/i)
    // Anti-vacuous: the same source does cache through Next's Data Cache.
    expect(source).toMatch(/unstable_cache\(/)
  })
})

describe("resolveWatchAudience", () => {
  beforeEach(() => {
    queryMock.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it("is cached on the revalidation tags the watch-setting webhook expires", () => {
    const call = unstableCacheCalls.find(
      ({ keyParts }) => keyParts[0] === "watch-audience",
    )
    expect(call?.options.tags).toEqual([...WATCH_AUDIENCE_CACHE_TAGS])
    // Also asserted literally by the revalidate route test.
    expect([...WATCH_AUDIENCE_CACHE_TAGS]).toEqual([
      "watch:settings",
      "watch:experience",
    ])
    for (const tag of WATCH_AUDIENCE_CACHE_TAGS) {
      expect(WATCH_CACHE_TAG_GROUPS.watchSetting).toContain(tag)
    }
  })

  it("omits the frame and logs when the load fails, never substituting the code config", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    queryMock.mockRejectedValue(new Error("fetch failed"))
    const resolution = await resolveWatchAudience("en")
    expect(resolution).toEqual({ kind: "unavailable" })
    expect(watchAudienceFrame(resolution)).toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
    const line = String(error.mock.calls[0][0])
    expect(line).toContain("event=watch_audience.load_failed")
    expect(line).toContain("locale=en")
    expect(line).toContain("fetch_failed")
  })

  it("resolves the published configuration for a locale", async () => {
    queryMock.mockResolvedValue({
      data: { watchSetting: { watchAudience: wire(clone()) } },
    })
    expect((await resolveWatchAudience("en")).kind).toBe("authored")
  })
})

describe("schema lag against the real SDL", () => {
  const sdlAst = parse(
    readFileSync(resolve(__dirname, "../../../admin/schema.graphql"), "utf8"),
  )
  // The same SDL as an Admin that predates the feature: the block type and its
  // union membership, or the WatchSetting field and its type, are gone.
  const without = (drop: {
    objects: string[]
    fields?: { type: string; field: string }[]
    unionMember?: string
  }) =>
    buildASTSchema(
      visit(sdlAst, {
        ObjectTypeDefinition(node) {
          if (drop.objects.includes(node.name.value)) return null
          const fields = drop.fields?.filter(
            (entry) => entry.type === node.name.value,
          )
          if (!fields?.length) return undefined
          return {
            ...node,
            fields: node.fields?.filter(
              (field) =>
                !fields.some((entry) => entry.field === field.name.value),
            ),
          }
        },
        UnionTypeDefinition(node) {
          return drop.unionMember
            ? {
                ...node,
                types: node.types?.filter(
                  (type) => type.name.value !== drop.unionMember,
                ),
              }
            : undefined
        },
      }),
      { assumeValidSDL: true },
    )
  const current = buildASTSchema(sdlAst, { assumeValidSDL: true })

  describe("the WatchAudienceBlock union member", () => {
    const old = without({
      objects: ["WatchAudienceBlock"],
      unionMember: "WatchAudienceBlock",
    })
    const query = adminGraphql(
      `
        query LagProbe($locale: String!) {
          watchSetting(locale: $locale) {
            homepageExperience { ...AdminWatchExperience }
            defaultTemplateExperience { ...AdminWatchExperience }
          }
        }
      `,
      [adminWatchExperienceFragment],
    ) as DocumentNode
    // gql.tada's client-side `@_unmask` directive is not part of Admin's SDL.
    const server = (doc: DocumentNode): DocumentNode =>
      visit(doc, {
        Directive: (node) => (node.name.value === "_unmask" ? null : undefined),
      })

    it("sanity: the current document selects the block; the old schema lacks it", () => {
      expect(print(query)).toContain("... on WatchAudienceBlock")
      expect(current.getType("WatchAudienceBlock")).toBeDefined()
      expect(old.getType("WatchAudienceBlock")).toBeUndefined()
      expect(validate(current, server(query))).toEqual([])
    })

    it("an Admin without the block rejects it with the message the classifier pins", () => {
      const errors = validate(old, server(query))
      expect(errors.length).toBeGreaterThan(0)
      expect(
        errors.every((entry) =>
          /^Unknown type "WatchAudienceBlock"\./.test(entry.message),
        ),
      ).toBe(true)
      const partition = partitionWatchAudienceBlockLag({
        errors: errors.map((entry) => ({ message: entry.message })),
      })
      expect(partition.audience).toBe(true)
      expect(partition.rest.errors).toHaveLength(0)
    })

    it("the derived document is valid on both schemas and drops only the block", () => {
      const omitted = omitWatchAudienceSelection(query)
      expect(validate(current, server(omitted))).toEqual([])
      expect(validate(old, server(omitted))).toEqual([])
      expect(print(omitted)).not.toContain("WatchAudience")

      const names = (doc: DocumentNode) =>
        doc.definitions.map((definition) =>
          definition.kind === "FragmentDefinition"
            ? definition.name.value
            : definition.kind,
        )
      expect(
        names(query).filter((name) => name !== "AdminWatchAudience"),
      ).toEqual(names(omitted))
      // Everything else is byte-identical once the block's lines go.
      const block =
        /\n\s*\.\.\. on WatchAudienceBlock \{\n\s*\.\.\.AdminWatchAudience\n\s*\}/g
      const withoutBlock = print({
        ...query,
        definitions: query.definitions.filter(
          (definition) =>
            definition.kind !== "FragmentDefinition" ||
            definition.name.value !== "AdminWatchAudience",
        ),
      }).replace(block, "")
      expect(print(omitted)).toBe(withoutBlock)
    })

    it("does not mutate the shared document", () => {
      const before = print(query)
      omitWatchAudienceSelection(query)
      expect(print(query)).toBe(before)
    })
  })

  describe("the WatchSetting.watchAudience field", () => {
    const query = parse(`
      query GetWatchAudience($locale: String!) {
        watchSetting(locale: $locale) {
          watchAudience(locale: $locale) {
            configJson
            sourceLocale
            sourceBlockId
            rejected
          }
        }
      }
    `)

    it("the current schema accepts the loader's selection", () => {
      expect(validate(current, query)).toEqual([])
    })

    it.each([
      [
        "the field",
        {
          objects: ["WatchAudienceConfiguration"],
          fields: [{ type: "WatchSetting", field: "watchAudience" }],
        },
      ],
    ])(
      "an Admin without %s rejects it with a message the loader treats as lag",
      (_label, drop) => {
        const errors = validate(without(drop), query)
        expect(errors.length).toBeGreaterThan(0)
        expect(
          isWatchAudienceFieldSchemaLag({
            errors: errors.map((entry) => ({ message: entry.message })),
          }),
        ).toBe(true)
      },
    )

    it("an Admin whose type lacks one projected field is lag too, and an unrelated field is not", () => {
      const partial = without({
        objects: [],
        fields: [{ type: "WatchAudienceConfiguration", field: "rejected" }],
      })
      const errors = validate(partial, query).map((entry) => ({
        message: entry.message,
      }))
      expect(errors).toHaveLength(1)
      expect(isWatchAudienceFieldSchemaLag({ errors })).toBe(true)
      const unrelated = validate(
        current,
        parse(
          "query($locale: String!) { watchSetting(locale: $locale) { nope } }",
        ),
      ).map((entry) => ({ message: entry.message }))
      expect(unrelated).toHaveLength(1)
      expect(isWatchAudienceFieldSchemaLag({ errors: unrelated })).toBe(false)
    })
  })
})

describe("reviewed local fixture", () => {
  // The Admin import script seeds this file into a local default template
  // draft. While the baked-in definitions still stand in for an unauthored
  // locale, this pins the two so the seeded configuration is what visitors
  // see today. Delete with `WATCH_AUDIENCE_CODE_CONFIG` once an authored
  // configuration is published and the fallback is retired.
  const fixture = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        "../../../admin/src/scripts/fixtures/watch-audience-default.json",
      ),
      "utf8",
    ),
  ) as unknown

  it("is exactly the code definitions, and a valid authored configuration", () => {
    expect(fixture).toEqual(WATCH_AUDIENCE_CODE_CONFIG)
    const parsed = parseWatchAudienceConfig(fixture)
    expect(parsed.ok && parsed.droppedActions).toBe(0)
  })
})
