"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global Buffer, URL, clearTimeout, module, require, setTimeout */
// The one path to production admin (KTD8): pace each root field under admin's
// limit, send only the parsed request with two fixed headers, and read admin's
// rate-limit refusal from its header and message (it has no extensions).

const http = require("node:http")
const https = require("node:https")

const FIELD_NODE_BUDGET = 60
const WINDOW_MS = 60_000
const MAX_HOLD_MS = 10_000
// Below the app's REQUEST_TIMEOUT_MS (15 s), so the app reads our answer and a
// hung admin counts as an upstream failure.
const ANSWER_BUDGET_MS = 14_000
const MIN_UPSTREAM_TIMEOUT_MS = 1_000
const UNAVAILABLE_AFTER_FAILURES = 5
const DEFAULT_RETRY_AFTER_MS = WINDOW_MS
const REFUSAL_MESSAGE = /You are trying to access '([A-Za-z0-9_]+)' too often/

const realClock = Object.freeze({
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
})

/** `1m` and a plain seconds number, as admin and HTTP send them; else null. */
function parseRetryAfter(value) {
  if (typeof value !== "string") return null
  const text = value.trim()
  const minutes = text.match(/^(\d+(?:\.\d+)?)\s*m$/i)
  if (minutes) return Math.round(Number(minutes[1]) * 60_000)
  const seconds = text.match(/^(\d+(?:\.\d+)?)\s*s?$/i)
  if (seconds) return Math.round(Number(seconds[1]) * 1_000)
  return null
}

/** Admin's refusal: a Retry-After header AND the "too often" message. */
function refusalOf(headers, parsed) {
  const header = headers["retry-after"]
  if (header === undefined || !Array.isArray(parsed?.errors)) return null
  for (const error of parsed.errors) {
    const match =
      typeof error?.message === "string" && error.message.match(REFUSAL_MESSAGE)
    if (match) {
      return {
        field: match[1],
        retryAfterMs: parseRetryAfter(header) ?? DEFAULT_RETRY_AFTER_MS,
      }
    }
  }
  return null
}

function localRefusal(field) {
  return {
    errors: [
      {
        message: `You are trying to access '${field}' too often`,
        extensions: { code: "RATE_LIMITED" },
      },
    ],
    data: null,
  }
}

function fieldName(coordinate) {
  return coordinate.slice(coordinate.indexOf(".") + 1)
}

// Admin counts its limit per field node, for each root field, per minute.
function createPacer(clock) {
  const sent = new Map()
  const heldUntil = new Map()

  function readyAt(coordinate, count, now) {
    const entries = (sent.get(coordinate) ?? []).filter(
      (entry) => entry.at > now - WINDOW_MS,
    )
    sent.set(coordinate, entries)
    let ready = Math.max(now, heldUntil.get(coordinate) ?? 0)
    let used = entries.reduce((sum, entry) => sum + entry.count, 0)
    for (const entry of entries) {
      if (used + count <= FIELD_NODE_BUDGET) break
      used -= entry.count
      ready = Math.max(ready, entry.at + WINDOW_MS)
    }
    return used + count <= FIELD_NODE_BUDGET ? ready : Infinity
  }

  return {
    /** Waits until every root field fits, or refuses past MAX_HOLD_MS. */
    async admit(rootFields, arrivedAt) {
      const deadline = arrivedAt + MAX_HOLD_MS
      for (;;) {
        const now = clock.now()
        let ready = now
        let slowest = null
        for (const [coordinate, count] of Object.entries(rootFields)) {
          const at = readyAt(coordinate, count, now)
          if (at > ready) {
            ready = at
            slowest = coordinate
          }
        }
        // A read that waited behind an identical one can arrive here late;
        // only a hold that it still needs can pass its deadline.
        if (ready > now && ready > deadline) {
          return { ok: false, field: fieldName(slowest) }
        }
        if (ready <= now) {
          for (const [coordinate, count] of Object.entries(rootFields)) {
            sent.get(coordinate).push({ at: now, count })
          }
          return { ok: true }
        }
        await clock.sleep(ready - now)
      }
    },
    holdField(field, untilMs) {
      const coordinate = `Query.${field}`
      heldUntil.set(
        coordinate,
        Math.max(heldUntil.get(coordinate) ?? 0, untilMs),
      )
    },
  }
}

function postUpstream(upstreamUrl, body, timeoutMs) {
  const url = new URL(upstreamUrl)
  const client = url.protocol === "https:" ? https : http
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const request = client.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () =>
          finish({
            status: response.statusCode,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        )
        response.on("error", (error) => finish({ error }))
      },
    )
    const timer = setTimeout(() => {
      finish({ timedOut: true })
      request.destroy()
    }, timeoutMs)
    request.on("error", (error) => finish({ error }))
    request.end(body)
  })
}

function upstreamError(reason) {
  return {
    errors: [
      {
        message: `The read-only server got no usable answer from admin (${reason}).`,
        extensions: { code: "UPSTREAM_ERROR" },
      },
    ],
    data: null,
  }
}

function createForwarder({ upstreamUrl, clock, onUpstreamUnavailable }) {
  const pacer = createPacer(clock)
  let failuresInARow = 0
  let unavailable = false

  function recordFailure() {
    failuresInARow += 1
    if (failuresInARow >= UNAVAILABLE_AFTER_FAILURES && !unavailable) {
      unavailable = true
      onUpstreamUnavailable?.()
    }
  }

  return {
    // The result names the log route, the answer for the app, and the exact
    // bytes that went upstream, so the log check can parse them again.
    async forward(classified, arrivedAt) {
      const admitted = await pacer.admit(classified.rootFields, arrivedAt)
      if (!admitted.ok) {
        return {
          route: "rate-limited",
          status: 200,
          headers: {},
          text: JSON.stringify(localRefusal(admitted.field)),
          parsed: null,
          forwardedBody: null,
          rateLimit: null,
          reason: `hold-over-${MAX_HOLD_MS}ms ${admitted.field}`,
        }
      }
      const heldMs = clock.now() - arrivedAt
      const { query, variables, operationName } = classified.request
      const forwardedBody = JSON.stringify({ query, variables, operationName })
      const timeoutMs = Math.max(
        MIN_UPSTREAM_TIMEOUT_MS,
        ANSWER_BUDGET_MS - heldMs,
      )
      const answer = await postUpstream(upstreamUrl, forwardedBody, timeoutMs)
      const failed = (reason) => {
        recordFailure()
        return {
          route: "upstream-error",
          status: 502,
          headers: {},
          text: JSON.stringify(upstreamError(reason)),
          parsed: null,
          forwardedBody,
          rateLimit: null,
          reason,
          heldMs,
        }
      }
      if (answer.timedOut) return failed(`timeout after ${timeoutMs} ms`)
      if (answer.error) return failed("network")
      if (answer.status >= 500) return failed(`status ${answer.status}`)
      let parsed
      try {
        parsed = JSON.parse(answer.text)
      } catch {
        return failed("invalid-json")
      }
      failuresInARow = 0
      const rateLimit = refusalOf(answer.headers, parsed)
      if (rateLimit) {
        pacer.holdField(rateLimit.field, clock.now() + rateLimit.retryAfterMs)
      }
      const headers = {}
      if (answer.headers["retry-after"] !== undefined) {
        headers["retry-after"] = answer.headers["retry-after"]
      }
      return {
        route: "forwarded",
        status: answer.status,
        headers,
        text: answer.text,
        parsed,
        forwardedBody,
        rateLimit,
        reason: null,
        heldMs,
      }
    },
    stats: () => ({ failuresInARow, upstreamUnavailable: unavailable }),
  }
}

module.exports = {
  REFUSAL_MESSAGE,
  WINDOW_MS,
  createForwarder,
  createPacer,
  parseRetryAfter,
  realClock,
  refusalOf,
}
