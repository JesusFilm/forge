import { format, inspect } from "node:util"
import { createGraphQLError, createSchema, createYoga } from "graphql-yoga"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const environment = vi.hoisted(() => ({ NODE_ENV: "production" }))
vi.mock("@/config/env", () => ({ env: environment }))

import { createGraphqlLogger } from "./logger"

const messages: string[] = []

beforeEach(() => {
  environment.NODE_ENV = "production"
  messages.length = 0
  vi.spyOn(console, "error").mockImplementation((...args) => {
    messages.push(format(...args))
  })
})

afterEach(() => vi.restoreAllMocks())

describe("production GraphQL error logging", () => {
  it("retains native stack, cause and fields without custom inspection", () => {
    const customInspect = vi.fn(() => "expensive source map inspection")
    const cause = new Error("database allocation failed")
    const error = Object.assign(new Error("catalog lookup failed", { cause }), {
      code: "53100",
      [inspect.custom]: customInspect,
    })

    createGraphqlLogger().error(error)

    expect(customInspect).not.toHaveBeenCalled()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain("Error: catalog lookup failed")
    expect(messages[0]).toContain(error.stack!.split("\n")[1])
    expect(messages[0]).toContain("database allocation failed")
    expect(messages[0]).toContain("53100")
  })

  it("keeps development error inspection", () => {
    environment.NODE_ENV = "development"
    const customInspect = vi.fn(() => "development source frame")
    const error = Object.assign(new Error("failure"), {
      [inspect.custom]: customInspect,
    })

    createGraphqlLogger().error(error)

    expect(customInspect).toHaveBeenCalledOnce()
    expect(messages[0]).toContain("development source frame")
  })

  it("preserves normal log arguments and error severity", () => {
    createGraphqlLogger().error("request failed", { status: 503 })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain("ERR")
    expect(messages[0]).toContain("request failed { status: 503 }")
  })

  it("logs every failed field while Yoga retains its masking and response paths", async () => {
    const error = new Error("private database failure")
    const schema = createSchema({
      typeDefs:
        "type Query { items(secret: String): [Item!]! } type Item { playback: String }",
      resolvers: {
        Query: { items: () => Array.from({ length: 206 }, () => ({})) },
        Item: {
          playback: () => {
            throw error
          },
        },
      },
    })
    const yoga = createYoga({
      schema,
      logging: createGraphqlLogger(),
      maskedErrors: { isDev: false },
    })

    const response = await yoga.fetch("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: '{ items(secret: "private-query-literal") { playback } }',
      }),
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.data.items).toEqual(
      Array.from({ length: 206 }, () => ({ playback: null })),
    )
    expect(result.errors).toHaveLength(206)
    for (let index = 0; index < 206; index++) {
      expect(result.errors[index]).toMatchObject({
        message: "Unexpected error.",
        path: ["items", index, "playback"],
      })
    }
    expect(JSON.stringify(result)).not.toContain("private database failure")
    expect(messages).toHaveLength(206)
    expect(messages.join("\n")).not.toContain("private-query-literal")
    expect(messages.every((message) => message.includes(error.stack!))).toBe(
      true,
    )
    expect(messages[205]).toContain("path: [ 'items', 205, 'playback' ]")
  })

  it("keeps intentional domain errors visible without logging a masked failure", async () => {
    const yoga = createYoga({
      schema: createSchema({
        typeDefs: "type Query { value: String }",
        resolvers: {
          Query: {
            value: () => {
              throw createGraphQLError("invalid binding", {
                extensions: { code: "BAD_USER_INPUT" },
              })
            },
          },
        },
      }),
      logging: createGraphqlLogger(),
      maskedErrors: { isDev: false },
    })

    const response = await yoga.fetch("http://localhost/graphql?query={value}")
    const result = await response.json()

    expect(result.errors[0]).toMatchObject({
      message: "invalid binding",
      extensions: { code: "BAD_USER_INPUT" },
    })
    expect(messages).toEqual([])
  })
})
