// `node --import tsx --import ./hooks.mjs child.tsx <scenario> [route-module]`
// Runs the REAL catch-all route in a plain Node process (no Vitest, so Node's
// own `unhandledRejection` is observable) and prints one JSON report.
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { renderToStaticMarkup } from "react-dom/server"
import { scenarios, state, type Scenario } from "./control.ts"

const name = process.argv[2] as keyof typeof scenarios
const routeModule =
  process.argv[3] ??
  join(__dirname, "../../src/app/[locale]/[htmlLang]/[...rest]/page.tsx")

async function main() {
  const route = await import(routeModule)
  const unhandled: string[] = []
  process.on("unhandledRejection", (reason) =>
    unhandled.push((reason as Error).message),
  )
  const calls: string[] = []
  const started = performance.now()
  const report: Record<string, unknown> = { scenario: name, calls, unhandled }
  try {
    const scenario: Scenario = scenarios[name]
    const element = await state.run({ scenario, calls }, () =>
      route.default({
        params: Promise.resolve({
          locale: "en",
          htmlLang: "en",
          rest: ["storyclubs.html", "english.html"],
        }),
      }),
    )
    report.elapsedMs = Math.round(performance.now() - started)
    report.markup = renderToStaticMarkup(element)
  } catch (error) {
    report.elapsedMs = Math.round(performance.now() - started)
    report.error = (error as Error).message
  }
  // Settle window longer than the slowest synthetic timer, so a late orphaned
  // rejection is reported before we print.
  await new Promise((resolve) => setTimeout(resolve, 200))
  process.stdout.write(`${JSON.stringify(report)}\n`)
  process.exit(0)
}
void main()
