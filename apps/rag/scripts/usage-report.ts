import { parseArgs } from "node:util"
import {
  validateUsageWindow,
  UsageError,
  usageReportSchema,
} from "../src/contracts/consumer-usage.js"
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      consumer: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
    },
  })
  const window = {
    consumerId: values.consumer ?? "",
    from: new Date(values.from ?? ""),
    to: new Date(values.to ?? ""),
  }
  validateUsageWindow(window)
  const endpoint = process.env.RAG_USAGE_REPORT_URL,
    secret = process.env.RAG_USAGE_REPORT_SECRET
  if (!endpoint || !secret) throw new UsageError("unavailable")
  const url = new URL(endpoint)
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new UsageError("unavailable")
  if (url.username || url.password) throw new UsageError("unavailable")
  url.search = new URLSearchParams({
    consumer: window.consumerId,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
  }).toString()
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${secret}` },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  })
  if (!response.body) throw new UsageError("unavailable")
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > 8192) {
      await reader.cancel()
      throw new UsageError("unavailable")
    }
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  const report = usageReportSchema.parse(JSON.parse(text))
  if (response.status !== 200) throw new UsageError("unavailable")
  console.log(JSON.stringify(report))
}
main().catch(() => {
  console.error("usage report unavailable")
  process.exitCode = 1
})
