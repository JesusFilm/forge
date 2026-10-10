// Synthetic fault control: every dependency of the route that could fail is
// replaced by a stub that consults this module. No real service is contacted.
import { AsyncLocalStorage } from "node:async_hooks"

type Step = { reject: boolean; delayMs: number }
export type Scenario = { translator: Step; clientMessages: Step }

const step = (reject: boolean, delayMs: number): Step => ({ reject, delayMs })

export const scenarios = {
  // Both inputs succeed; the order of start/end events proves they overlap.
  success: { translator: step(false, 30), clientMessages: step(false, 30) },
  // Message load rejects; the translator rejects later, after the page threw.
  "client-rejects-then-translator-rejects": {
    translator: step(true, 80),
    clientMessages: step(true, 10),
  },
  // Translator rejects while the page is still awaiting the message load.
  "translator-rejects-during-client-hold": {
    translator: step(true, 10),
    clientMessages: step(false, 80),
  },
  // Both reject, translator first: the message-load error must still win.
  "both-reject-translator-first": {
    translator: step(true, 10),
    clientMessages: step(true, 60),
  },
} satisfies Record<string, Scenario>

export const state = new AsyncLocalStorage<{
  scenario: Scenario
  calls: string[]
}>()

// Records `<source>:start` synchronously on entry and `<source>:end` when the
// input settles, so concurrency is asserted from event order, not wall time.
export async function run(
  source: "translator" | "client-messages",
  step: Step,
) {
  const { calls } = state.getStore()!
  calls.push(`${source}:start`)
  try {
    await new Promise((resolve) => setTimeout(resolve, step.delayMs))
    if (step.reject) throw new Error(`synthetic ${source} failure`)
  } finally {
    calls.push(`${source}:end`)
  }
}
