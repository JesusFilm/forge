// The push campaign run has to reach the generated workflow manifest and both
// executable routes, or a scheduled campaign fails on its first step in
// production while every local test stays green. Sibling of
// verify-recommendation-workflow-build.mjs.
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const workflowModule = "src/workflows/pushCampaign.ts"
const workflowRoute = new URL(
  "../src/app/.well-known/workflow/v1/flow/route.js",
  import.meta.url,
)
const stepRoute = new URL(
  "../src/app/.well-known/workflow/v1/step/route.js",
  import.meta.url,
)
const manifestPath = new URL(
  "../src/app/.well-known/workflow/v1/manifest.json",
  import.meta.url,
)

const requiredWorkflows = ["runPushCampaign"]
const requiredSteps = [
  "stepFailPushCampaignRun",
  "stepFinishPushCampaignRun",
  "stepNextPushZoneGroup",
  "stepReconcilePushCampaignReceipts",
  "stepRunPushCampaignBatch",
  "stepStartPushCampaignRun",
]

async function readGeneratedFile(path) {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    const displayPath = fileURLToPath(path)
    throw new Error(`Workflow build did not generate ${displayPath}`, {
      cause: error,
    })
  }
}

function assertRegistration({ entries, kind, name, routeSource }) {
  const registration = entries?.[name]
  const id = registration?.[`${kind}Id`]

  if (typeof id !== "string" || !routeSource.includes(id)) {
    throw new Error(
      `Push campaign ${kind} ${name} is missing from the generated manifest or executable route`,
    )
  }
}

const [manifestSource, workflowRouteSource, stepRouteSource] =
  await Promise.all([
    readGeneratedFile(manifestPath),
    readGeneratedFile(workflowRoute),
    readGeneratedFile(stepRoute),
  ])
const manifest = JSON.parse(manifestSource)

for (const name of requiredWorkflows) {
  assertRegistration({
    entries: manifest.workflows?.[workflowModule],
    kind: "workflow",
    name,
    routeSource: workflowRouteSource,
  })
}

for (const name of requiredSteps) {
  assertRegistration({
    entries: manifest.steps?.[workflowModule],
    kind: "step",
    name,
    routeSource: stepRouteSource,
  })
}

console.log(
  `Verified ${requiredWorkflows.length} push campaign workflow and ${requiredSteps.length} steps`,
)
