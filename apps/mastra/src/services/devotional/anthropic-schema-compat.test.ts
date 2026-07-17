import { describe, expect, it } from "vitest"

import { _internal as safetyInternal } from "./safety-gate"
import { _internal as writerInternal } from "./devotional-writer"

/**
 * Regression guard for the real OpenRouter→Anthropic structured-output contract.
 *
 * The default DEVOTIONAL_MODEL is an Anthropic model, whose structured-output
 * JSON-schema subset REJECTS several validation keywords with a 400:
 *   "For 'array' type, property 'maxItems' is not supported"
 * Unit tests mock the LLM, so a schema carrying these keywords passes every
 * mocked test yet fails on the very first real call (writer → request_failed;
 * safety → silent fail-closed block). These keywords must live on the Zod
 * schema / prompt instead, never in the JSON schema sent to the model.
 *
 * If a future provider needs them back, gate them behind a provider check —
 * do not just delete this test.
 */

// Keywords Anthropic's structured-output schema does not accept.
const FORBIDDEN = [
  "maxItems",
  "minItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const

function findForbiddenKeywords(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) =>
      findForbiddenKeywords(child, `${path}[${i}]`),
    )
  }
  if (node && typeof node === "object") {
    const hits: string[] = []
    for (const [key, value] of Object.entries(node)) {
      if ((FORBIDDEN as readonly string[]).includes(key)) {
        hits.push(`${path}.${key}`)
      }
      hits.push(...findForbiddenKeywords(value, `${path}.${key}`))
    }
    return hits
  }
  return []
}

describe("Anthropic structured-output schema compatibility", () => {
  const schemas = {
    "devotional-writer": writerInternal.WRITER_JSON_SCHEMA,
    "safety-gate": safetyInternal.SAFETY_JSON_SCHEMA,
  }

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} JSON schema carries no Anthropic-unsupported keywords`, () => {
      expect(findForbiddenKeywords(schema)).toEqual([])
    })
  }
})
