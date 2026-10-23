"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global Buffer, URL, module, require */
// The read-only server (KTD6, KTD8, R12): the only path from a test device to
// production admin. It runs in the runner's process, holds every lane port on
// both loopback families, and writes one log line for each request.

const http = require("node:http")

const {
  answerSearch,
  createReuseStore,
  isReusable,
  reuseKey,
} = require("./answers")
const { classifyRequest } = require("./classify")
const { createForwarder, realClock } = require("./forward")
const { createLog, sha256 } = require("./log")
const { buildAdminSchema, successReply } = require("./successReply")

const DEFAULT_UPSTREAM_URL = "https://admin.jesusfilm.org/api/graphql"
const GRAPHQL_PATH = "/api/graphql"
const FAMILIES = Object.freeze([
  { family: "v4", host: "127.0.0.1" },
  { family: "v6", host: "::1" },
])

class PortTakenError extends Error {
  constructor(port, family, cause) {
    super(
      `port ${port} on ${family === "v4" ? "127.0.0.1" : "::1"} is taken; stop the process that holds it`,
    )
    this.name = "PortTakenError"
    this.code = "PORT_TAKEN"
    this.port = port
    this.family = family
    this.cause = cause
  }
}

function blockedBody(message) {
  return {
    errors: [{ message, extensions: { code: "BLOCKED" } }],
    data: null,
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen({ port, host })
  })
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })
}

// Between `bind()` and `startAnswering()` the server holds the ports through
// the builds (KTD6) and blocks every request with the reason `not-started`.
function createReadOnlyServer({
  lanes,
  upstreamUrl = DEFAULT_UPSTREAM_URL,
  operations,
  searchAnswers,
  // record-search (KTD10) answers each search itself; a run never sets it.
  answerSearchRequest = null,
  adminSchemaSdl,
  logPath,
  onUpstreamUnavailable,
  clock = realClock,
}) {
  const schema = buildAdminSchema(adminSchemaSdl)
  const log = createLog(logPath)
  const forwarder = createForwarder({
    upstreamUrl: new URL(upstreamUrl).href,
    clock,
    onUpstreamUnavailable,
  })
  const reuse = createReuseStore()
  const inFlight = new Map()
  const deviceByLane = new Map()
  const routes = {}
  const perDevice = {}
  const rateLimitRefusals = []
  const servers = []
  const handling = new Set()
  let handlerFailures = 0
  let answering = false
  let speedMode = false

  function record(entry) {
    routes[entry.route] = (routes[entry.route] ?? 0) + 1
    if (entry.deviceId !== null) {
      perDevice[entry.deviceId] = (perDevice[entry.deviceId] ?? 0) + 1
    }
    if (entry.rateLimit) {
      rateLimitRefusals.push({
        ts: entry.ts,
        field: entry.rateLimit.field,
        deviceId: entry.deviceId,
      })
    }
    log.write(entry)
  }

  // A repeat that arrives while the first read is still upstream waits for it.
  async function forwardOnce(classified, arrivedAt) {
    if (speedMode) return forwarder.forward(classified, arrivedAt)
    const key = reuseKey(classified.request)
    const stored = reuse.get(key)
    if (stored !== null) return { route: "reused", status: 200, text: stored }
    const pending = inFlight.get(key)
    if (pending) {
      const first = await pending
      if (isReusable(first.status, first.parsed)) {
        return { route: "reused", status: 200, text: first.text }
      }
    }
    const flight = forwarder.forward(classified, arrivedAt)
    inFlight.set(key, flight)
    try {
      const outcome = await flight
      if (
        outcome.route === "forwarded" &&
        isReusable(outcome.status, outcome.parsed)
      ) {
        reuse.put(key, outcome.text)
      }
      return outcome
    } finally {
      if (inFlight.get(key) === flight) inFlight.delete(key)
    }
  }

  async function answer(raw, arrivedAt) {
    if (!answering) {
      return {
        route: "blocked",
        status: 200,
        text: JSON.stringify(
          blockedBody("The read-only server has not started."),
        ),
        reason: "not-started",
      }
    }
    const classified = classifyRequest(raw, operations)
    const parsed = {
      opType: classified.opType,
      opName: classified.opName,
      rootFields: classified.rootFields,
    }
    if (classified.action === "forward") {
      return { ...parsed, ...(await forwardOnce(classified, arrivedAt)) }
    }
    if (classified.action === "search") {
      const found = answerSearchRequest
        ? await answerSearchRequest(classified)
        : await answerSearch(classified, searchAnswers, schema)
      if (found.route !== "blocked") {
        return {
          ...parsed,
          route: found.route,
          status: 200,
          text: JSON.stringify(found.body),
          search: found.search,
        }
      }
      classified.reason = found.reason
    }
    if (classified.action === "successReply") {
      const body = await successReply(schema, classified)
      return {
        ...parsed,
        route: "success-reply",
        status: 200,
        text: JSON.stringify(body),
      }
    }
    return {
      ...parsed,
      route: "blocked",
      status: 200,
      text: JSON.stringify(
        blockedBody(
          `The read-only server blocked this request (${classified.reason}).`,
        ),
      ),
      reason: classified.reason,
    }
  }

  async function handle(request, response, lane, family) {
    const arrivedAt = clock.now()
    const path = (request.url ?? "").split("?")[0]
    const entry = {
      ts: new Date(arrivedAt).toISOString(),
      port: lane.port,
      lane: lane.lane,
      deviceId: deviceByLane.get(lane.lane) ?? null,
      family,
      method: request.method,
      path,
    }
    let outcome
    try {
      const raw = await readBody(request)
      if (request.method !== "POST" || path !== GRAPHQL_PATH) {
        outcome = {
          route: "non-graphql",
          status: 404,
          text: JSON.stringify(
            blockedBody("The read-only server answers only POST /api/graphql."),
          ),
          reason: "not-graphql",
        }
      } else {
        outcome = await answer(raw, arrivedAt)
      }
    } catch (error) {
      outcome = {
        route: "blocked",
        status: 500,
        text: JSON.stringify(
          blockedBody("The read-only server failed on this request."),
        ),
        reason: `server-error ${error.name}`,
      }
    }
    response.writeHead(outcome.status, {
      "content-type": "application/json",
      ...(outcome.headers ?? {}),
    })
    response.end(outcome.text)
    const forwarded = typeof outcome.forwardedBody === "string"
    record({
      ...entry,
      route: outcome.route,
      opType: outcome.opType ?? null,
      opName: outcome.opName ?? null,
      rootFields: outcome.rootFields ?? {},
      ...(forwarded
        ? {
            forwardedBody: outcome.forwardedBody,
            forwardedSha256: sha256(outcome.forwardedBody),
            heldMs: outcome.heldMs,
          }
        : {}),
      status: outcome.status,
      ms: clock.now() - arrivedAt,
      rateLimit: outcome.rateLimit ?? null,
      search: outcome.search ?? null,
      reason: outcome.reason ?? null,
    })
  }

  return {
    /** Holds every lane port on 127.0.0.1 and ::1, or refuses with PortTakenError. */
    async bind() {
      log.open()
      try {
        for (const lane of lanes) {
          for (const { family, host } of FAMILIES) {
            const server = http.createServer((request, response) => {
              // A rejection here would end the runner's process.
              const task = handle(request, response, lane, family).catch(
                () => (handlerFailures += 1),
              )
              handling.add(task)
              void task.finally(() => handling.delete(task))
            })
            try {
              await listen(server, lane.port, host)
            } catch (error) {
              if (error.code === "EADDRINUSE") {
                throw new PortTakenError(lane.port, family, error)
              }
              throw error
            }
            servers.push(server)
          }
        }
      } catch (error) {
        await Promise.all(servers.splice(0).map(closeServer))
        log.close()
        throw error
      }
    },
    startAnswering() {
      answering = true
    },
    setLaneDevice(lane, deviceId) {
      deviceByLane.set(lane, deviceId)
    },
    setSpeedMode(on) {
      speedMode = Boolean(on)
    },
    stats() {
      return {
        routes: { ...routes },
        perDevice: { ...perDevice },
        rateLimitRefusals: [...rateLimitRefusals],
        reusableAnswers: reuse.size(),
        handlerFailures,
        ...forwarder.stats(),
      }
    },
    /** Stops the ports, then waits for the requests in progress to log. */
    async close() {
      await Promise.all(servers.splice(0).map(closeServer))
      await Promise.all([...handling])
      log.close()
    },
  }
}

module.exports = { DEFAULT_UPSTREAM_URL, PortTakenError, createReadOnlyServer }
