import { beforeEach, describe, expect, it, vi } from "vitest"

import type { GraphQLEnumType } from "graphql"

import { schema } from "@/graphql/schema"
import {
  WHATS_NEW_STICKER_IDS,
  WhatsNewFeatureVoteBudgetError,
  WhatsNewFeatureVoteValidationError,
} from "@/services/whats-new-feature-votes.service"

const cast = vi.fn()
const retract = vi.fn()
const retractBallot = vi.fn()
const tallies = vi.fn()

type Field = {
  resolve: (root: unknown, args: never, ctx: unknown, info: unknown) => unknown
}

function mutationField(name: string): Field {
  return schema.getMutationType()!.getFields()[name] as unknown as Field
}

function queryField(name: string): Field {
  return schema.getQueryType()!.getFields()[name] as unknown as Field
}

function invoke(field: Field, args: Record<string, unknown>) {
  return field.resolve(
    null,
    args as never,
    {
      services: {
        whatsNewFeatureVote: { cast, retract, retractBallot, tallies },
      },
    },
    {},
  )
}

describe("whats-new feature vote graphql surface", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const mock of [cast, retract, retractBallot, tallies]) {
      mock.mockResolvedValue([{ featureId: "shareable-search", votes: 2 }])
    }
  })

  it("passes a cast through to the service and returns the tallies", async () => {
    const result = await invoke(mutationField("castWhatsNewFeatureVote"), {
      ballotId: "ballot_abcdefgh",
      placementId: "placement_00000001",
      featureId: "shareable-search",
      sticker: "love",
    })

    expect(cast).toHaveBeenCalledWith({
      ballotId: "ballot_abcdefgh",
      placementId: "placement_00000001",
      featureId: "shareable-search",
      // The arg is named `sticker` on the wire and `stickerId` in the store;
      // crossing that seam wrong is silent — every vote would validate as an
      // unknown kind and be rejected.
      stickerId: "love",
    })
    expect(result).toEqual({
      accepted: true,
      refusal: null,
      tallies: [{ featureId: "shareable-search", votes: 2 }],
    })
  })

  it("retracts one placement when given one", async () => {
    await invoke(mutationField("retractWhatsNewFeatureVote"), {
      ballotId: "ballot_abcdefgh",
      placementId: "placement_00000001",
    })

    expect(retract).toHaveBeenCalledWith({
      ballotId: "ballot_abcdefgh",
      placementId: "placement_00000001",
    })
    expect(retractBallot).not.toHaveBeenCalled()
  })

  it("takes the whole ballot back when no placement is named", async () => {
    // The two live on one field, discriminated only by a null argument. Get it
    // backwards and "take my stickers back" clears one sticker, or peeling one
    // sticker clears the board.
    await invoke(mutationField("retractWhatsNewFeatureVote"), {
      ballotId: "ballot_abcdefgh",
      placementId: null,
    })

    expect(retractBallot).toHaveBeenCalledWith("ballot_abcdefgh")
    expect(retract).not.toHaveBeenCalled()
  })

  it("answers a spent budget with data, not an error", async () => {
    // Thrown, this reaches the public client as Yoga's masked "Unexpected
    // error." — indistinguishable from an outage, so the client would retry a
    // request that can never succeed.
    cast.mockRejectedValue(new WhatsNewFeatureVoteBudgetError())

    const result = await invoke(mutationField("castWhatsNewFeatureVote"), {
      ballotId: "ballot_abcdefgh",
      placementId: "placement_00000001",
      featureId: "shareable-search",
      sticker: "love",
    })

    expect(result).toEqual({
      accepted: false,
      refusal: "budget_exhausted",
      // Present on a refusal too, so an optimistic client can correct itself.
      tallies: [{ featureId: "shareable-search", votes: 2 }],
    })
  })

  it("answers a rejected id with data, not an error", async () => {
    cast.mockRejectedValue(
      new WhatsNewFeatureVoteValidationError("Invalid featureId"),
    )

    const result = (await invoke(mutationField("castWhatsNewFeatureVote"), {
      ballotId: "ballot_abcdefgh",
      placementId: "placement_00000001",
      featureId: "NOT A FEATURE",
      sticker: "love",
    })) as { accepted: boolean; refusal: string }

    expect(result.accepted).toBe(false)
    expect(result.refusal).toBe("invalid_input")
  })

  it("still throws when something is actually broken", async () => {
    // The envelope must not swallow a real fault: telling the client "settled,
    // do not retry" would lose a vote the server never recorded.
    cast.mockRejectedValue(new Error("connection terminated"))

    await expect(
      invoke(mutationField("castWhatsNewFeatureVote"), {
        ballotId: "ballot_abcdefgh",
        placementId: "placement_00000001",
        featureId: "shareable-search",
        sticker: "love",
      }),
    ).rejects.toThrow("connection terminated")
  })

  it("reads tallies without arguments", async () => {
    await invoke(queryField("whatsNewFeatureVoteTallies"), {})
    expect(tallies).toHaveBeenCalledTimes(1)
  })

  it("stays anonymous on every field", () => {
    // The page has no login. If any of these picked up a permission scope the
    // whole surface would 403 for the only callers it has.
    for (const [type, name] of [
      ["mutation", "castWhatsNewFeatureVote"],
      ["mutation", "retractWhatsNewFeatureVote"],
      ["query", "whatsNewFeatureVoteTallies"],
    ] as const) {
      const field = (type === "mutation"
        ? schema.getMutationType()!.getFields()
        : schema.getQueryType()!.getFields())[name] as unknown as {
        extensions?: { pothosOptions?: { authScopes?: unknown } }
      }
      expect(field.extensions?.pothosOptions?.authScopes, name).toEqual({
        public: true,
      })
    }
  })

  it("offers exactly the sticker kinds the store accepts", () => {
    // The enum is the compile-time link to web's content file. A kind added to
    // one side and not the other is the whole reason it is an enum.
    const enumType = schema.getTypeMap().WhatsNewSticker as GraphQLEnumType

    expect(
      enumType
        .getValues()
        .map((value) => value.name)
        .sort(),
    ).toEqual([...WHATS_NEW_STICKER_IDS].sort())
  })
})
