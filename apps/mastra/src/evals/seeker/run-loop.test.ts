import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { pinEvalKey } from "./run-loop"

/**
 * The key-hygiene MECHANISM (decision doc PR C step 2): Mastra's model
 * router reads `OPENROUTER_API_KEY` from ambient env, so the loop runner
 * must (a) fail before spending when the eval key is absent, (b) refuse to
 * run at all when a production credential is present, and (c) overwrite the
 * ambient router key with the eval key. Each case below breaks if its arm of
 * the mechanism is deleted — including the anti-vacuous overwrite check.
 */
describe("pinEvalKey", () => {
  it("fails before any spend when the eval key is absent", () => {
    const env: Record<string, string | undefined> = {}
    expect(() => pinEvalKey(env)).toThrow(/CHAT_EVAL_OPENROUTER_API_KEY/)
    expect(env.OPENROUTER_API_KEY).toBeUndefined()
  })

  it("refuses to run when OPENROUTER_API_PAID_KEY is set — even with the eval key present", () => {
    const env: Record<string, string | undefined> = {
      CHAT_EVAL_OPENROUTER_API_KEY: "sk-or-v1-eval",
      OPENROUTER_API_PAID_KEY: "sk-or-v1-production",
    }
    expect(() => pinEvalKey(env)).toThrow(/OPENROUTER_API_PAID_KEY/)
    // Refusal must leave the router key untouched.
    expect(env.OPENROUTER_API_KEY).toBeUndefined()
  })

  it("overwrites an ambient OPENROUTER_API_KEY with the eval key (the pin)", () => {
    const env: Record<string, string | undefined> = {
      CHAT_EVAL_OPENROUTER_API_KEY: "sk-or-v1-eval",
      OPENROUTER_API_KEY: "sk-or-v1-ambient-dev-key",
    }
    const { key } = pinEvalKey(env)
    expect(key).toBe("sk-or-v1-eval")
    // Anti-vacuous: the ambient value is GONE, not merely shadowed — this is
    // what keeps Mastra's router from billing whatever .env.local held.
    expect(env.OPENROUTER_API_KEY).toBe("sk-or-v1-eval")
  })

  it("treats a whitespace-only eval key as absent", () => {
    const env: Record<string, string | undefined> = {
      CHAT_EVAL_OPENROUTER_API_KEY: "   ",
    }
    expect(() => pinEvalKey(env)).toThrow(/CHAT_EVAL_OPENROUTER_API_KEY/)
  })
})

/**
 * Import-order source pin (finding #13; the retrieve-answer.test.ts
 * stripped-source technique applied to import ORDER). The pin-before-import
 * ordering only holds if NOTHING in run-loop's static import block
 * transitively evaluates the agent module: ./prompt-sections value-imports
 * SEEKER_SYSTEM_PROMPT_FALLBACK from seeker-agent, whose top level runs
 * `buildSeekerAgent()` — the whole Mastra model-router chain — before
 * pinEvalKey() could fire. Every other static import was audited: env,
 * hashes, models, openrouter, questions, rag, types reach only node
 * builtins/zod (questions and fixture-rag touch agent-adjacent modules via
 * `import type` only, which erases). A future static import that re-defeats
 * the ordering fails here. Type-only imports of the forbidden modules would
 * be erased at runtime, but the pin rejects them too — cheap insurance
 * against a later flip to a value import.
 */
describe("spend-guard import order (source pin)", () => {
  function strippedRunLoopSource(): string {
    // Comments stripped first so a commented-out import can neither satisfy
    // nor spoil the pin.
    const source = readFileSync(
      new URL("./run-loop.ts", import.meta.url),
      "utf8",
    )
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  }

  it("keeps agent-reaching modules OUT of run-loop's static import block", () => {
    const code = strippedRunLoopSource()
    const staticImports = code.match(/^import[\s\S]*?from\s+"[^"]+"/gm) ?? []
    // Anti-vacuous: the scan must actually be seeing the import block.
    expect(staticImports.length).toBeGreaterThan(5)
    for (const statement of staticImports) {
      expect(statement).not.toMatch(/prompt-sections|mastra\/agents/)
    }
  })

  it("loads prompt-sections and the agent module ONLY via post-pin dynamic import()", () => {
    const code = strippedRunLoopSource()
    // Both modules are still consumed — through import(), inside main(),
    // after pinEvalKey(). If either disappears entirely the identity stamp
    // is broken, so pin their dynamic presence too.
    expect(code).toMatch(/import\("\.\/prompt-sections"\)/)
    expect(code).toMatch(/import\("\.\.\/\.\.\/mastra\/agents\/seeker-agent"\)/)
    // And the pin runs before the dynamic batch in program order.
    expect(code.indexOf("pinEvalKey(process.env)")).toBeLessThan(
      code.indexOf('import("../../mastra/agents/seeker-agent")'),
    )
  })
})
