export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  try {
    const { registerInitialCache } =
      await import("@fortedigital/nextjs-cache-handler/instrumentation")
    const cacheHandlerPath = "../cache-handler.mjs"
    const { default: CacheHandler } = await import(cacheHandlerPath)
    await registerInitialCache(CacheHandler, { setOnlyIfNotExists: true })
  } catch (error) {
    if (process.env.NODE_ENV === "production") return
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[next-cache] failed to register initial cache: ${message}`)
  }

  try {
    const { configureDatadog } = await import("@/observability/datadog")
    configureDatadog()
  } catch (error) {
    if (process.env.NODE_ENV === "production") return
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[datadog] failed to configure observability: ${message}`)
  }

  try {
    const { startMemoryDiagnostics } =
      await import("@/observability/memory-diagnostics")
    startMemoryDiagnostics()
  } catch (error) {
    if (process.env.NODE_ENV === "production") return
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[memory-diagnostics] failed to configure diagnostics: ${message}`,
    )
  }
}
