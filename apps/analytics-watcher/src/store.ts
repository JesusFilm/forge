import { mkdir, open, readFile, rename } from "node:fs/promises"
import { dirname } from "node:path"
import { WatcherError } from "./config.js"
import { StateSchema, emptyState, type State } from "./state.js"

export async function loadState(path: string, scope: string): Promise<State> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return emptyState(scope)
    throw new WatcherError(
      "Cannot read watcher state; refusing to reset incident history.",
    )
  }
  try {
    const state = StateSchema.parse(JSON.parse(raw))
    if (state.scope !== scope)
      throw new WatcherError(
        "Monitoring scope changed; archive the old state before starting the new scope.",
      )
    return state
  } catch (error) {
    if (error instanceof WatcherError) throw error
    throw new WatcherError(
      "Invalid watcher state; refusing to reset incident history.",
    )
  }
}
export async function saveState(path: string, state: State): Promise<void> {
  StateSchema.parse(state)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const file = await open(`${path}.tmp`, "w", 0o600)
  try {
    await file.writeFile(JSON.stringify(state))
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(`${path}.tmp`, path)
  const directory = await open(dirname(path), "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}
