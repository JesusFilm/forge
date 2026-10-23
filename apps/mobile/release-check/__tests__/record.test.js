/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, afterEach, describe, expect, it, require */
// The record step for saved search answers (KTD10, F2, R14): searches go only
// to a local admin, each result is checked on a fake production admin, and a
// record replaces the whole answers file. No test touches a real device.
const childProcess = require("node:child_process")
const { EventEmitter } = require("node:events")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const { print } = require("graphql")

const { parseArgs } = require("../lib/contract")
const { createDeps } = require("../lib/deps")
const { CONFIG_DIR, MOBILE_DIR, REPO_ROOT, readJson } = require("../lib/lists")
const { lockPath } = require("../lib/lock")
const { recoverCommand } = require("../lib/modes")
const {
  adminLocales,
  checkResults,
  createRecordDeps,
  localAdminUrl,
  postJson,
  recordSearchCommand,
} = require("../lib/server/record")
const { createReadOnlyServer } = require("../lib/server/server")

const { WATCH_SEARCH } = require("../../src/lib/queries")
const {
  ENGLISH_SEARCH_LANGUAGE,
  buildWatchSearchInput,
} = require("../../src/lib/watchSearch")

const COMMIT = "0123456789abcdef0123456789abcdef01234567"
const UDID = "F97F0DDF-0000-4000-8000-000000000001"
const PRODUCTION = "https://admin.jesusfilm.org/api/graphql"
const ADMIN_SCHEMA_SDL = fs.readFileSync(
  path.join(REPO_ROOT, "apps/admin/schema.graphql"),
  "utf8",
)
const PRETTIER_BIN = path.join(REPO_ROOT, "node_modules/.bin/prettier")

const tempDirs = []
const cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function listen(server, port, host) {
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

async function freePort() {
  for (;;) {
    const v4 = http.createServer()
    const port = await listen(v4, 0, "127.0.0.1")
    const v6 = http.createServer()
    const free = await listen(v6, port, "::1").then(
      () => true,
      () => false,
    )
    await closeOf(v4)()
    if (free) await closeOf(v6)()
    if (free) return port
  }
}

/** A fake admin on 127.0.0.1 that records each body; `answer` decides. */
async function startAdmin(answer) {
  const received = []
  const server = http.createServer((request, response) => {
    let raw = ""
    request.on("data", (chunk) => (raw += chunk))
    request.on("end", () => {
      const body = JSON.parse(raw)
      received.push(body)
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(answer(body)))
    })
  })
  const port = await listen(server, 0, "127.0.0.1")
  cleanups.push(closeOf(server))
  return { received, url: `http://127.0.0.1:${port}/api/graphql` }
}

/** Production: `videoBySlug` and `experienceBySlug` answer from two maps. */
function fakeProduction({ videos = {}, experiences = {} } = {}) {
  return startAdmin((body) => {
    if (body.query.includes("experienceBySlug")) {
      return {
        data: { experienceBySlug: experiences[body.variables.slug] ?? null },
      }
    }
    return { data: { videoBySlug: videos[body.variables.slug] ?? null } }
  })
}

function watchSearchAnswer(query, results) {
  return {
    data: {
      watchSearch: {
        query,
        hasMore: false,
        nextOffset: results.length,
        requestId: `local-${query}`,
        latencyMs: 12,
        degraded: false,
        searchMode: "watch-search",
        results: results.map((result, index) => ({
          type: result.type,
          id: `id-${index}`,
          slug: result.slug,
          title: result.slug,
          imageUrl: null,
          snippet: null,
          startSeconds: null,
          playbackId: null,
          score: 1,
          label: "SEGMENT",
          childCount: 0,
          durationSeconds: 120,
        })),
      },
    },
  }
}

/** A local admin whose search for each query gives the listed results. */
function fakeLocalAdmin(resultsByQuery) {
  return startAdmin((body) =>
    watchSearchAnswer(
      body.variables.input.query,
      resultsByQuery[body.variables.input.query] ?? [],
    ),
  )
}

function searchBody(query) {
  return JSON.stringify({
    query: print(WATCH_SEARCH),
    variables: {
      input: buildWatchSearchInput({
        query,
        offset: 0,
        limit: 20,
        clientRequestId: "client-1",
        language: ENGLISH_SEARCH_LANGUAGE,
      }),
    },
    operationName: "WatchSearch",
  })
}

function fakeHandle(device) {
  return {
    id: device.id,
    platform: device.platform,
    lane: device.lane,
    udid: device.udid ?? null,
    serial:
      device.platform === "android" ? `emulator-${device.consolePort}` : null,
    restarts: 0,
    boot: async () => ({ ok: true }),
    install: async () => ({ ok: true }),
    prepareApp: async () => ({ ok: true }),
    terminate: async () => ({ ok: true }),
    probe: async () => ({ ok: true }),
    shutdown: async () => ({ ok: true }),
  }
}

// Record mode with fake devices and Maestro. Each attempt sends the
// `appSearches` to the lane port, as the app would.
async function recordHarness({
  local,
  production,
  appSearches,
  adminUrl,
  createEmulator = fakeHandle,
  extraJourneys = {},
}) {
  const home = tempDir("release-check-record-")
  const configDir = tempDir("release-check-record-config-")
  for (const name of fs.readdirSync(CONFIG_DIR)) {
    fs.copyFileSync(path.join(CONFIG_DIR, name), path.join(configDir, name))
  }
  const ports = {
    hostIos: await freePort(),
    hostAndroidPhone: await freePort(),
  }
  const settingsFile = path.join(configDir, "test-settings.json")
  const settings = readJson(settingsFile)
  settings.ports = { ...settings.ports, ...ports }
  fs.writeFileSync(settingsFile, JSON.stringify(settings))
  const journeysDir = tempDir("release-check-record-journeys-")
  fs.writeFileSync(
    path.join(journeysDir, "search-open-result.yaml"),
    [
      "appId: org.jesusfilm.forgewatch",
      "name: search-open-result",
      "tags:",
      "  - search",
      "---",
      "- launchApp:",
      "    permissions:",
      "      notifications: deny",
      "    label: Launch the app",
      "- assertVisible:",
      "    id: screen-tab-watch",
      "    label: Search shows",
      "",
    ].join("\n"),
  )
  for (const [name, source] of Object.entries(extraJourneys)) {
    fs.writeFileSync(path.join(journeysDir, name), source)
  }
  fs.mkdirSync(path.join(home, "builds", COMMIT, "ios", "forgewatch.app"), {
    recursive: true,
  })
  fs.mkdirSync(path.join(home, "builds", COMMIT, "android"), {
    recursive: true,
  })
  fs.writeFileSync(
    path.join(home, "builds", COMMIT, "android", "app-release.apk"),
    "apk",
  )
  const out = []
  const err = []
  const ran = []
  const deps = createRecordDeps({
    home,
    configDir,
    journeysDir,
    env: {
      HOME: os.homedir(),
      PATH: "/usr/bin:/bin",
      MAESTRO_BIN: "/opt/maestro",
      ...(adminUrl ? {} : { FORGE_RELEASE_CHECK_RECORD_ADMIN_URL: local.url }),
    },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    signals: new EventEmitter(),
    sleep: async () => {},
    git: {
      head: async () => COMMIT,
      dirty: async () => [],
      show: async () => ADMIN_SCHEMA_SDL,
    },
    build: {
      checkArtifact: async () => ({ findings: [] }),
      buildTestApps: async () => {
        throw new Error("no build expected")
      },
    },
    listInventory: async () => ({ owned: [{ id: "iphone-se", udid: UDID }] }),
    createSimulator: fakeHandle,
    createEmulator,
    runChild: async () => ({ code: 0, stdout: "", stderr: "" }),
    runMaestro: async (options) => {
      ran.push({ platform: options.platform, deviceRef: options.deviceRef })
      const port =
        options.platform === "ios" ? ports.hostIos : ports.hostAndroidPhone
      for (const query of appSearches) {
        const answer = await postJson(
          `http://127.0.0.1:${port}/api/graphql`,
          searchBody(query),
        )
        expect(answer.json.data.watchSearch.query).toBe(query)
      }
      return { code: 0, stdout: "", stderr: "", timedOut: false }
    },
    server: {
      create: (options) =>
        createReadOnlyServer({ ...options, upstreamUrl: production.url }),
    },
  })
  const command = {
    mode: "record-search",
    subcommand: null,
    flags: adminUrl ? { "admin-url": adminUrl } : {},
    positionals: [],
  }
  return {
    home,
    deps,
    out,
    err,
    ran,
    journeysDir,
    answersFile: path.join(configDir, "search-answers.json"),
    run: () => recordSearchCommand(command, deps),
  }
}

describe("the local admin URL", () => {
  it("refuses production admin and accepts localhost and 127.0.0.1", () => {
    expect(() => localAdminUrl(PRODUCTION)).toThrow(
      /only to a local admin.*has the host `admin\.jesusfilm\.org`/,
    )
    expect(localAdminUrl("http://localhost:3003/api/graphql")).toBe(
      "http://localhost:3003/api/graphql",
    )
    expect(localAdminUrl("http://127.0.0.1:3003/api/graphql")).toBe(
      "http://127.0.0.1:3003/api/graphql",
    )
  })

  it("refuses record-search with a production admin URL before it takes the lock or sends a search", async () => {
    const local = await fakeLocalAdmin({})
    const production = await fakeProduction()
    const harness = await recordHarness({
      local,
      production,
      appSearches: ["creation"],
      adminUrl: PRODUCTION,
    })
    const before = fs.readFileSync(harness.answersFile, "utf8")

    const code = await harness.run()

    expect(code).toBe(2)
    expect(harness.err.join("\n")).toMatch(/admin\.jesusfilm\.org/)
    expect(harness.ran).toEqual([])
    expect(fs.existsSync(lockPath(harness.home))).toBe(false)
    expect(fs.readFileSync(harness.answersFile, "utf8")).toBe(before)
  })
})

describe("record-search refusals before the lock", () => {
  it("refuses a journey that breaks a journey rule, before it takes the lock or sends a search", async () => {
    const harness = await recordHarness({
      local: await fakeLocalAdmin({}),
      production: await fakeProduction(),
      appSearches: ["creation"],
      extraJourneys: {
        "post.yaml": [
          "appId: org.jesusfilm.forgewatch",
          "---",
          "- launchApp:",
          "    permissions:",
          "      notifications: deny",
          "- runScript: post.js",
        ].join("\n"),
      },
    })
    const before = fs.readFileSync(harness.answersFile, "utf8")

    const code = await harness.run()

    expect(code).toBe(2)
    const printed = harness.err.join("\n")
    expect(printed).toContain(
      "release-check refused: the journey rules of `check-lists` refuse these journeys, so no journey runs:",
    )
    expect(printed).toContain(
      `  - ${path.join(harness.journeysDir, "post.yaml")}: line 6 runs runScript; host-side JavaScript can reach production admin without the read-only server`,
    )
    expect(harness.ran).toEqual([])
    expect(fs.existsSync(lockPath(harness.home))).toBe(false)
    expect(fs.existsSync(path.join(harness.home, "records"))).toBe(false)
    expect(fs.readFileSync(harness.answersFile, "utf8")).toBe(before)
  })

  it("refuses a stale run lock, keeps it, and leaves the orphan for recover", async () => {
    const harness = await recordHarness({
      local: await fakeLocalAdmin({}),
      production: await fakeProduction(),
      appSearches: ["creation"],
    })
    const dead = {
      pid: childProcess.spawnSync("/usr/bin/true").pid,
      processStart: "Thu Oct 22 01:00:00 2026",
      mode: "run",
      runId: "2026-10-22T01-00-00Z-dead",
    }
    fs.writeFileSync(lockPath(harness.home), JSON.stringify(dead))

    expect(await harness.run()).toBe(2)
    expect(harness.err.join("\n")).toContain(
      "release-check refused: the record did not start.\n- STALE_RUN_LOCK: ",
    )
    expect(harness.ran).toEqual([])
    expect(readJson(lockPath(harness.home))).toEqual(dead)

    const stopped = []
    const out = []
    const recoverDeps = createDeps({
      home: harness.home,
      out: (text) => out.push(text),
      err: () => {},
      devices: {
        list: async () => ({ owned: [], foreign: [], missing: [], errors: [] }),
        stopOwned: async (inventory) => {
          stopped.push(inventory)
          return []
        },
      },
    })
    expect(await recoverCommand(parseArgs(["recover"]), recoverDeps)).toBe(0)
    expect(stopped).toHaveLength(1)
    expect(out.join("\n")).toContain(
      `stopped the runner's devices. Run ${dead.runId} left no run.json`,
    )
    expect(fs.existsSync(lockPath(harness.home))).toBe(false)
  })
})

describe("the result checks", () => {
  async function checkThroughServer(production, entries) {
    const port = await freePort()
    const server = createReadOnlyServer({
      lanes: [{ port, lane: "ios" }],
      upstreamUrl: production.url,
      operations: readJson(path.join(CONFIG_DIR, "operations.json")),
      searchAnswers: { answers: [] },
      adminSchemaSdl: ADMIN_SCHEMA_SDL,
      logPath: path.join(tempDir("release-check-record-log-"), "log.jsonl"),
    })
    await server.bind()
    server.startAnswering()
    cleanups.push(() => server.close())
    return checkResults(entries, {
      serverUrl: `http://127.0.0.1:${port}/api/graphql`,
      locales: adminLocales(MOBILE_DIR),
      sleep: async () => {},
    })
  }

  function entry(query, results) {
    return {
      input: { query, limit: 20, offset: 0, language: "english" },
      response: watchSearchAnswer(query, results),
    }
  }

  it("refuses and names a VIDEO result whose videoBySlug read is null", async () => {
    const production = await fakeProduction({
      videos: { creation: { id: "v1", slug: "creation" } },
    })

    const result = await checkThroughServer(production, [
      entry("creation", [
        { type: "VIDEO", slug: "creation" },
        { type: "VIDEO", slug: "gone-video" },
      ]),
    ])

    expect(result.checked).toBe(2)
    expect(result.refusals).toEqual([
      {
        type: "VIDEO",
        slug: "gone-video",
        locale: null,
        queries: ["creation"],
        reason: "videoBySlug returned null on production",
      },
    ])
  })

  it("passes an EXPERIENCE result that experienceBySlug answers in the answer's language, with no videoBySlug read", async () => {
    const production = await fakeProduction({
      experiences: { easter: { id: "e1", slug: "easter" } },
    })

    const result = await checkThroughServer(production, [
      entry("easter", [{ type: "EXPERIENCE", slug: "easter" }]),
    ])

    expect(result).toEqual({ checked: 1, refusals: [] })
    expect(production.received).toHaveLength(1)
    expect(production.received[0].variables).toEqual({
      locale: "en",
      slug: "easter",
    })
    expect(production.received[0].query).toMatch(/experienceBySlug/)
    expect(JSON.stringify(production.received)).not.toMatch(/videoBySlug/)
  })
})

describe("record-search", () => {
  function prettierCheck(file) {
    return childProcess.spawnSync(PRETTIER_BIN, ["--check", file], {
      encoding: "utf8",
    })
  }

  it("records every search the app sends, on each platform, and writes a file that passes prettier --check", async () => {
    const local = await fakeLocalAdmin({
      creation: [
        { type: "VIDEO", slug: "creation" },
        { type: "EXPERIENCE", slug: "easter" },
      ],
      "bible stories": [{ type: "VIDEO", slug: "noah" }],
    })
    const production = await fakeProduction({
      videos: { creation: { id: "v1" }, noah: { id: "v2" } },
      experiences: { easter: { id: "e1" } },
    })
    const harness = await recordHarness({
      local,
      production,
      appSearches: ["bible stories", "creation"],
    })

    const code = await harness.run()

    expect(code).toBe(0)
    expect(harness.ran.map((item) => item.platform)).toEqual(["ios", "android"])
    expect(local.received).toHaveLength(4)
    const written = readJson(harness.answersFile)
    expect(written.documentDigest).toBe(
      require("../lib/lists").currentWatchSearchDigest(),
    )
    expect(written.answers.map((item) => item.input)).toEqual([
      { query: "bible stories", limit: 20, offset: 0, language: "english" },
      { query: "creation", limit: 20, offset: 0, language: "english" },
    ])
    expect(written.answers[1].response).toEqual(
      watchSearchAnswer("creation", [
        { type: "VIDEO", slug: "creation" },
        { type: "EXPERIENCE", slug: "easter" },
      ]),
    )
    const check = prettierCheck(harness.answersFile)
    expect(check.stderr + check.stdout).toMatch(/use Prettier code style/)
    expect(check.status).toBe(0)
    expect(fs.existsSync(lockPath(harness.home))).toBe(false)
  })

  it("replaces the file on a second record instead of appending", async () => {
    const production = await fakeProduction({
      videos: { creation: { id: "v1" }, "shalom-peace": { id: "v3" } },
    })
    const first = await recordHarness({
      local: await fakeLocalAdmin({
        creation: [{ type: "VIDEO", slug: "creation" }],
      }),
      production,
      appSearches: ["creation"],
    })
    expect(await first.run()).toBe(0)
    const second = await recordHarness({
      local: await fakeLocalAdmin({
        peace: [{ type: "VIDEO", slug: "shalom-peace" }],
      }),
      production,
      appSearches: ["peace"],
    })
    fs.copyFileSync(first.answersFile, second.answersFile)

    expect(await second.run()).toBe(0)

    const written = readJson(second.answersFile)
    expect(written.answers.map((item) => item.input.query)).toEqual(["peace"])
    expect(prettierCheck(second.answersFile).status).toBe(0)
  })

  it("does not stop an emulator whose serial another session holds", async () => {
    const stops = []
    const inUse =
      "emulator-5640 is already in use, so the runner does not start forge_rc_phone on it"
    const harness = await recordHarness({
      local: await fakeLocalAdmin({
        creation: [{ type: "VIDEO", slug: "creation" }],
      }),
      production: await fakeProduction({ videos: { creation: { id: "v1" } } }),
      appSearches: ["creation"],
      createEmulator: (device) => ({
        ...fakeHandle(device),
        boot: async () => ({ ok: false, refused: true, error: inUse }),
        shutdown: async () => {
          stops.push(device.id)
          return { ok: true }
        },
      }),
    })

    const code = await harness.run()

    expect(code).toBe(1)
    expect(harness.ran.map((item) => item.platform)).toEqual(["ios"])
    expect(stops).toEqual([])
    expect(JSON.parse(harness.out.at(-1)).problems).toContain(
      `the device on android-phone: the device did not start: ${inUse}`,
    )
  })

  it("writes nothing and names the result when a VIDEO result is null on production", async () => {
    const harness = await recordHarness({
      local: await fakeLocalAdmin({
        creation: [
          { type: "VIDEO", slug: "creation" },
          { type: "VIDEO", slug: "gone-video" },
        ],
      }),
      production: await fakeProduction({ videos: { creation: { id: "v1" } } }),
      appSearches: ["creation"],
    })
    const before = fs.readFileSync(harness.answersFile, "utf8")

    const code = await harness.run()

    expect(code).toBe(1)
    const printed = JSON.parse(harness.out.at(-1))
    expect(printed).toMatchObject({ result: "failed", file: null })
    expect(printed.problems).toEqual([
      'VIDEO result gone-video of the search "creation": videoBySlug returned null on production',
    ])
    expect(fs.readFileSync(harness.answersFile, "utf8")).toBe(before)
    // The record folder alone explains the refusal (2026-10-22 run 2).
    const recordLog = fs.readFileSync(
      path.join(printed.recordDir, "record.log"),
      "utf8",
    )
    expect(recordLog).toMatch(
      /problem: VIDEO result gone-video of the search "creation": videoBySlug returned null on production\n.*wrote nothing, because of 1 problem\(s\)\n$/,
    )
  })
})
