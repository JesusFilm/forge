import { createServer } from "node:http"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  flushOutbox,
  messageFor,
  postNotification,
  postSlackTest,
} from "./slack.js"
import { emptyState, MINUTE, recordObservation } from "./state.js"
import { loadState, saveState } from "./store.js"

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

describe("persistent Slack delivery", () => {
  it("labels an installation test and uses only the configured channel", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, channel: "CTEST", ts: "1.0" })),
      )
    await postSlackTest(
      {
        SLACK_CHANNEL_ID: "CTEST",
        SLACK_BOT_TOKEN: "xoxb-test",
        WATCH_URL: "https://example.com",
      },
      fetchImpl,
    )
    const payload = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(payload.channel).toBe("CTEST")
    expect(payload.text).toMatch(/^TEST:/)
    expect(payload.text).toContain("no production incident")
  })
  it("survives a rejected delivery and a restart, then sends one open and one recovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analytics-watcher-test-"))
    cleanup.push(() => rm(directory, { recursive: true }))
    const path = join(directory, "state.json")
    const messages: { channel: string; text: string }[] = []
    let reject = true
    const server = createServer(async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      if (!reject) messages.push(body)
      res.setHeader("Content-Type", "application/json")
      res.end(
        JSON.stringify(
          reject
            ? { ok: false, error: "not_in_channel" }
            : { ok: true, channel: "CTEST", ts: "123.456" },
        ),
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    )
    const address = server.address()
    if (!address || typeof address === "string")
      throw new Error("missing local port")
    const endpoint = `http://127.0.0.1:${address.port}`
    const config = {
      SLACK_CHANNEL_ID: "CTEST",
      SLACK_BOT_TOKEN: "xoxb-test",
      WATCH_URL: "https://example.com/watch/jesus.html",
    }
    let state = emptyState("test")
    const start = Date.parse("2026-09-14T00:00:00Z")
    for (const minute of [0, 5, 10])
      recordObservation(
        state,
        "ga-browser",
        { status: "bad", detail: "Missing GA page view." },
        start + minute * MINUTE,
      )
    await saveState(path, state)
    const send = (item: Parameters<typeof postNotification>[1]) =>
      postNotification(config, item, fetch, endpoint)
    const persist = () => saveState(path, state)
    await expect(flushOutbox(state, send, persist)).rejects.toThrow(
      "Slack did not acknowledge",
    )
    state = await loadState(path, "test")
    expect(state.outbox).toHaveLength(1)
    reject = false
    await flushOutbox(state, send, persist)
    await flushOutbox(state, send, persist)
    expect(messages).toHaveLength(1)
    expect(messages[0].channel).toBe("CTEST")
    expect(messages[0].text).toContain("Confirmed Watch analytics failure")
    for (const minute of [15, 20])
      recordObservation(
        state,
        "ga-browser",
        { status: "good", detail: "GA accepted." },
        start + minute * MINUTE,
      )
    await persist()
    await flushOutbox(state, send, persist)
    expect(messages).toHaveLength(2)
    expect(messages[1].text).toContain("Watch analytics recovered")
    expect(JSON.parse(await readFile(path, "utf8")).outbox).toEqual([])
  })
  it("refuses to discard corrupt state or reuse it for a changed channel/property", async () => {
    const directory = await mkdtemp(join(tmpdir(), "analytics-watcher-test-"))
    cleanup.push(() => rm(directory, { recursive: true }))
    const path = join(directory, "state.json")
    expect(await loadState(path, "test")).toEqual(emptyState("test"))
    await saveState(path, emptyState("test"))
    await expect(loadState(path, "another-scope")).rejects.toThrow(
      "scope changed",
    )
    await writeFile(path, "broken JSON")
    await expect(loadState(path, "test")).rejects.toThrow(
      "Invalid watcher state",
    )
  })
  it("labels visibility problems without declaring analytics down", () => {
    expect(
      messageFor(
        {
          id: "1",
          incidentId: "1",
          check: "ga:visibility",
          kind: "opened",
          at: 0,
          detail: "GA API access expired.",
        },
        "https://example.com",
      ),
    ).toContain("monitoring needs attention")
  })
})
