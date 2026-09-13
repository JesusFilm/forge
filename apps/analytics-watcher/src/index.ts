import {
  readBrowserConfig,
  readConfig,
  readSlackConfig,
  WatcherError,
} from "./config.js"
import { probeBrowser } from "./browser.js"
import { run } from "./run.js"
import { postSlackTest } from "./slack.js"

try {
  if (process.argv.includes("--test-slack")) {
    await postSlackTest(readSlackConfig(process.env))
    console.log(
      "Slack acknowledged the clearly labelled installation test in the configured channel.",
    )
  } else if (process.argv.includes("--probe-only")) {
    const result = await probeBrowser(readBrowserConfig(process.env))
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.status === "good" ? 0 : 1
  } else {
    await run(readConfig(process.env))
  }
} catch (error) {
  // Never dump SDK errors: they may contain authorization headers or secrets.
  console.error(
    error instanceof WatcherError
      ? error.message
      : "Watcher failed; inspect configuration, persistent storage and service availability.",
  )
  process.exitCode = 1
}
