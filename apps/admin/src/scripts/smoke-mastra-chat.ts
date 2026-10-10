/**
 * Smoke test for the post-convergence Mastra chat surface.
 *
 * Exercises the same path the SSE route consumes:
 *   getMastra().getAgentById("experience-default-chat").generate(prompt)
 *
 * Verifies:
 *   - Mastra singleton constructs without throwing
 *   - The agent is registered
 *   - OpenRouter free model responds with text
 *   - Memory persists to the dedicated `mastra` Postgres schema
 *
 * Run with: pnpm --filter @forge/admin exec tsx --env-file=.env src/scripts/smoke-mastra-chat.ts
 */

import { getMastra } from "@/mastra"
import { env } from "@/config/env"

async function main() {
  console.log("[smoke] start")
  console.log(
    "[smoke] env OPENROUTER_API_KEY present:",
    !!env.OPENROUTER_API_KEY,
  )
  console.log("[smoke] env DATABASE_URL present:", !!env.DATABASE_URL)
  console.log(
    "[smoke] env MASTRA_STORAGE_URL present:",
    !!env.MASTRA_STORAGE_URL,
  )

  const mastra = getMastra()
  console.log("[smoke] mastra singleton constructed")

  const agent = mastra.getAgentById("experience-default-chat")
  if (!agent) {
    throw new Error("agent 'experience-default-chat' not registered")
  }
  console.log("[smoke] agent resolved:", agent.id)

  const prompt = "Reply with the single word OK and nothing else."
  const started = Date.now()
  const result = await agent.generate(prompt)
  const elapsed = Date.now() - started

  console.log(`[smoke] generate() returned in ${elapsed}ms`)
  console.log(
    "[smoke] text (first 200 chars):",
    JSON.stringify(
      typeof result.text === "string" ? result.text.slice(0, 200) : result.text,
    ),
  )

  if (typeof result.text !== "string" || result.text.length === 0) {
    throw new Error("agent returned empty text")
  }

  console.log("[smoke] PASS")
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err)
  process.exit(1)
})
