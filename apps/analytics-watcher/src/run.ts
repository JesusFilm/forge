import type { Config } from "./config.js"
import { scopeFor, WatcherError } from "./config.js"
import { probeBrowser } from "./browser.js"
import { checkDatadog, checkGa } from "./checks.js"
import { recordObservation } from "./state.js"
import { loadState, saveState } from "./store.js"
import { flushOutbox, postNotification } from "./slack.js"

export async function run(config: Config): Promise<void> {
  const state = await loadState(config.STATE_PATH, scopeFor(config))
  const persist = () => saveState(config.STATE_PATH, state)
  const send = (item: Parameters<typeof postNotification>[1]) =>
    postNotification(config, item)
  // Drain prior delivery failures first so a full backlog can recover as soon
  // as Slack is reachable, even when another incident transition is due.
  await flushOutbox(state, send, persist)
  const now = Date.now()
  const [browser, datadog, ga] = await Promise.all([
    probeBrowser(config),
    checkDatadog(config, now),
    checkGa(config, state, now),
  ])
  for (const [check, observation] of Object.entries({
    "ga-browser": browser,
    "datadog-intake": datadog,
    "ga-intake": ga,
  })) {
    recordObservation(state, check, observation, now)
    console.log(
      JSON.stringify({
        check,
        status: observation.status,
        detail: observation.detail,
      }),
    )
  }
  await persist()
  await flushOutbox(state, send, persist)
  // A heartbeat means the cycle and required notifications completed, even if
  // analytics is unhealthy. A third-party service detects this process dying.
  try {
    const response = await fetch(config.HEARTBEAT_URL, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    })
    await response.body?.cancel()
    if (!response.ok) throw new WatcherError("Heartbeat was not accepted.")
  } catch {
    throw new WatcherError("External heartbeat delivery failed.")
  }
}
