import { describe, expect, it } from "vitest"

import {
  WATCH_AUDIENCE_CODE_CONFIG,
  WATCH_AUDIENCE_ROLE_IDS,
  getWatchAudienceRole,
  isSafeWatchAudienceTarget,
  rankWatchAudienceActions,
  validateWatchAudienceConfig,
  watchAudienceReasons,
  type WatchAudienceAction,
  type WatchAudienceConfig,
  type WatchAudienceRoleDefinition,
} from "@/lib/watch-audience-config"

function cloneConfig(): WatchAudienceConfig {
  return structuredClone(WATCH_AUDIENCE_CODE_CONFIG)
}

function roleOf(
  config: WatchAudienceConfig,
  id: (typeof WATCH_AUDIENCE_ROLE_IDS)[number],
): WatchAudienceRoleDefinition {
  const role = config.roles.find((r) => r.id === id)
  if (!role) throw new Error(`missing role ${id}`)
  return role
}

function codes(config: WatchAudienceConfig) {
  return validateWatchAudienceConfig(config).map((issue) => issue.code)
}

/** A tiny role whose scoring is fully controlled by the test. */
function scoringRole(): WatchAudienceRoleDefinition {
  const action = (id: string): WatchAudienceAction => ({
    id,
    title: id,
    body: id,
    target: { kind: "languages" },
  })
  return {
    id: "explore",
    label: "Explore",
    hint: "hint",
    chip: "chip",
    eyebrow: "eyebrow",
    heading: "heading",
    lead: "lead",
    finish: "finish",
    actions: [action("a"), action("b"), action("c")],
    questions: [
      {
        id: "q1",
        prompt: "q1",
        options: [
          {
            id: "o1",
            label: "o1",
            reason: "you chose o1",
            scores: [{ actionId: "c", weight: 2 }],
          },
          { id: "o2", label: "o2", reason: "you chose o2", scores: [] },
        ],
      },
      {
        id: "q2",
        prompt: "q2",
        options: [
          {
            id: "o3",
            label: "o3",
            reason: "you chose o3",
            scores: [
              { actionId: "b", weight: 2 },
              { actionId: "ghost", weight: 9 },
            ],
          },
        ],
      },
    ],
  }
}

describe("code definitions", () => {
  it("validates all four roles with exactly three questions each", () => {
    expect(validateWatchAudienceConfig(WATCH_AUDIENCE_CODE_CONFIG)).toEqual([])
    expect(WATCH_AUDIENCE_CODE_CONFIG.roles.map((r) => r.id)).toEqual([
      "explore",
      "grow",
      "share",
      "partner",
    ])
    for (const role of WATCH_AUDIENCE_CODE_CONFIG.roles) {
      expect(role.questions).toHaveLength(3)
    }
  })

  it("is JSON-serializable so a published config can replace it", () => {
    expect(JSON.parse(JSON.stringify(WATCH_AUDIENCE_CODE_CONFIG))).toEqual(
      WATCH_AUDIENCE_CODE_CONFIG,
    )
  })

  it("lets every action win for at least one answer path", () => {
    for (const role of WATCH_AUDIENCE_CODE_CONFIG.roles) {
      const winners = new Set<string>()
      const walk = (answers: string[]) => {
        const question = role.questions[answers.length]
        if (!question) {
          winners.add(rankWatchAudienceActions(role, answers)[0].action.id)
          return
        }
        for (const option of question.options) walk([...answers, option.id])
      }
      walk([])
      expect({ role: role.id, winners: [...winners].sort() }).toEqual({
        role: role.id,
        winners: role.actions.map((a) => a.id).sort(),
      })
    }
  })

  it("looks roles up by id", () => {
    expect(getWatchAudienceRole(WATCH_AUDIENCE_CODE_CONFIG, "share")?.id).toBe(
      "share",
    )
    expect(
      getWatchAudienceRole(
        { roles: WATCH_AUDIENCE_CODE_CONFIG.roles.slice(0, 1) },
        "share",
      ),
    ).toBeNull()
  })
})

describe("validateWatchAudienceConfig", () => {
  it("rejects a missing, duplicated or unknown role", () => {
    const missing = cloneConfig()
    missing.roles.pop()
    expect(codes(missing)).toContain("role-set")

    const duplicated = cloneConfig()
    duplicated.roles[3] = structuredClone(duplicated.roles[0])
    expect(codes(duplicated)).toContain("role-set")

    const unknown = cloneConfig()
    ;(unknown.roles[0] as { id: string }).id = "visitor"
    expect(codes(unknown)).toContain("role-set")
  })

  it("rejects a role that does not have exactly three questions", () => {
    const four = cloneConfig()
    roleOf(four, "grow").questions.push(
      structuredClone(roleOf(four, "grow").questions[0]),
    )
    expect(validateWatchAudienceConfig(four)).toContainEqual(
      expect.objectContaining({
        code: "question-count",
        path: "roles.grow.questions",
      }),
    )

    const two = cloneConfig()
    roleOf(two, "share").questions.pop()
    expect(codes(two)).toContain("question-count")
  })

  it("rejects an option score that points at an unknown action", () => {
    const config = cloneConfig()
    const scores = roleOf(config, "explore").questions[0].options[0].scores
    const index = scores.length
    scores.push({ actionId: "not-an-action", weight: 1 })
    expect(validateWatchAudienceConfig(config)).toContainEqual(
      expect.objectContaining({
        code: "dangling-action",
        path: `roles.explore.questions.0.options.0.scores.${index}`,
      }),
    )
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 11])(
    "rejects weight %s",
    (weight) => {
      const config = cloneConfig()
      roleOf(config, "partner").questions[1].options[0].scores[0].weight =
        weight
      expect(codes(config)).toContain("invalid-weight")
    },
  )

  it("rejects duplicate and malformed ids", () => {
    const duplicateOption = cloneConfig()
    const options = roleOf(duplicateOption, "explore").questions[0].options
    options[1].id = options[0].id
    expect(codes(duplicateOption)).toContain("duplicate-id")

    const duplicateAction = cloneConfig()
    const actions = roleOf(duplicateAction, "grow").actions
    actions[1].id = actions[0].id
    expect(codes(duplicateAction)).toContain("duplicate-id")

    const duplicateScore = cloneConfig()
    const scores = roleOf(duplicateScore, "share").questions[0].options[0]
      .scores
    scores.push({ ...scores[0] })
    expect(codes(duplicateScore)).toContain("duplicate-id")

    const malformed = cloneConfig()
    roleOf(malformed, "share").questions[0].id = "Who Is It?"
    expect(codes(malformed)).toContain("invalid-id")
  })

  it("rejects unsafe destinations", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "http://www.jesusfilm.org/resources",
      "//www.jesusfilm.org/resources",
      "/watch/jesus.html",
      "https://user:pass@www.jesusfilm.org/",
      "https://www.jesusfilm.org/a b",
      "https://www.jesusfilm.org/\u0000",
      "not a url",
    ]) {
      const config = cloneConfig()
      roleOf(config, "partner").actions[2].target = { kind: "resource", url }
      expect(codes(config), url).toContain("unsafe-destination")
    }

    const slug = cloneConfig()
    roleOf(slug, "explore").actions[0].target = {
      kind: "video",
      slug: "../admin",
    }
    expect(codes(slug)).toContain("unsafe-destination")

    const currentVideo = cloneConfig()
    roleOf(currentVideo, "explore").actions[0].target = {
      kind: "current-video",
      target: "delete" as "share",
    }
    expect(codes(currentVideo)).toContain("unsafe-destination")
  })

  it("rejects too many options, actions, and over-long copy", () => {
    const options = cloneConfig()
    const question = roleOf(options, "explore").questions[0]
    for (let i = 0; i < 10; i += 1) {
      question.options.push({
        id: `extra-${i}`,
        label: "Extra",
        reason: "you picked extra",
        scores: [],
      })
    }
    expect(codes(options)).toContain("option-count")

    const noActions = cloneConfig()
    roleOf(noActions, "explore").actions = []
    expect(codes(noActions)).toContain("action-count")

    const longCopy = cloneConfig()
    roleOf(longCopy, "grow").actions[0].body = "x".repeat(500)
    expect(validateWatchAudienceConfig(longCopy)).toContainEqual(
      expect.objectContaining({
        code: "copy-length",
        path: "roles.grow.actions.0.body",
      }),
    )

    const blank = cloneConfig()
    roleOf(blank, "grow").questions[0].prompt = "   "
    expect(codes(blank)).toContain("copy-length")
  })
})

describe("isSafeWatchAudienceTarget", () => {
  it("accepts the semantic destinations the renderer can build", () => {
    expect(isSafeWatchAudienceTarget({ kind: "video", slug: "jesus" })).toBe(
      true,
    )
    expect(isSafeWatchAudienceTarget({ kind: "history" })).toBe(true)
    expect(isSafeWatchAudienceTarget({ kind: "languages" })).toBe(true)
    expect(
      isSafeWatchAudienceTarget({ kind: "current-video", target: "download" }),
    ).toBe(true)
    expect(
      isSafeWatchAudienceTarget({
        kind: "resource",
        url: "https://www.jesusfilm.org/resources/strategies/training/beginning-with-jesus-replace/",
      }),
    ).toBe(true)
  })
})

describe("rankWatchAudienceActions", () => {
  it("keeps authored order when nothing is answered", () => {
    const ranked = rankWatchAudienceActions(scoringRole(), [])
    expect(ranked.map((r) => [r.action.id, r.score])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 0],
    ])
  })

  it("sorts by score and breaks equal scores by authored order", () => {
    const ranked = rankWatchAudienceActions(scoringRole(), ["o1", "o3"])
    // b and c both score 2: b is authored first.
    expect(ranked.map((r) => [r.action.id, r.score])).toEqual([
      ["b", 2],
      ["c", 2],
      ["a", 0],
    ])
  })

  it("ignores unknown answers, extra answers and scores for unknown actions", () => {
    const ranked = rankWatchAudienceActions(scoringRole(), [
      "nope",
      "o3",
      "o1",
      "o1",
    ])
    expect(ranked.map((r) => r.action.id)).toEqual(["b", "a", "c"])
    expect(ranked).toHaveLength(3)
  })

  it("reads each answer against its own question only", () => {
    // o3 belongs to question 2, so choosing it as the first answer scores nothing.
    const ranked = rankWatchAudienceActions(scoringRole(), ["o3"])
    expect(ranked.map((r) => r.score)).toEqual([0, 0, 0])
  })

  it("does not mutate the role", () => {
    const role = scoringRole()
    const before = structuredClone(role)
    rankWatchAudienceActions(role, ["o1", "o3"])
    expect(role).toEqual(before)
  })
})

describe("watchAudienceReasons", () => {
  it("returns the reason of each answered option in question order", () => {
    expect(watchAudienceReasons(scoringRole(), ["o2", "o3"])).toEqual([
      "you chose o2",
      "you chose o3",
    ])
    expect(watchAudienceReasons(scoringRole(), ["nope"])).toEqual([])
    expect(watchAudienceReasons(scoringRole(), [])).toEqual([])
  })
})
