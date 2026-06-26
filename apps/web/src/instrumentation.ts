export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { configureDatadog } = await import("@/observability/datadog")
  configureDatadog()
}
