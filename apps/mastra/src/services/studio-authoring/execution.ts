import type { Pool } from "pg"
import type { StudioSettlement } from "./run-budget"
import { StudioRunDeadlineError } from "./run-budget"

type LockPool = {
  connect(): Promise<{
    query(sql: string): Promise<unknown>
    release(destroy?: boolean): void
  }>
}

/** Deadline-bound terminal write. A timeout destroys its connection, never retries. */
export async function finishStudioExecution(
  pool: Pick<Pool, "connect">,
  id: string,
  status: "completed" | "failed",
  context: StudioSettlement,
) {
  const expires = performance.now() + context.timeoutMs
  const signal = AbortSignal.any([
    context.signal,
    AbortSignal.timeout(context.timeoutMs),
  ])
  signal.throwIfAborted()
  const connection = await pool.connect()
  let released = false
  const release = (destroy: boolean) => {
    if (!released) {
      released = true
      connection.release(destroy)
    }
  }
  const cancelled = () => release(true)
  const remaining = () => {
    signal.throwIfAborted()
    const ms = Math.floor(expires - performance.now())
    if (ms <= 0) throw new StudioRunDeadlineError("persistence")
    return ms
  }
  const query = (text: string, values?: string[]) => {
    remaining()
    return connection.query({ text, values })
  }
  signal.addEventListener("abort", cancelled, { once: true })
  try {
    await query("BEGIN")
    await query(
      "SELECT set_config('statement_timeout',$1,true), set_config('lock_timeout',$1,true)",
      [`${remaining()}ms`],
    )
    await query("UPDATE short_agent_execution SET status=$2 WHERE id=$1", [
      id,
      status,
    ])
    await query("COMMIT")
    release(false)
  } finally {
    signal.removeEventListener("abort", cancelled)
    release(true)
  }
}
/** Every replica serializes native instruction transitions on the same Postgres lock. */
export async function serializeStudioInstructions<T>(
  pool: LockPool,
  work: () => Promise<T>,
): Promise<T> {
  const connection = await pool.connect()
  const release = async () => {
    try {
      await connection.query("SELECT pg_advisory_unlock(457)")
    } catch (error) {
      connection.release(true)
      throw error
    }
    connection.release()
  }
  try {
    await connection.query("SELECT pg_advisory_lock(457)")
    return await work()
  } finally {
    await release()
  }
}
