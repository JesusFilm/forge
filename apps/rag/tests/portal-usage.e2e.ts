import { readFile } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import { serve, type ServerType } from "@hono/node-server"
import { Hono } from "hono"
import { expect, test } from "@playwright/test"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { fixture } from "../src/serving/http/portal-fixture.test-support.js"
import { createPortal } from "../src/serving/http/portal.js"
import { PostgresConsumerAccess } from "../src/adapters/postgres/consumer-access.js"
import { PostgresUsageStore } from "../src/adapters/postgres/consumer-usage.js"
import {
  resetUsageTestDatabase,
  usageTestDatabaseUrl as url,
} from "../src/adapters/postgres/usage-fixture.test-support.js"

let server: ServerType, origin: string, db: PrismaClient
const from = "2026-09-22T05:17",
  to = "2026-09-29T05:17"
test.skip(!url, "requires an isolated localhost database")
test.beforeAll(async () => {
  await resetUsageTestDatabase()
  db = new PrismaClient({ datasourceUrl: url! })
  const consumers = new PostgresConsumerAccess(db)
  const existing = await consumers.list("42")
  for (const name of ["ragbot", "unused"]) {
    if (!existing.some((row) => row.name === name))
      await consumers.create({
        name,
        actorGithubUserId: "42",
        allowedSourceKeys: [],
      })
  }
  const ragbot = (await consumers.list("42")).find(
    (row) => row.name === "ragbot",
  )!
  const unused = (await consumers.list("42")).find(
    (row) => row.name === "unused",
  )!
  const historical = await consumers.create({
    name: "historical",
    actorGithubUserId: "42",
    allowedSourceKeys: [],
  })
  const at = new Date("2026-09-29T03:41:32Z")
  await db.$executeRaw`INSERT INTO usage_private.minutes(consumer_id, minute, request_count, successful_count, last_activity_at) VALUES(${ragbot.consumerId}::uuid, date_trunc('minute', ${at}::timestamptz, 'UTC'), 5, 5, ${at})`
  await db.$executeRaw`INSERT INTO usage_private.minutes(consumer_id, minute, request_count, successful_count, last_activity_at) VALUES(${historical.consumer.consumerId}::uuid, date_trunc('minute', ${at}::timestamptz, 'UTC'), 2, 2, ${at})`
  await consumers.transition({
    consumerId: historical.consumer.consumerId,
    actorGithubUserId: "42",
    state: "revoked",
    expectedVersion: 1,
  })
  // Only this test's two directory fixtures; other DB integration tests create
  // many unrelated consumers. Reports still use the real PostgreSQL adapter.
  const listHistory = consumers.listForUsage.bind(consumers)
  consumers.listForUsage = async () =>
    (await listHistory()).filter((row) =>
      [
        ragbot.consumerId,
        unused.consumerId,
        historical.consumer.consumerId,
      ].includes(row.consumerId),
    )
  const admission = fixture()
  admission.sessions.set("synthetic-usage-test", { id: 42, login: "engineer" })
  const app = new Hono().route(
    "/portal",
    createPortal({
      ...admission.deps,
      admission: {
        ...admission.deps.admission,
        current: async () => ({
          sha: "5".repeat(40),
          allowlist: { users: [{ id: 42, login: "engineer" }] },
        }),
      },
      consumers,
      usageReader: new PostgresUsageStore(db),
    }),
  )
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  )
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  await db?.$disconnect()
})
test("shows all recorded counts for the unchanged date range and loads usage only on demand", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    Cookie: "__Host-rag_portal=synthetic-usage-test",
  })
  const requests: string[] = [],
    errors: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(origin + "/portal")
  await expect(page.locator("#account")).toContainText("@engineer")
  expect(
    requests.some(
      (url) => url.includes("usage.js") || url.includes("/usage/reports"),
    ),
  ).toBe(false)
  await page.getByRole("button", { name: "Usage", exact: true }).click()
  await page.getByLabel("From (UTC)", { exact: true }).fill(from)
  await page.getByLabel("To (UTC, exclusive)", { exact: true }).fill(to)
  const response = page.waitForResponse(
    (response) =>
      response.url().includes("/usage/reports") &&
      new URL(response.url()).searchParams.get("from") === from + ":00.000Z" &&
      new URL(response.url()).searchParams.get("to") === to + ":00.000Z",
  )
  await page
    .getByRole("button", { name: "Update reports", exact: true })
    .click()
  const data = await (await response).json()
  expect(
    data.reports.find((row: { label: string }) => row.label === "ragbot"),
  ).toMatchObject({
    requestCount: 5,
    successfulRequestCount: 5,
    windowStart: from + ":00.000Z",
    windowEnd: to + ":00.000Z",
  })
  const ragbot = page.getByRole("row").filter({
    has: page.getByRole("button", {
      name: "View report for ragbot",
      exact: true,
    }),
  })
  await expect(ragbot.getByRole("cell")).toHaveText(["5", "5", /2026/])
  const unused = page.getByRole("row").filter({
    has: page.getByRole("button", {
      name: "View report for unused",
      exact: true,
    }),
  })
  await expect(unused.getByRole("cell")).toHaveText(["0", "0", "—"])
  const revoked = page.getByRole("row").filter({
    has: page.getByRole("button", { name: /View report for historical/ }),
  })
  await expect(revoked).toContainText("revoked")
  await expect(revoked.getByRole("cell")).toHaveText(["2", "2", /2026/])
  await expect(
    page.getByRole("columnheader", { name: "Coverage" }),
  ).toHaveCount(0)
  await expect(page.getByLabel("From (UTC)", { exact: true })).toHaveValue(from)
  await expect(
    page.getByLabel("To (UTC, exclusive)", { exact: true }),
  ).toHaveValue(to)
  await page
    .getByRole("button", { name: "View report for ragbot", exact: true })
    .click()
  await expect(page.getByRole("dialog")).toContainText("Requests5Successful5")
  await expect(page.getByRole("dialog")).not.toContainText("Coverage")
  await expect(page.getByRole("dialog")).not.toContainText("Complete through")
  await page.getByRole("button", { name: "Close report details" }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  const resources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => ({ name: entry.name, duration: entry.duration })),
  )
  const usageResources = resources.filter((entry) =>
    entry.name.includes("usage.js"),
  )
  expect(usageResources).toHaveLength(1)
  console.log(
    JSON.stringify({
      initialUsageRequests: 0,
      usageModuleRequests: usageResources.length,
      usageModuleLoadMs: usageResources[0].duration,
      reportRequests: requests.filter((url) => url.includes("/usage/reports"))
        .length,
      usageModuleBytes: (
        await readFile("src/serving/http/portal-assets/usage.js")
      ).byteLength,
    }),
  )
  expect(errors).toEqual([])
})
test("a failed report read shows an error and clears stale totals without changing dates", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    Cookie: "__Host-rag_portal=synthetic-usage-test",
  })
  await page.goto(origin + "/portal")
  await page.getByRole("button", { name: "Usage", exact: true }).click()
  await page.getByLabel("From (UTC)", { exact: true }).fill(from)
  await page.getByLabel("To (UTC, exclusive)", { exact: true }).fill(to)
  await page
    .getByRole("button", { name: "Update reports", exact: true })
    .click()
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", {
      name: "View report for ragbot",
      exact: true,
    }),
  })
  await expect(row.getByRole("cell").first()).toHaveText("5")
  await page.route("**/usage/reports?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"usage_unavailable"}',
    }),
  )
  await page
    .getByRole("button", { name: "Update reports", exact: true })
    .click()
  await expect(page.locator(".usage-error")).toContainText(
    "Usage reports are unavailable",
  )
  await expect(row.getByRole("cell")).toHaveText(["—", "—", "—"])
  await expect(page.getByLabel("From (UTC)", { exact: true })).toHaveValue(from)
  await expect(
    page.getByLabel("To (UTC, exclusive)", { exact: true }),
  ).toHaveValue(to)
})
