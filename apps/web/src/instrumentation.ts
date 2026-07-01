export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  try {
    const { configureDatadog } = await import("@/observability/datadog")
    configureDatadog()
  } catch (error) {
    if (process.env.NODE_ENV === "production") return
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[datadog] failed to configure observability: ${message}`)
  }
}
