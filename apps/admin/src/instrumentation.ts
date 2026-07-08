import { env } from "@/config/env"

const TRANSIENT_WORKFLOW_STARTUP_PATTERNS = [
  /too many clients already/i,
  /remaining connection slots are reserved/i,
  /connection limit exceeded/i,
] as const

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function isTransientWorkflowStartupError(error: unknown): boolean {
  const code =
    typeof error === "object" && error != null && "code" in error
      ? String(error.code)
      : undefined
  return (
    code === "53300" ||
    TRANSIENT_WORKFLOW_STARTUP_PATTERNS.some((pattern) =>
      pattern.test(errorText(error)),
    )
  )
}

export function shouldStartWorkflowWorld(): boolean {
  return (
    process.env.NEXT_RUNTIME === "nodejs" &&
    env.WORKFLOW_RUNNER_ENABLED === "true" &&
    env.WORKFLOW_TARGET_WORLD === "@workflow/world-postgres"
  )
}

type WorkflowStartupModule = typeof import("./instrumentation-workflow")

async function importWorkflowStartupModule(): Promise<WorkflowStartupModule> {
  if (process.env.NODE_ENV === "test") {
    return import("./instrumentation-workflow")
  }

  const runtimeImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<WorkflowStartupModule>
  return runtimeImport("./instrumentation-workflow")
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { configureDatadog } = await import("@/observability/datadog")
    configureDatadog()
  }

  if (!shouldStartWorkflowWorld()) return

  const { startWorkflowWorldWithTransientRetry } =
    await importWorkflowStartupModule()
  await startWorkflowWorldWithTransientRetry()
}
