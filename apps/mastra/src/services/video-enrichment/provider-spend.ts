import { AsyncLocalStorage } from "node:async_hooks"

export class EnrichmentSettledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EnrichmentSettledError"
  }
}
const spending = new AsyncLocalStorage<{ ambiguous: boolean }>()
export class EnrichmentSpendAmbiguousError extends Error {
  constructor() {
    super(
      "Provider outcome is ambiguous; reconcile the consumed stage before recovery",
    )
    this.name = "EnrichmentSpendAmbiguousError"
  }
}
export function markEnrichmentSpendAmbiguous(): void {
  const state = spending.getStore()
  if (state) state.ambiguous = true
}
/** Stage-local context also catches failures swallowed by advisory leaf services. */
export async function trackEnrichmentSpend<T>(
  work: () => Promise<T>,
): Promise<T> {
  const state = { ambiguous: false }
  return spending.run(state, async () => {
    let result: T
    try {
      result = await work()
    } catch (error) {
      if (state.ambiguous) throw new EnrichmentSpendAmbiguousError()
      throw error
    }
    if (state.ambiguous) throw new EnrichmentSpendAmbiguousError()
    return result
  })
}
/** An ambiguous request prevents subsequent requests within this stage. */
export async function enrichmentProviderFetch(
  fetchImpl: typeof fetch,
  ...args: Parameters<typeof fetch>
): Promise<Response> {
  if (spending.getStore()?.ambiguous) throw new EnrichmentSpendAmbiguousError()
  try {
    return await fetchImpl(...args)
  } catch (error) {
    markEnrichmentSpendAmbiguous()
    throw error
  }
}
