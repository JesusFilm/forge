import { describe, expect, it } from "vitest"

import { extractJsonObject } from "./extract-json-object"

describe("extractJsonObject", () => {
  it("returns null when there is no object at all", () => {
    expect(extractJsonObject("just prose, no braces")).toBeNull()
    expect(extractJsonObject("")).toBeNull()
  })

  it("extracts a bare JSON object", () => {
    const out = extractJsonObject('{"mutations":{"title":"Hi"}}')
    expect(out).not.toBeNull()
    expect(JSON.parse(out!)).toEqual({ mutations: { title: "Hi" } })
  })

  it("strips a single ```json fence wrapper", () => {
    const out = extractJsonObject(
      'Here you go:\n```json\n{"mutations":{"title":"Fenced"}}\n```\nDone!',
    )
    expect(out).not.toBeNull()
    expect(JSON.parse(out!)).toEqual({ mutations: { title: "Fenced" } })
  })

  it("ignores brace-bearing prose BEFORE the envelope (does not corrupt extraction)", () => {
    // The first `{` belongs to prose; the real envelope is the second,
    // later object. First-`{`-to-last-`}` extraction would splice them
    // into invalid JSON — the balanced scanner must return the real one.
    const reply =
      "Use the {placeholder} token where needed.\n" +
      '{"mutations":{"title":"Real Envelope"}}'
    const out = extractJsonObject(reply)
    expect(out).not.toBeNull()
    expect(JSON.parse(out!)).toEqual({ mutations: { title: "Real Envelope" } })
  })

  it("returns the LAST parseable object in a multi-fence reply", () => {
    // A model that 'shows its work' emits a planning object then the
    // final envelope. The final (last) object is the one we want.
    const reply = [
      "First my plan:",
      "```json",
      '{"plan":"draft a hero then a quote"}',
      "```",
      "And the final draft:",
      "```json",
      '{"mutations":{"title":"Final"}}',
      "```",
    ].join("\n")
    const out = extractJsonObject(reply)
    expect(out).not.toBeNull()
    expect(JSON.parse(out!)).toEqual({ mutations: { title: "Final" } })
  })

  it("is string-aware: braces inside JSON string values don't break balancing", () => {
    const reply = 'prose {x} \n{"mutations":{"metaDescription":"a } brace"}}'
    const out = extractJsonObject(reply)
    expect(out).not.toBeNull()
    expect(JSON.parse(out!)).toEqual({
      mutations: { metaDescription: "a } brace" },
    })
  })

  it("falls back to the last balanced span for jsonrepair when nothing parses cleanly", () => {
    // Near-valid JSON (trailing comma) won't JSON.parse, but the caller's
    // jsonrepair ladder needs a structurally-bounded span — return it.
    const out = extractJsonObject('prose\n{"mutations":{"title":"x",}}')
    expect(out).toBe('{"mutations":{"title":"x",}}')
  })
})
