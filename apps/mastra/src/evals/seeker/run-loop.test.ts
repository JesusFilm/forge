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
