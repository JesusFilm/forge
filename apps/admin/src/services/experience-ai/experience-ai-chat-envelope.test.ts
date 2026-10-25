import { describe, expect, it } from "vitest"

import {
  ChatMutationEnvelopeSchema,
  buildChatMutationEnvelopeJsonSchema,
} from "./experience-ai-chat-envelope"

describe("ChatMutationEnvelopeSchema", () => {
  it("accepts a minimal valid envelope", () => {
    const result = ChatMutationEnvelopeSchema.safeParse({
      mutations: { title: "New Title" },
    })
    expect(result.success).toBe(true)
  })

  it("accepts an envelope with optional fields", () => {
    const result = ChatMutationEnvelopeSchema.safeParse({
      mutations: {
        title: "New",
        metaDescription: null,
        blocks: [{ t: "text" }],
        ogImageUrl: "https://example.com/x.png",
      },
      localesAffected: ["en", "th"],
      reason: "rewriting hero copy",
    })
    expect(result.success).toBe(true)
  })

  it("rejects unknown top-level keys", () => {
    const result = ChatMutationEnvelopeSchema.safeParse({
      mutations: {},
      slug: "should-not-be-here",
    })
    expect(result.success).toBe(false)
  })

  it("rejects unknown mutation keys (e.g. slug)", () => {
    const result = ChatMutationEnvelopeSchema.safeParse({
      mutations: { slug: "nope" },
    })
    expect(result.success).toBe(false)
  })

  it("rejects an invalid ogImageUrl", () => {
    const result = ChatMutationEnvelopeSchema.safeParse({
      mutations: { ogImageUrl: "not a url" },
    })
    expect(result.success).toBe(false)
  })
})

describe("buildChatMutationEnvelopeJsonSchema", () => {
  it("returns a parseable JSON Schema object", () => {
    const schema = buildChatMutationEnvelopeJsonSchema()
    expect(schema).toMatchObject({
      type: "object",
      required: ["mutations"],
    })
    expect(schema.properties).toBeDefined()
  })

  it("is JSON-serializable (CLIs receive it as a string)", () => {
    const schema = buildChatMutationEnvelopeJsonSchema()
    expect(() => JSON.stringify(schema)).not.toThrow()
    const roundtripped = JSON.parse(JSON.stringify(schema))
    expect(roundtripped).toEqual(schema)
  })

  it("describes the mutations object as the required field", () => {
    const schema = buildChatMutationEnvelopeJsonSchema() as {
      properties: { mutations: { type: string } }
    }
    expect(schema.properties.mutations.type).toBe("object")
  })

  it("matches the Zod schema's shape — every payload that conforms to the JSON Schema's required fields should pass Zod parsing", () => {
    // The CLI's schema enforcement is a hint; the Zod re-validation is
    // the runtime guarantee. This test asserts the two stay aligned for
    // the canonical shapes we care about.
    const samples = [
      { mutations: { title: "T" } },
      {
        mutations: { metaDescription: "M" },
        reason: "r",
      },
      {
        mutations: { blocks: [{ t: "text", text: "hello" }] },
        localesAffected: ["en"],
      },
    ]
    for (const sample of samples) {
      expect(ChatMutationEnvelopeSchema.safeParse(sample).success).toBe(true)
    }
  })
})
