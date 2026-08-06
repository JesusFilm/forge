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
 * transitively evaluates the agent module, whose top level runs
 * `buildSeekerAgent()` — the whole Mastra model-router chain — before
 * pinEvalKey() could fire. The static import block was audited: env, cli,
 * hashes, models, questions, rag, types reach only node builtins/zod;
 * budgets is a zero-import constants module; the prompt constants and
 * prompt-sections come from the dependency-FREE `seeker-prompt` leaf (its
 * import-freeness is pinned below, so the static prompt path can never grow
 * back into the agent chain). A future static import that re-defeats the
 * ordering fails here. Type-only imports of the forbidden module would be
 * erased at runtime, but the pin rejects them too — cheap insurance against
 * a later flip to a value import.
 */
describe("spend-guard import order (source pin)", () => {
  function strippedSource(url: URL): string {
    // Comments stripped first so a commented-out import can neither satisfy
    // nor spoil the pin.
    const source = readFileSync(url, "utf8")
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  }
  const strippedRunLoopSource = (): string =>
    strippedSource(new URL("./run-loop.ts", import.meta.url))

  it("keeps agent-reaching modules OUT of run-loop's static import block", () => {
    const code = strippedRunLoopSource()
    const staticImports = code.match(/^import[\s\S]*?from\s+"[^"]+"/gm) ?? []
    // Anti-vacuous: the scan must actually be seeing the import block.
    expect(staticImports.length).toBeGreaterThan(5)
    for (const statement of staticImports) {
      // Everything under mastra/agents is banned EXCEPT the seeker-prompt
      // leaf, whose import-freeness the next pin holds.
      expect(statement).not.toMatch(/mastra\/agents\/(?!seeker-prompt)/)
    }
  })

  it("keeps the static prompt path a leaf — seeker-prompt imports nothing, prompt-sections reaches only node:crypto + the leaf", () => {
    // run-loop (and prompt-sections) statically import the prompt constants,
    // which is spend-guard-safe ONLY while this path stays out of the agent
    // chain. One added import in either file could re-evaluate the model
    // router before pinEvalKey().
    const leaf = strippedSource(
      new URL("../../mastra/agents/seeker-prompt.ts", import.meta.url),
    )
    expect(leaf).not.toMatch(/^\s*import\s/m)
    expect(leaf).not.toMatch(/\brequire\(/)
    // Anti-vacuous: the constants really live there.
    expect(leaf).toMatch(/export const SEEKER_SYSTEM_PROMPT_FALLBACK/)

    const sections = strippedSource(
      new URL("./prompt-sections.ts", import.meta.url),
    )
    const sectionImports =
      sections.match(/^import[\s\S]*?from\s+"[^"]+"/gm) ?? []
    expect(sectionImports.length).toBeGreaterThan(0)
    for (const statement of sectionImports) {
      expect(statement).toMatch(/"node:crypto"|mastra\/agents\/seeker-prompt/)
    }
  })

  it("keeps the gating loop decoding-UNPINNED — provider defaults, like production (decision 2026-08-04 #14)", () => {
    // A one-line re-pin (modelSettings on generate, or re-importing
    // ANSWER_DECODING) would silently move the gate back to a distribution
    // production never serves; the stripped source must contain neither
    // token.
    const code = strippedRunLoopSource()
    expect(code).not.toMatch(/modelSettings|ANSWER_DECODING/)
    // Anti-vacuous companion: the null stamp is really there.
    expect(code).toMatch(/decoding:\s*null/)
  })

  it("loads the agent module ONLY via post-pin dynamic import()", () => {
    const code = strippedRunLoopSource()
    // The agent module is still consumed — through import(), inside main(),
    // after pinEvalKey(). If it disappears entirely the run has no agent, so
    // pin its dynamic presence too.
    expect(code).toMatch(/import\("\.\.\/\.\.\/mastra\/agents\/seeker-agent"\)/)
    // And the pin runs before the dynamic batch in program order.
    expect(code.indexOf("pinEvalKey(process.env)")).toBeLessThan(
      code.indexOf('import("../../mastra/agents/seeker-agent")'),
    )
  })
})
