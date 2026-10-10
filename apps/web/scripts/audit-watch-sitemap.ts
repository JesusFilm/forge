#!/usr/bin/env tsx

import { writeFileSync } from "node:fs"

import {
  inspectWatchSitemapIndex,
  WatchSitemapAuditSession,
  type WatchSitemapAuditDocument,
  type WatchSitemapAuditReport,
} from "../src/lib/watch-sitemap-audit"

type Args = {
  jsonOut?: string
  origin: string
}

function parseArgs(argv: readonly string[]): Args | Error {
  let jsonOut: string | undefined
  let origin: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === "--origin" && value) {
      origin = value
      index += 1
    } else if (flag === "--json" && value) {
      jsonOut = value
      index += 1
    }
  }

  if (!origin) {
    return new Error(
      "Usage: audit:watch-sitemap --origin <origin> [--json <path>]",
    )
  }

  try {
    return {
      ...(jsonOut ? { jsonOut } : {}),
      origin: new URL(origin).origin,
    }
  } catch {
    return new Error(`Invalid origin: ${origin}`)
  }
}

async function fetchDocument(
  url: string,
  referenceUrl?: string,
): Promise<WatchSitemapAuditDocument> {
  const response = await fetch(url, {
    headers: { Accept: "application/xml, text/xml;q=0.9" },
    redirect: "manual",
  })
  return {
    body: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type"),
    redirected: response.redirected,
    ...(referenceUrl ? { referenceUrl } : {}),
    status: response.status,
    url,
  }
}

function candidateChildUrl(origin: string, referenceUrl: string): string {
  return new URL(new URL(referenceUrl).pathname, origin).toString()
}

function printReport(report: WatchSitemapAuditReport): void {
  console.log(
    `Index: ${report.index.status} · ${report.index.bytes} bytes · ${report.index.childCount} children`,
  )
  console.log("")
  console.log("| ID | Status | Bytes | loc | hreflang | XML |")
  console.log("| ---: | ---: | ---: | ---: | ---: | :---: |")
  for (const child of report.children) {
    console.log(
      `| ${child.id ?? "?"} | ${child.status} | ${child.bytes} | ${child.locCount} | ${child.hreflangCount} | ${child.validXml ? "yes" : "no"} |`,
    )
  }
  console.log("")
  console.log(
    `Totals: ${report.totals.children} children · ${report.totals.bytes} bytes · ${report.totals.locs} loc · ${report.totals.hreflang} hreflang`,
  )

  if (report.issues.length) {
    console.error("")
    console.error(`Audit failed with ${report.issues.length} issue(s):`)
    for (const issue of report.issues) {
      console.error(
        `- ${issue.code}: ${issue.message}${issue.url ? ` (${issue.url})` : ""}`,
      )
    }
  } else {
    console.log("Audit passed.")
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args instanceof Error) {
    console.error(args.message)
    process.exitCode = 2
    return
  }

  const indexUrl = new URL("/watch/sitemap.xml", args.origin).toString()
  console.log(`Auditing ${indexUrl}`)
  const indexDocument = await fetchDocument(indexUrl)
  const inspectedIndex = inspectWatchSitemapIndex(indexDocument)
  const session = new WatchSitemapAuditSession(indexDocument)

  for (const [index, referenceUrl] of inspectedIndex.childUrls.entries()) {
    const childUrl = candidateChildUrl(args.origin, referenceUrl)
    session.addChild(await fetchDocument(childUrl, referenceUrl))
    console.log(
      `Fetched child ${index + 1}/${inspectedIndex.childUrls.length}: ${childUrl}`,
    )
  }

  const report = session.finish()
  printReport(report)

  if (args.jsonOut) {
    writeFileSync(args.jsonOut, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`JSON report written to ${args.jsonOut}`)
  }
  if (!report.ok) process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(
    `Audit failed before completion: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})
