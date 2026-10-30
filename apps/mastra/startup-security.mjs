import { attestRuntime, RuntimeSecurityError } from "./runtime-security.mjs"

// Attest this serving Node process before application imports run.
// Do not force the preload into later application child processes.
const preload = "--import=/app/apps/mastra/startup-security.mjs"
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS ?? "")
  .replace(preload, "")
  .trim()
try {
  console.log(JSON.stringify(await attestRuntime()))
} catch (error) {
  console.error(
    JSON.stringify({
      event: "mastra_runtime_security",
      schema: 1,
      status: "fail",
      code:
        error instanceof RuntimeSecurityError
          ? error.code
          : "inspection_failed",
    }),
  )
  process.exit(1)
}
