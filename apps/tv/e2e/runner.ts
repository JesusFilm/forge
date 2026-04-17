import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { parse as parseYaml } from "yaml"
import { TvOSAdapter } from "./adapters/tvos"
import { AndroidTvAdapter } from "./adapters/androidtv"
import type {
  TVAdapter,
  FlowDefinition,
  FlowStep,
  FlowResult,
  StepResult,
} from "./types"

const DEFAULT_DELAY = 200 // ms between D-pad steps

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createAdapter(platform: "tvos" | "androidtv"): TVAdapter {
  return platform === "tvos" ? new TvOSAdapter() : new AndroidTvAdapter()
}

export function parseFlowFile(filePath: string): FlowDefinition {
  const content = readFileSync(filePath, "utf-8")
  const parsed = parseYaml(content) as FlowDefinition
  if (!parsed.name || !parsed.platform || !parsed.steps) {
    throw new Error(
      `Invalid flow file ${filePath}: missing name, platform, or steps`,
    )
  }
  return parsed
}

export function discoverFlows(flowsDir: string): string[] {
  try {
    return readdirSync(flowsDir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => join(flowsDir, f))
      .sort()
  } catch {
    return []
  }
}

export async function executeStep(
  adapter: TVAdapter,
  step: FlowStep,
  screenshotBaseDir: string,
  flowName: string,
): Promise<StepResult> {
  try {
    if ("dpad" in step) {
      await adapter.sendDpad(step.dpad)
      return { step, success: true }
    }
    if ("wait" in step) {
      await sleep(step.wait)
      return { step, success: true }
    }
    if ("delay" in step) {
      await sleep(step.delay)
      return { step, success: true }
    }
    if ("screenshot" in step) {
      const path = join(
        screenshotBaseDir,
        adapter.platform,
        flowName,
        `${step.screenshot}.png`,
      )
      await adapter.captureScreenshot(path)
      return { step, success: true, screenshotPath: path }
    }
    if ("launch" in step) {
      await adapter.launchApp(step.launch)
      return { step, success: true }
    }
    // Unknown step — warn and skip
    console.warn(`  [warn] Unknown step type: ${JSON.stringify(step)}`)
    return { step, success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { step, success: false, error: message }
  }
}

export async function runFlow(
  flow: FlowDefinition,
  adapter: TVAdapter,
  screenshotBaseDir: string,
): Promise<FlowResult> {
  const start = Date.now()
  const stepResults: StepResult[] = []

  console.log(`  Running: ${flow.name} on ${adapter.platform}`)

  for (const step of flow.steps) {
    const result = await executeStep(
      adapter,
      step,
      screenshotBaseDir,
      flow.name.replace(/\s+/g, "-").toLowerCase(),
    )
    stepResults.push(result)

    if (!result.success) {
      console.error(`    [FAIL] ${JSON.stringify(step)}: ${result.error}`)
    }

    // Default delay between D-pad steps
    if ("dpad" in step) {
      await sleep(DEFAULT_DELAY)
    }
  }

  const duration = Date.now() - start
  const success = stepResults.every((r) => r.success)

  console.log(
    `  ${success ? "PASS" : "FAIL"}: ${flow.name} (${duration}ms, ${stepResults.length} steps)`,
  )

  return {
    name: flow.name,
    platform: adapter.platform,
    steps: stepResults,
    success,
    duration,
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      platform: { type: "string", short: "p" },
      flows: { type: "string", short: "f", default: "e2e/flows" },
      screenshots: {
        type: "string",
        short: "s",
        default: "e2e/screenshots",
      },
    },
  })

  const platform = values.platform as "tvos" | "androidtv" | undefined
  if (!platform || !["tvos", "androidtv"].includes(platform)) {
    console.error("Usage: tsx e2e/runner.ts --platform <tvos|androidtv>")
    process.exit(1)
  }

  const flowsDir = resolve(values.flows!)
  const screenshotDir = resolve(values.screenshots!)

  console.log(`\nTV E2E Runner — ${platform}`)
  console.log(`Flows: ${flowsDir}`)
  console.log(`Screenshots: ${screenshotDir}\n`)

  const adapter = createAdapter(platform)

  // Check adapter availability
  try {
    await adapter.checkAvailability()
  } catch (err) {
    console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  // Discover and run flows
  const flowFiles = discoverFlows(flowsDir)
  if (flowFiles.length === 0) {
    console.log("No flow files found.")
    process.exit(0)
  }

  console.log(`Found ${flowFiles.length} flow(s)\n`)

  const results: FlowResult[] = []
  for (const file of flowFiles) {
    const flow = parseFlowFile(file)

    // Skip flows not targeting this platform
    if (!flow.platform.includes(platform)) {
      console.log(`  Skipped: ${flow.name} (not targeting ${platform})`)
      continue
    }

    const result = await runFlow(flow, adapter, screenshotDir)
    results.push(result)
  }

  // Summary
  const passed = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)

  console.log(`\n--- Summary ---`)
  console.log(`Platform: ${platform}`)
  console.log(
    `Results: ${passed} passed, ${failed} failed, ${results.length} total`,
  )
  console.log(`Duration: ${(totalDuration / 1000).toFixed(1)}s`)

  if (failed > 0) {
    console.log(`\nFailed flows:`)
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  - ${r.name}`)
      for (const s of r.steps.filter((s) => !s.success)) {
        console.log(`    ${JSON.stringify(s.step)}: ${s.error}`)
      }
    }
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
