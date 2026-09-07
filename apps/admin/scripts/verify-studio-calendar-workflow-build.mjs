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
const module = "src/workflows/studioCalendar.ts"
for (const [kind, name, source] of [
  ["workflow", "runStudioCalendarScheduler", flow],
  ["step", "stepStudioCalendarTick", step],
  ["workflow", "runStudioCalendarPublicationScheduler", flow],
  ["step", "stepStudioCalendarPublicationTick", step],
]) {
  const id = manifest[`${kind}s`]?.[module]?.[name]?.[`${kind}Id`]
  if (typeof id !== "string" || !source.includes(id)) {
    throw new Error(
      `Studio calendar ${kind} ${name} is missing from the generated runtime`,
    )
  }
}
console.log("Verified Studio calendar workflow and tick registrations")
