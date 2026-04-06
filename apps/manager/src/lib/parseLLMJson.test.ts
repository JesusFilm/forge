import { describe, it, expect } from "vitest"
import { parseLLMJson } from "./parseLLMJson"
import { z } from "zod"

const schema = z.object({
  name: z.string(),
  value: z.number(),
})

type Result = z.infer<typeof schema>

const fallback: Result = { name: "", value: 0 }

describe("parseLLMJson", () => {
  it("parses clean JSON", () => {
    const result = parseLLMJson('{"name":"test","value":42}', schema, fallback)
    expect(result).toEqual({ name: "test", value: 42 })
  })

  it("strips ```json fences", () => {
    const input = '```json\n{"name":"fenced","value":1}\n```'
    const result = parseLLMJson(input, schema, fallback)
    expect(result).toEqual({ name: "fenced", value: 1 })
  })

  it("strips ``` fences without language tag", () => {
    const input = '```\n{"name":"bare","value":2}\n```'
    const result = parseLLMJson(input, schema, fallback)
    expect(result).toEqual({ name: "bare", value: 2 })
  })

  it("handles leading/trailing whitespace around fences", () => {
    const input = '  \n```json\n{"name":"spaced","value":3}\n```\n  '
    const result = parseLLMJson(input, schema, fallback)
    expect(result).toEqual({ name: "spaced", value: 3 })
  })

  it("returns fallback for invalid JSON after stripping", () => {
    const input = "```json\nnot valid json\n```"
    const result = parseLLMJson(input, schema, fallback, "test")
    expect(result).toEqual(fallback)
  })

  it("returns fallback when schema validation fails", () => {
    const input = '{"name":123,"value":"wrong"}'
    const result = parseLLMJson(input, schema, fallback, "test")
    expect(result).toEqual(fallback)
  })

  it("returns fallback for completely invalid input", () => {
    const result = parseLLMJson("hello world", schema, fallback, "test")
    expect(result).toEqual(fallback)
  })
})
