const { setTimeout } = globalThis
import { StudioContainmentError } from "./budget.mjs"

/** PID1 exit is the final container boundary when task cleanup is uncertain.
 * A process manager that keeps this namespace alive would invalidate this rule. */
export function installExecutionLifecycle({ server, stop }) {
  if (process.pid !== 1)
    throw new StudioContainmentError("Execution service must be container PID1")
  let stopping = false
  const retire = () => process.exit(78)
  server.on("isolationLost", retire)
  process.on("uncaughtException", retire)
  process.on("unhandledRejection", retire)
  const shutdown = () => {
    if (stopping) return
    stopping = true
    // Independent native job deadlines still run if Node's event loop stalls.
    // This deadline bounds normal graceful shutdown; exit retires all namespace
    // descendants even if a child ignored cancellation or detached its session.
    setTimeout(retire, 2000)
    stop()
    server.close(() => process.exit(0))
    server.closeIdleConnections()
  }
  process.once("SIGTERM", shutdown)
  process.once("SIGINT", shutdown)
}
