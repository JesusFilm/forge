import { readFile } from "node:fs/promises"

const generated = new URL(
  "../src/app/.well-known/workflow/v1/",
  import.meta.url,
)
const [manifestSource, flow, step] = await Promise.all([
  readFile(new URL("manifest.json", generated), "utf8"),
  readFile(new URL("flow/route.js", generated), "utf8"),
  readFile(new URL("step/route.js", generated), "utf8"),
])
const manifest = JSON.parse(manifestSource)
for (const [workflowModule, kind, name, source] of [
  [
    "src/workflows/studioCalendar.ts",
    "workflow",
    "runStudioCalendarScheduler",
    flow,
  ],
  ["src/workflows/studioCalendar.ts", "step", "stepStudioCalendarTick", step],
  [
    "src/workflows/studioCalendar.ts",
    "workflow",
    "runStudioCalendarPublicationScheduler",
    flow,
  ],
  [
    "src/workflows/studioCalendar.ts",
    "step",
    "stepStudioCalendarPublicationTick",
    step,
  ],
  [
    "src/workflows/managerAutomation.ts",
    "workflow",
    "runManagerAutomationScheduler",
    flow,
  ],
  [
    "src/workflows/managerAutomation.ts",
    "step",
    "stepManagerAutomationTick",
    step,
  ],
]) {
  const id = manifest[`${kind}s`]?.[workflowModule]?.[name]?.[`${kind}Id`]
  if (typeof id !== "string" || !source.includes(id)) {
    throw new Error(
      `Studio calendar ${kind} ${name} is missing from the generated runtime`,
    )
  }
}
console.log("Verified Studio calendar workflow and tick registrations")
