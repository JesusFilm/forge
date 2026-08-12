import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { _internal as accentInternal } from "./russian-accent"
import { _internal as coherenceInternal } from "./devotional-coherence"
import { _internal as conclusionInternal } from "./devotional-conclusion"
import { _internal as copyInternal } from "./devotional-copy"
import { _internal as depthInternal } from "./devotional-reflection-critic"
import { _internal as highlighterInternal } from "./reflection-highlighter"
import { _internal as hookInternal } from "./hook-picker"
import { _internal as matcherInternal } from "./local-video-matcher"
import { _internal as passageInternal } from "./passage-scripture"
import { _internal as selectorInternal } from "./scripture-selector"
import { _internal as safetyInternal } from "./safety-gate"
import { _internal as writerInternal } from "./devotional-writer"
import { _internal as fidelityInternal } from "./reflection-fidelity-critic"
import { _internal as modernizerInternal } from "./reflection-modernizer"
import { _internal as pickerInternal } from "./reflection-point-picker"
import { _internal as rankerInternal } from "./spurgeon-ranker"
import { _internal as translateInternal } from "./translate-devotional"

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
    // Every agent that asks a model for structured output belongs here. These
    // were NOT covered when the guard was written, and the gap cost a full day:
    // devotional-reflection-critic carried `minimum`/`maximum` on its integer
    // depthScore, so Anthropic 400'd EVERY call and the critic never ran once —
    // while its fail-open default printed "3/5 solid" and made the logs look
    // healthy. The guard existed; the new schemas simply sat outside it.
    "devotional-coherence": coherenceInternal.JSON_SCHEMA,
    "devotional-reflection-critic": depthInternal.JSON_SCHEMA,
    "reflection-fidelity-critic": fidelityInternal.JSON_SCHEMA,
    "reflection-point-picker": pickerInternal.JSON_SCHEMA,
    "reflection-modernizer": modernizerInternal.JSON_SCHEMA,
    "devotional-conclusion": conclusionInternal.JSON_SCHEMA,
    "translate-devotional": translateInternal.JSON_SCHEMA,
    "spurgeon-ranker": rankerInternal.JSON_SCHEMA,
    // Found by the coverage guard below, not by hand — these predate the newer
    // critics and had never been asserted either.
    "devotional-copy": copyInternal.JSON_SCHEMA,
    "hook-picker/news": hookInternal.NEWS_JSON_SCHEMA,
    "hook-picker/question": hookInternal.QUESTION_JSON_SCHEMA,
    "local-video-matcher": matcherInternal.JSON_SCHEMA,
    "passage-scripture": passageInternal.JSON_SCHEMA,
    "reflection-highlighter": highlighterInternal.JSON_SCHEMA,
    "russian-accent": accentInternal.JSON_SCHEMA,
    "scripture-selector": selectorInternal.JSON_SCHEMA,
  }

  /** Modules covered above, by filename — `hook-picker` contributes two. */
  const coveredModules = new Set(
    Object.keys(schemas).map((k) => k.split("/")[0]),
  )

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} JSON schema carries no Anthropic-unsupported keywords`, () => {
      // Assert the SHAPE first. `findForbiddenKeywords(undefined)` returns [],
      // so a map entry pointing at a renamed or missing `_internal` field would
      // otherwise pass this test AND the coverage test below while checking
      // absolutely nothing — a guard that reports success on zero coverage is
      // worse than no guard.
      expect(schema, `${name}: _internal entry resolved to nothing`).toMatchObject(
        { name: expect.any(String), schema: { type: "object" } },
      )
      expect(findForbiddenKeywords(schema)).toEqual([])
    })
  }

  /**
   * Coverage guard: a NEW agent must not be able to ship a structured-output
   * schema without landing in the map above. The original failure here was not a
   * bad schema — it was a schema nobody was checking. Scanning the directory
   * makes that impossible to repeat silently.
   */
  it("covers every module in this directory that declares a JSON schema", async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    // `llm.ts` is the transport: it DECLARES the `jsonSchema` parameter and
    // forwards whatever it is handed. It owns no schema of its own, so it is
    // exempt by identity rather than by pattern.
    const TRANSPORT = new Set(["llm"])
    const files = (await readdir(dir)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )
    const declaring: string[] = []
    for (const f of files) {
      const src = await readFile(path.join(dir, f), "utf8")
      // Detect the CALL SITE (`jsonSchema:` passed to llm.complete), not the
      // declaration. The first version matched `/^const \w*JSON_SCHEMA\s*=/m`,
      // which any of these would have slipped past: `export const`, a leading
      // indent, `let`/`var`, a type annotation (`const S: T = {}` breaks `\s*=`),
      // a differently-named const, an inline literal, or a schema built by a
      // helper. The call site is what actually reaches the provider, so it is the
      // honest thing to key on.
      const mod = f.slice(0, -3)
      if (TRANSPORT.has(mod)) continue
      if (/\bjsonSchema\s*:/.test(src)) declaring.push(mod)
    }
    const uncovered = declaring.filter((m) => !coveredModules.has(m)).sort()
    expect(
      uncovered,
      `These modules declare a structured-output JSON schema but are not asserted ` +
        `against the Anthropic keyword blocklist. Export it via ` +
        `\`export const _internal = { JSON_SCHEMA }\` and add it to the map in this test.`,
    ).toEqual([])
  })
})
