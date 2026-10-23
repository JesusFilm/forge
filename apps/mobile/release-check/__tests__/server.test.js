/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, afterEach, describe, expect, it, jest, require, setTimeout */
// The read-only server against a fake upstream on 127.0.0.1 (KTD6, KTD8, KTD9,
// KTD10, R12-R15, R35). No test sends a request to production.
const crypto = require("node:crypto")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const {
  buildSchema,
  execute,
  getOperationAST,
  parse,
  print,
  validate,
} = require("graphql")

const { PortTakenError, createReadOnlyServer } = require("../lib/server/server")
const {
  createForwarder,
  createPacer,
  parseRetryAfter,
} = require("../lib/server/forward")
const { ServerLogError, createLog } = require("../lib/server/log")
const { checkLog } = require("../lib/server/logCheck")
const { CONFIG_DIR, REPO_ROOT, readJson } = require("../lib/lists")

const {
  GET_VIDEO_BIBLE_PASSAGES,
  GET_VIDEO_BY_SLUG,
  RECORD_WATCH_SEARCH_EVENT,
  WATCH_SEARCH,
} = require("../../src/lib/queries")
const { SUBMIT_FEEDBACK } = require("../../src/lib/feedbackQueries")
const {
  RECOMMENDATION_DOCUMENTS,
} = require("../../src/lib/recommendations/operations")
const {
  ENGLISH_SEARCH_LANGUAGE,
  buildWatchSearchInput,
} = require("../../src/lib/watchSearch")
const {
  videoThumbnailsDocument,
  videoThumbnailsVariables,
} = require("../../src/hooks/useVideoThumbnails")

const ADMIN_SCHEMA_SDL = fs.readFileSync(
  path.join(REPO_ROOT, "apps/admin/schema.graphql"),
  "utf8",
)
const operations = readJson(path.join(CONFIG_DIR, "operations.json"))
const searchAnswers = readJson(
  path.join(__dirname, "fixtures/server/search-answers.json"),
)

const cleanups = []
const tempDirs = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function listenOn(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen({ port, host }, () => resolve(server.address().port))
  })
}

function closeOf(server) {
  return () =>
    new Promise((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
}

// A port that is free on both 127.0.0.1 and ::1.
async function freePort() {
  for (;;) {
    const v4 = http.createServer()
    const port = await listenOn(v4, 0, "127.0.0.1")
    const v6 = http.createServer()
    const free = await listenOn(v6, port, "::1").then(
      () => true,
      () => false,
    )
    await closeOf(v4)()
    if (free) await closeOf(v6)()
    if (free) return port
  }
}

function fakeClock(start = Date.parse("2026-10-22T00:00:00.000Z")) {
  let now = start
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
    advance(ms) {
      now += ms
    },
  }
}

/** A fake admin that records each request; `respond` decides each answer. */
async function startUpstream(clock = { now: () => Date.now() }) {
  const received = []
  const upstream = {
    received,
    respond: () => ({ body: { data: { videoBySlug: { id: "v1" } } } }),
  }
  const server = http.createServer((request, response) => {
    let raw = ""
    request.on("data", (chunk) => (raw += chunk))
    request.on("end", async () => {
      received.push({ headers: request.headers, body: raw, at: clock.now() })
      const reply = await upstream.respond(JSON.parse(raw), received.length)
      if (reply.destroy) {
        request.socket.destroy()
        return
      }
      response.writeHead(reply.status ?? 200, {
        "content-type": "application/json",
        ...(reply.headers ?? {}),
      })
      response.end(
        typeof reply.body === "string"
          ? reply.body
          : JSON.stringify(reply.body),
      )
    })
  })
  const port = await listenOn(server, 0, "127.0.0.1")
  cleanups.push(closeOf(server))
  upstream.url = `http://127.0.0.1:${port}/api/graphql`
  return upstream
}

async function startServer(upstream, options = {}) {
  const port = await freePort()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-server-"))
  tempDirs.push(dir)
  const logPath = path.join(dir, "server-log.jsonl")
  const server = createReadOnlyServer({
    lanes: [{ port, lane: "ios" }],
    upstreamUrl: upstream.url,
    operations,
    searchAnswers,
    adminSchemaSdl: ADMIN_SCHEMA_SDL,
    logPath,
    ...options,
  })
  await server.bind()
  cleanups.push(() => server.close())
  if (options.started !== false) server.startAnswering()
  const lines = () =>
    fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  return { server, port, logPath, lines }
}

function bodyOf(document, variables = {}) {
  return JSON.stringify({
    operationName: getOperationAST(document)?.name?.value ?? null,
    query: print(document),
    variables,
  })
}

function post(port, body, { host = "127.0.0.1", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host,
        port,
        path: "/api/graphql",
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json", ...headers },
      },
      (response) => {
        let text = ""
        response.on("data", (chunk) => (text += chunk))
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            json: JSON.parse(text),
          }),
        )
      },
    )
    request.on("error", reject)
    request.end(body)
  })
}

const BLOCKED_SHAPE = {
  errors: [{ message: expect.any(String), extensions: { code: "BLOCKED" } }],
  data: null,
}

function searchBody(query, language = ENGLISH_SEARCH_LANGUAGE) {
  return bodyOf(WATCH_SEARCH, {
    input: buildWatchSearchInput({
      query,
      clientRequestId: "request-1",
      limit: 20,
      offset: 0,
      language,
    }),
  })
}

describe("forwarded reads", () => {
  it("forwards GetVideoBySlug with only two headers, and the log line names videoBySlug", async () => {
    const upstream = await startUpstream()
    const { server, port, lines } = await startServer(upstream)
    server.setLaneDevice("ios", "iphone-se")
    const body = bodyOf(GET_VIDEO_BY_SLUG, { slug: "jesus" })

    const answer = await post(port, body, {
      host: "::1",
      headers: {
        authorization: "Bearer device-token",
        cookie: "session=1",
        "x-viewer-id": "viewer-1",
        "x-custom": "1",
      },
    })

    expect(answer.json).toEqual({ data: { videoBySlug: { id: "v1" } } })
    expect(upstream.received).toHaveLength(1)
    const sent = upstream.received[0]
    expect(Object.keys(sent.headers).sort()).toEqual([
      "accept",
      "connection",
      "content-length",
      "content-type",
      "host",
    ])
    expect(sent.headers["content-type"]).toBe("application/json")
    expect(sent.headers.accept).toBe("application/json")
    expect(JSON.parse(sent.body)).toEqual(JSON.parse(body))
    expect(lines()).toEqual([
      expect.objectContaining({
        port,
        lane: "ios",
        deviceId: "iphone-se",
        family: "v6",
        method: "POST",
        path: "/api/graphql",
        route: "forwarded",
        opType: "query",
        opName: "GetVideoBySlug",
        rootFields: { "Query.videoBySlug": 1 },
        forwardedBody: sent.body,
        forwardedSha256: crypto
          .createHash("sha256")
          .update(sent.body)
          .digest("hex"),
        status: 200,
        rateLimit: null,
        search: null,
      }),
    ])
  })

  it("blocks every request between bind and startAnswering", async () => {
    const upstream = await startUpstream()
    const { lines, port } = await startServer(upstream, { started: false })
    const answer = await post(port, bodyOf(GET_VIDEO_BY_SLUG, { slug: "a" }))
    expect(answer.json).toEqual(BLOCKED_SHAPE)
    expect(upstream.received).toHaveLength(0)
    expect(lines()[0]).toMatchObject({
      route: "blocked",
      reason: "not-started",
    })
  })

  it("forwards GetVideoBiblePassages with bibleCitations { passage }, and check-log passes", async () => {
    const upstream = await startUpstream()
    const { server, port, logPath } = await startServer(upstream)
    server.setLaneDevice("ios", "iphone-17-pro-max")
    await post(
      port,
      bodyOf(GET_VIDEO_BIBLE_PASSAGES, {
        slug: "jesus",
        textSlug: "french",
        isEnglish: false,
      }),
    )
    await server.close()
    expect(upstream.received).toHaveLength(1)
    const result = checkLog(logPath, {
      operations,
      expectedDevices: ["iphone-17-pro-max"],
    })
    expect(result.findings).toEqual([])
    expect(result.passed).toBe(true)
  })
})

describe("blocked requests", () => {
  it.each([
    ["RecordWatchSearchEvent", bodyOf(RECORD_WATCH_SEARCH_EVENT)],
    [
      "UserRecommendations",
      bodyOf(RECOMMENDATION_DOCUMENTS.UserRecommendations),
    ],
    [
      "a body with two operation definitions",
      JSON.stringify({
        query: `${print(GET_VIDEO_BY_SLUG)}\n${print(RECORD_WATCH_SEARCH_EVENT)}`,
      }),
    ],
  ])("blocks %s, and the upstream receives nothing", async (_label, body) => {
    const upstream = await startUpstream()
    const { lines, port } = await startServer(upstream)
    const answer = await post(port, body)
    expect(answer.status).toBe(200)
    expect(answer.json).toEqual(BLOCKED_SHAPE)
    expect(upstream.received).toHaveLength(0)
    expect(lines()[0].route).toBe("blocked")
  })
})

describe("the success reply (AE2)", () => {
  it("answers SubmitFeedback with accepted, sends nothing upstream, and logs no feedback text", async () => {
    const upstream = await startUpstream()
    const { lines, logPath, port } = await startServer(upstream)
    const message = "The video stops at 2 minutes"
    const answer = await post(
      port,
      bodyOf(SUBMIT_FEEDBACK, {
        input: {
          kind: "BROKEN",
          message,
          platform: "IOS",
          submissionId: "4f1c8f0e-6d0b-4bde-9a51-0d1c1d6f1a11",
        },
      }),
    )
    expect(answer.json).toEqual({
      data: { submitFeedback: { accepted: true, refusal: null } },
    })
    expect(upstream.received).toHaveLength(0)
    expect(lines()[0]).toMatchObject({ route: "success-reply" })
    expect(fs.readFileSync(logPath, "utf8")).not.toContain(message)
  })
})

describe("saved search answers (KTD10)", () => {
  it("answers a word with no saved answer with MISSING_SEARCH_ANSWER and names the word (AE3)", async () => {
    const upstream = await startUpstream()
    const { lines, port } = await startServer(upstream)
    const answer = await post(port, searchBody("lamb"))
    expect(answer.json).toEqual({
      errors: [
        {
          message: expect.stringContaining('"lamb"'),
          extensions: { code: "MISSING_SEARCH_ANSWER" },
        },
      ],
      data: null,
    })
    expect(upstream.received).toHaveLength(0)
    expect(lines()[0]).toMatchObject({
      route: "missing-search-answer",
      search: { query: "lamb", limit: 20, offset: 0, language: "english" },
    })
  })

  it("answers the saved word with its saved answer, and a prefix with a valid empty answer", async () => {
    const upstream = await startUpstream()
    const { lines, port } = await startServer(upstream)

    const saved = await post(port, searchBody("jesus"))
    expect(saved.json).toEqual(searchAnswers.answers[0].response)

    const prefix = await post(port, searchBody("jes"))
    expect(prefix.json.errors).toBeUndefined()
    expect(prefix.json.data.watchSearch).toMatchObject({
      query: "jes",
      hasMore: false,
      results: [],
    })
    // Admin's schema accepts the document and returns this answer unchanged.
    const schema = buildSchema(ADMIN_SCHEMA_SDL)
    const document = parse(print(WATCH_SEARCH))
    expect(validate(schema, document)).toEqual([])
    const replay = await execute({
      schema,
      document,
      rootValue: prefix.json.data,
      variableValues: JSON.parse(searchBody("jes")).variables,
    })
    expect(JSON.parse(JSON.stringify(replay))).toEqual(prefix.json)

    expect(upstream.received).toHaveLength(0)
    expect(lines().map((line) => line.route)).toEqual([
      "saved-answer",
      "prefix-answer",
    ])
  })
})

describe("answer reuse (R35)", () => {
  const read = bodyOf(GET_VIDEO_BY_SLUG, { slug: "jesus" })

  it("answers a second identical read from its copy, but not in speed-pass mode", async () => {
    const upstream = await startUpstream()
    const { lines, port, server } = await startServer(upstream)
    const first = await post(port, read)
    const second = await post(port, read)
    expect(second.json).toEqual(first.json)
    expect(upstream.received).toHaveLength(1)

    server.setSpeedMode(true)
    await post(port, read)
    expect(upstream.received).toHaveLength(2)
    expect(lines().map((line) => line.route)).toEqual([
      "forwarded",
      "reused",
      "forwarded",
    ])
  })

  it("answers a repeat that arrives during the first read from the first answer", async () => {
    const upstream = await startUpstream()
    upstream.respond = () =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ body: { data: { videoBySlug: { id: "v1" } } } }),
          100,
        ),
      )
    const { port } = await startServer(upstream)
    const answers = await Promise.all([post(port, read), post(port, read)])
    expect(answers[1].json).toEqual(answers[0].json)
    expect(upstream.received).toHaveLength(1)
  })

  it("does not store an answer with errors, so the next identical read goes upstream", async () => {
    const upstream = await startUpstream()
    upstream.respond = () => ({
      body: {
        data: { videoBySlug: null },
        errors: [{ message: "Internal server error" }],
      },
    })
    const { port } = await startServer(upstream)
    await post(port, read)
    await post(port, read)
    expect(upstream.received).toHaveLength(2)
  })

  it("sends a repeat that waited 11 s behind a failed first read upstream", async () => {
    const clock = fakeClock()
    const upstream = await startUpstream(clock)
    let release
    const gate = new Promise((resolve) => (release = resolve))
    upstream.respond = async (_body, count) => {
      if (count > 1) return { body: { data: { videoBySlug: { id: "v1" } } } }
      await gate
      return { status: 503, body: {} }
    }
    const { lines, port } = await startServer(upstream, { clock })

    const first = post(port, read)
    while (upstream.received.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const repeat = post(port, read)
    // The repeat arrives at the same fake time; admin answers 11 s later.
    await new Promise((resolve) => setTimeout(resolve, 200))
    clock.advance(11_000)
    release()
    const answers = await Promise.all([first, repeat])

    expect(answers.map((answer) => answer.status)).toEqual([502, 200])
    expect(answers[1].json).toEqual({ data: { videoBySlug: { id: "v1" } } })
    expect(upstream.received).toHaveLength(2)
    expect(
      lines().map((line) => [line.route, line.status, line.heldMs]),
    ).toEqual([
      ["upstream-error", 502, 0],
      ["forwarded", 200, 11_000],
    ])
  })
})

describe("admin's rate limit (KTD8)", () => {
  const ADMIN_REFUSAL = {
    errors: [
      {
        message: "You are trying to access 'video' too often",
        locations: [{ line: 2, column: 3 }],
        path: [],
      },
    ],
    data: null,
  }

  function thumbnails(ids) {
    return bodyOf(
      videoThumbnailsDocument(ids.length),
      videoThumbnailsVariables(ids, "english"),
    )
  }

  it("reads Retry-After: 1m as 60 seconds", () => {
    expect(parseRetryAfter("1m")).toBe(60_000)
    expect(parseRetryAfter("30")).toBe(30_000)
  })

  it("passes admin's refusal through, logs it, and holds the field until Retry-After", async () => {
    const upstream = await startUpstream()
    upstream.respond = () => ({
      headers: { "retry-after": "1m" },
      body: ADMIN_REFUSAL,
    })
    const { lines, port, server } = await startServer(upstream)
    server.setLaneDevice("ios", "ipad-pro-13")

    const refused = await post(port, thumbnails(["a"]))
    expect(refused.status).toBe(200)
    expect(refused.headers["retry-after"]).toBe("1m")
    expect(refused.json).toEqual(ADMIN_REFUSAL)

    const held = await post(port, thumbnails(["b"]))
    expect(held.json.errors[0].extensions).toEqual({ code: "RATE_LIMITED" })
    expect(upstream.received).toHaveLength(1)
    expect(lines()).toEqual([
      expect.objectContaining({
        route: "forwarded",
        rateLimit: { field: "video", retryAfterMs: 60_000 },
      }),
      expect.objectContaining({ route: "rate-limited", rateLimit: null }),
    ])
    expect(server.stats()).toMatchObject({
      failuresInARow: 0,
      rateLimitRefusals: [
        { ts: expect.any(String), field: "video", deviceId: "ipad-pro-13" },
      ],
    })
  })

  it("keeps each upstream minute at 60 video nodes or fewer, and refuses a hold over 10 seconds", async () => {
    const clock = fakeClock()
    const upstream = await startUpstream(clock)
    upstream.respond = () => ({ body: { data: {} } })
    const { lines, port } = await startServer(upstream, { clock })
    const ids = (prefix, count) =>
      Array.from({ length: count }, (_, i) => `${prefix}${i}`)

    await post(port, thumbnails(ids("a", 30)))
    clock.advance(1_000)
    await post(port, thumbnails(ids("b", 30)))
    clock.advance(1_000)
    const refused = await post(port, thumbnails(ids("c", 10)))
    clock.advance(53_000)
    const held = await post(port, thumbnails(ids("d", 10)))

    expect(refused.json).toEqual({
      errors: [
        {
          message: "You are trying to access 'video' too often",
          extensions: { code: "RATE_LIMITED" },
        },
      ],
      data: null,
    })
    expect(held.json).toEqual({ data: {} })
    const nodes = upstream.received.map((item) => ({
      at: item.at,
      count: Object.keys(JSON.parse(item.body).variables).length - 1,
    }))
    expect(nodes.map((item) => item.count)).toEqual([30, 30, 10])
    for (const item of nodes) {
      const inWindow = nodes
        .filter((other) => other.at > item.at - 60_000 && other.at <= item.at)
        .reduce((sum, other) => sum + other.count, 0)
      expect(inWindow).toBeLessThanOrEqual(60)
    }
    expect(lines().map((line) => line.route)).toEqual([
      "forwarded",
      "forwarded",
      "rate-limited",
      "forwarded",
    ])
  })

  it("admits a late read that fits at once, and still refuses a hold past its deadline", async () => {
    const clock = fakeClock()
    const start = clock.now()
    // Arrived 11 s ago, and the field has room now: no hold, so no refusal.
    const late = await createPacer(clock).admit(
      { "Query.video": 1 },
      start - 11_000,
    )
    expect(late).toEqual({ ok: true })

    const full = createPacer(clock)
    await full.admit({ "Query.video": 60 }, start)
    clock.advance(30_000)
    // Also 11 s late, but the field has no room until 60 s: a hold, refused.
    const held = await full.admit({ "Query.video": 1 }, start + 19_000)
    expect(held).toEqual({ ok: false, field: "video" })
  })

  it("logs heldMs on forwarded and upstream-error lines only, and check-log passes", async () => {
    const clock = fakeClock()
    const upstream = await startUpstream(clock)
    upstream.respond = (_body, count) =>
      count === 3 ? { status: 503, body: {} } : { body: { data: {} } }
    const { lines, logPath, port, server } = await startServer(upstream, {
      clock,
    })
    server.setLaneDevice("ios", "iphone-se")
    const ids = (prefix, count) =>
      Array.from({ length: count }, (_, i) => `${prefix}${i}`)

    await post(port, thumbnails(ids("a", 50)))
    clock.advance(55_000)
    // 50 + 20 nodes pass the limit of 60 until the first 50 leave at 60 s.
    await post(port, thumbnails(ids("b", 20)))
    await post(port, bodyOf(GET_VIDEO_BY_SLUG, { slug: "jesus" }))
    await post(port, thumbnails(ids("b", 20)))
    await server.close()

    expect(lines().map((line) => [line.route, line.heldMs, line.ms])).toEqual([
      ["forwarded", 0, 0],
      ["forwarded", 5_000, 5_000],
      ["upstream-error", 0, 0],
      ["reused", undefined, 0],
    ])
    const result = checkLog(logPath, {
      operations,
      expectedDevices: ["iphone-se"],
    })
    expect(result.findings).toEqual([])
    expect(result.passed).toBe(true)
  })
})

describe("upstream failures", () => {
  it("raises upstream_unavailable once after five failures in a row, and a success resets the count", async () => {
    const upstream = await startUpstream()
    const plan = [
      ...Array(4).fill({ status: 503, body: { errors: [] } }),
      { body: { data: { videoBySlug: null } } },
      { status: 500, body: "{}" },
      { body: "<html>not json</html>" },
      { destroy: true },
      { status: 503, body: {} },
      { status: 502, body: {} },
      { status: 503, body: {} },
    ]
    upstream.respond = (_body, count) => plan[count - 1]
    let raised = 0
    const { port } = await startServer(upstream, {
      onUpstreamUnavailable: () => (raised += 1),
    })
    const raisedAfter = []
    for (const index of plan.keys()) {
      await post(port, bodyOf(GET_VIDEO_BY_SLUG, { slug: `s${index}` }))
      raisedAfter.push(raised)
    }
    expect(raisedAfter).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1])
  })

  function videoRead(count) {
    return {
      rootFields: { "Query.video": count },
      request: { query: "query { video { id } }", variables: {} },
    }
  }

  it("names a time-out with its limit, and keeps network for a lost connection", async () => {
    const upstream = await startUpstream()
    const now = Date.parse("2026-10-23T00:00:30.000Z")
    const forwarder = createForwarder({
      upstreamUrl: upstream.url,
      clock: { now: () => now, sleep: async () => {} },
    })
    // Held 10 s, the longest hold, so 4 s of the 14 s answer budget is left.
    upstream.respond = () => new Promise(() => {})
    const late = await forwarder.forward(videoRead(1), now - 10_000)
    expect(late).toMatchObject({
      route: "upstream-error",
      status: 502,
      reason: "timeout after 4000 ms",
      heldMs: 10_000,
    })
    expect(JSON.parse(late.text).errors[0].message).toContain(
      "(timeout after 4000 ms)",
    )

    upstream.respond = () => ({ destroy: true })
    const lost = await forwarder.forward(videoRead(1), now)
    expect(lost).toMatchObject({
      route: "upstream-error",
      status: 502,
      reason: "network",
      heldMs: 0,
    })
  }, 15_000)

  it("gives heldMs as the time from arrival until the pacer lets the read go", async () => {
    const clock = fakeClock()
    const upstream = await startUpstream(clock)
    upstream.respond = () => ({ body: { data: {} } })
    const forwarder = createForwarder({ upstreamUrl: upstream.url, clock })
    const start = clock.now()

    const first = await forwarder.forward(videoRead(50), start)
    clock.advance(55_000)
    // 50 + 20 nodes pass the limit of 60 until the first 50 leave at 60 s.
    const second = await forwarder.forward(videoRead(20), start + 55_000)

    expect(first).toMatchObject({ route: "forwarded", heldMs: 0 })
    expect(second).toMatchObject({ route: "forwarded", heldMs: 5_000 })
    expect(upstream.received.map((item) => item.at - start)).toEqual([
      0, 60_000,
    ])
  })
})

describe("binding (KTD6)", () => {
  it("refuses with PortTakenError when another listener holds the ::1 side", async () => {
    const holder = http.createServer()
    const port = await listenOn(holder, 0, "::1")
    cleanups.push(closeOf(holder))
    const server = createReadOnlyServer({
      lanes: [{ port, lane: "ios" }],
      upstreamUrl: "http://127.0.0.1:9/api/graphql",
      operations,
      searchAnswers,
      adminSchemaSdl: ADMIN_SCHEMA_SDL,
      logPath: path.join(os.tmpdir(), `release-check-bind-${port}.jsonl`),
    })
    tempDirs.push(path.join(os.tmpdir(), `release-check-bind-${port}.jsonl`))
    cleanups.push(() => server.close())

    const failure = await server.bind().catch((error) => error)
    expect(failure).toBeInstanceOf(PortTakenError)
    expect(failure).toMatchObject({ code: "PORT_TAKEN", port, family: "v6" })
    // The 127.0.0.1 side that did bind is released again.
    const probe = http.createServer()
    await expect(listenOn(probe, port, "127.0.0.1")).resolves.toBe(port)
    await closeOf(probe)()
  })
})

describe("handler failures", () => {
  it("counts a request whose log write throws, and keeps answering the next one", async () => {
    const upstream = await startUpstream()
    const { server, port, lines } = await startServer(upstream)
    const writeSync = fs.writeSync
    // The full disk is the fault; the server code on the path is all real.
    const full = jest.spyOn(fs, "writeSync").mockImplementation((...args) => {
      if (String(args[1]).includes("slug-with-no-log-line")) {
        throw Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
        })
      }
      return writeSync(...args)
    })
    cleanups.push(() => full.mockRestore())

    const lost = await post(
      port,
      bodyOf(GET_VIDEO_BY_SLUG, { slug: "slug-with-no-log-line" }),
    )
    const next = await post(port, bodyOf(GET_VIDEO_BY_SLUG, { slug: "next" }))
    full.mockRestore()
    await server.close()

    expect(lost.json).toEqual({ data: { videoBySlug: { id: "v1" } } })
    expect(next.json).toEqual({ data: { videoBySlug: { id: "v1" } } })
    expect(server.stats().handlerFailures).toBe(1)
    expect(
      lines().map((line) => JSON.parse(line.forwardedBody).variables.slug),
    ).toEqual(["next"])
  })
})

describe("the server log", () => {
  it("throws ServerLogError on a write before open", () => {
    const logPath = path.join(os.tmpdir(), "release-check-unopened-log.jsonl")
    const write = () => createLog(logPath).write({ route: "forwarded" })
    expect(write).toThrow(ServerLogError)
    expect(write).toThrow(`the server log ${logPath} is not open`)
  })
})
