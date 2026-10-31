import * as actual from "../../../src/i18n/client-messages.ts"
import { run, state } from "../control.ts"

export * from "../../../src/i18n/client-messages.ts"

// Real loader (bundled JSON catalogs) behind a controllable delay/failure.
export async function loadClientMessages(
  ...args: Parameters<typeof actual.loadClientMessages>
) {
  const { scenario } = state.getStore()!
  await run("client-messages", scenario.clientMessages)
  return actual.loadClientMessages(...args)
}
