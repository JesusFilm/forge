import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

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
 *
 * DISCOVERED, not enumerated. This started as a hand-written map of two
 * modules, and five later modules carrying their own JSON schemas simply never
 * joined it — while two of their comments claimed this test already covered
 * them. A hardcoded list lets a new module opt out of the guard by existing, so
 * the sweep now walks the directory and every `_internal` export whose name ends
 * in JSON_SCHEMA is checked whether or not anyone remembered it.
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

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Every non-test module in this directory, so a new one is swept by default. */
const moduleFiles = readdirSync(HERE)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort()

type DiscoveredSchema = { module: string; exportName: string; schema: unknown }

async function discoverSchemas(): Promise<DiscoveredSchema[]> {
  const found: DiscoveredSchema[] = []
  for (const file of moduleFiles) {
    // A module that cannot be imported must FAIL, not be skipped: skipping is
    // how a schema quietly leaves the sweep.
    const mod = (await import(`./${file}`)) as Record<string, unknown>
    const internal = mod._internal
    if (!internal || typeof internal !== "object") continue
    for (const [exportName, schema] of Object.entries(
      internal as Record<string, unknown>,
    )) {
      if (exportName.endsWith("JSON_SCHEMA")) {
        found.push({ module: file, exportName, schema })
      }
    }
  }
  return found
}

describe("Anthropic structured-output schema compatibility", () => {
  it("finds every module-declared JSON schema in this directory", async () => {
    const discovered = await discoverSchemas()
    const modules = [...new Set(discovered.map((d) => d.module))].sort()

    // Anti-vacuous: a sweep that silently discovers nothing would report green
    // forever. These seven are the modules known to declare a JSON schema at the
    // time of writing; the assertion is a FLOOR, so adding an eighth needs no
    // edit here, while a refactor that hides one from the sweep turns this red.
    expect(modules).toEqual(
      expect.arrayContaining([
        "devotional-coherence.ts",
        "devotional-conclusion.ts",
        "devotional-reflection-critic.ts",
        "devotional-writer.ts",
        "reflection-fidelity-critic.ts",
        "reflection-point-picker.ts",
        "safety-gate.ts",
      ]),
    )
    expect(discovered.length).toBeGreaterThanOrEqual(7)
  })

  it("no discovered JSON schema carries an Anthropic-unsupported keyword", async () => {
    const discovered = await discoverSchemas()
    const offenders = discovered.flatMap(({ module, exportName, schema }) =>
      findForbiddenKeywords(schema).map(
        (at) => `${module} ${exportName} ${at}`,
      ),
    )
    expect(offenders).toEqual([])
  })
})
