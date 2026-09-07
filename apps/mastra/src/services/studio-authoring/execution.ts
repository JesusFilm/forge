type LockPool = {
  connect(): Promise<{
    query(sql: string): Promise<unknown>
    release(destroy?: boolean): void
  }>
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
