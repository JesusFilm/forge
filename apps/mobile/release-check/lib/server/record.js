"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, Buffer, URL, clearTimeout, module, require, setTimeout */
// The record step for saved search answers (KTD10, F2, R14). The search
// journeys run on one device per platform behind a read-only server whose
// searches go to a local admin only; production then checks every result.

const fs = require("node:fs")
const http = require("node:http")
const https = require("node:https")
const path = require("node:path")

const { EXIT, refuseMode } = require("../contract")
const { planJourneys, readJourneys } = require("../journeys/screens")
const {
  ADMIN_SCHEMA_PATH,
  JOURNEYS_COPY_DIR,
  MOBILE_DIR,
  copyJourneys,
  currentWatchSearchDigest,
  journeyRulesRefusal,
  readJson,
} = require("../lists")
const { holderText } = require("../lock")
const { refuseStaleLock } = require("../plan")
const { compareText, writeFileAtomic } = require("../report/summary")
const runFolder = require("../runFolder")
const session = require("../session")
const { SEARCH_FIELD, searchInputOf } = require("./answers")
const { REFUSAL_MESSAGE } = require("./forward")

const DEFAULT_RECORD_ADMIN_URL = "http://localhost:3003/api/graphql"
const ADMIN_URL_ENV = "FORGE_RELEASE_CHECK_RECORD_ADMIN_URL"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"])
const SEARCH_TAG = "search"
const RECORDED_ROUTE = "recorded-search"
const ANSWERS_FILE = "search-answers.json"
const RECORDS_DIR = "records"
const RECORD_LOG = "record.log"
const LANGUAGE_TABLE = "src/i18n/adminLanguages.generated.ts"
const POST_TIMEOUT_MS = 30_000
// The server holds a read for at most 10 s to pace it, then refuses it, so a
// check waits and asks again; 12 tries cover more than one pacing minute.
const CHECK_TRIES = 12
const CHECK_RETRY_MS = 10_000
const CHECKS = Object.freeze({
  VIDEO: {
    field: "videoBySlug",
    operationName: "RecordCheckVideo",
    query:
      "query RecordCheckVideo($slug: String!) { videoBySlug(slug: $slug) { id slug } }",
  },
  EXPERIENCE: {
    field: "experienceBySlug",
    operationName: "RecordCheckExperience",
    query:
      "query RecordCheckExperience($locale: String!, $slug: String!) { experienceBySlug(locale: $locale, slug: $slug) { id slug } }",
  },
})

class RecordRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = "RecordRefusal"
    this.code = code
  }
}

function localAdminUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new RecordRefusal("ADMIN_URL_INVALID", `\`${input}\` is not a URL`)
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !LOCAL_HOSTS.has(url.hostname)
  ) {
    throw new RecordRefusal(
      "ADMIN_URL_NOT_LOCAL",
      `record-search sends searches only to a local admin (host localhost or 127.0.0.1), and \`${url.href}\` has the host \`${url.hostname}\``,
    )
  }
  return url.href
}

/** One JSON POST: `{ status, json, error }`, and it never rejects. */
function postJson(url, body, { timeoutMs = POST_TIMEOUT_MS } = {}) {
  const target = new URL(url)
  const client = target.protocol === "https:" ? https : http
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const request = client.request(
      target,
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
        response.on("end", () => {
          let json = null
          try {
            json = JSON.parse(Buffer.concat(chunks).toString("utf8"))
          } catch {
            json = null
          }
          finish({ status: response.statusCode, json, error: null })
        })
        response.on("error", (error) =>
          finish({ status: null, json: null, error: error.message }),
        )
      },
    )
    const timer = setTimeout(() => {
      request.destroy()
      finish({
        status: null,
        json: null,
        error: `no answer in ${timeoutMs} ms`,
      })
    }, timeoutMs)
    request.on("error", (error) =>
      finish({ status: null, json: null, error: error.message }),
    )
    request.end(body)
  })
}

function errorsOf(json) {
  return Array.isArray(json?.errors) ? json.errors : []
}

function searchKey(input) {
  return JSON.stringify([
    input.query,
    input.limit,
    input.offset,
    input.language,
  ])
}

function failedSearchBody(reason) {
  return {
    errors: [{ message: reason, extensions: { code: "UPSTREAM_ERROR" } }],
    data: null,
  }
}

function createSearchRecorder({ adminUrl, post = postJson, now = Date.now }) {
  const target = localAdminUrl(adminUrl)
  const entries = new Map()
  const failures = []

  async function answerSearchRequest(classified) {
    const search = searchInputOf(classified)
    if ((classified.rootFields[SEARCH_FIELD] ?? 0) !== 1) {
      return {
        route: "blocked",
        reason: "search-field-count",
        body: null,
        search,
      }
    }
    const { query, variables, operationName } = classified.request
    const answer = await post(
      localAdminUrl(target),
      JSON.stringify({ query, variables, operationName }),
    )
    const body = answer.json
    const errors = errorsOf(body)
    let reason = null
    if (answer.error) reason = `local admin did not answer: ${answer.error}`
    else if (answer.status !== 200) {
      reason = `local admin answered HTTP ${answer.status}`
    } else if (errors.length > 0) {
      reason = `local admin answered an error: ${errors[0]?.message}`
    } else if (!body?.data?.watchSearch) {
      reason = "local admin answered no watchSearch"
    }
    if (reason) {
      failures.push({ search, reason })
      return {
        route: RECORDED_ROUTE,
        body: body ?? failedSearchBody(reason),
        search,
      }
    }
    const key = searchKey(search)
    if (!entries.has(key)) {
      entries.set(key, {
        input: search,
        response: { data: body.data },
        recordedAt: new Date(now()).toISOString(),
      })
    }
    return { route: RECORDED_ROUTE, body, search }
  }

  return {
    adminUrl: target,
    answerSearchRequest,
    // Sorted by the search input, so a second record of the same searches
    // gives the same order.
    entries: () =>
      [...entries.entries()]
        .sort(([a], [b]) => compareText(a, b))
        .map(([, entry]) => entry),
    failures: () => [...failures],
  }
}

function adminLocales(mobileDir = MOBILE_DIR) {
  const source = fs.readFileSync(path.join(mobileDir, LANGUAGE_TABLE), "utf8")
  const table = new Map()
  for (const match of source.matchAll(
    /textSlug: "([^"]+)", rawTag: "([^"]+)"/g,
  )) {
    if (!table.has(match[1])) table.set(match[1], match[2])
  }
  return table
}

function plannedChecks(entries, locales) {
  const checks = new Map()
  for (const entry of entries) {
    const results = entry.response?.data?.watchSearch?.results ?? []
    for (const result of results) {
      if (!CHECKS[result?.type] || typeof result.slug !== "string") continue
      const locale =
        result.type === "EXPERIENCE"
          ? (locales.get(entry.input.language) ?? null)
          : null
      const key = JSON.stringify([result.type, result.slug, locale])
      const planned = checks.get(key) ?? {
        type: result.type,
        slug: result.slug,
        locale,
        language: entry.input.language,
        queries: [],
      }
      if (!planned.queries.includes(entry.input.query)) {
        planned.queries.push(entry.input.query)
      }
      checks.set(key, planned)
    }
  }
  return [...checks.values()]
}

function tooOften(answer) {
  const errors = errorsOf(answer.json)
  return errors.some((error) => REFUSAL_MESSAGE.test(String(error?.message)))
}

function refusalOf(check, reason) {
  return {
    type: check.type,
    slug: check.slug,
    locale: check.locale,
    queries: check.queries,
    reason,
  }
}

// VIDEO results by `videoBySlug`, EXPERIENCE results by `experienceBySlug` in
// the answer's language. The reads go through the read-only server, so each
// takes the normal paced path to production.
async function checkResults(
  entries,
  {
    serverUrl,
    locales,
    post = postJson,
    sleep,
    signal,
    tries = CHECK_TRIES,
    retryMs = CHECK_RETRY_MS,
  },
) {
  const refusals = []
  let checked = 0
  for (const check of plannedChecks(entries, locales)) {
    if (signal?.aborted) break
    if (check.type === "EXPERIENCE" && check.locale === null) {
      refusals.push(
        refusalOf(
          check,
          `no Admin tag is known for the language ${check.language}`,
        ),
      )
      continue
    }
    const spec = CHECKS[check.type]
    const variables =
      check.type === "VIDEO"
        ? { slug: check.slug }
        : { locale: check.locale, slug: check.slug }
    const body = JSON.stringify({
      query: spec.query,
      variables,
      operationName: spec.operationName,
    })
    let answer = await post(serverUrl, body)
    for (let tried = 1; tooOften(answer) && tried < tries; tried += 1) {
      await sleep(retryMs)
      answer = await post(serverUrl, body)
    }
    checked += 1
    const errors = errorsOf(answer.json)
    if (answer.error || answer.status !== 200 || errors.length > 0) {
      const detail =
        answer.error ?? errors[0]?.message ?? `HTTP ${answer.status}`
      refusals.push(
        refusalOf(check, `the ${spec.field} read failed: ${detail}`),
      )
    } else if (answer.json?.data?.[spec.field] == null) {
      refusals.push(
        refusalOf(check, `${spec.field} returned null on production`),
      )
    }
  }
  return { checked, refusals }
}

async function writeSearchAnswers(file, { answers, documentDigest }) {
  const prettier = require("prettier")
  const text = JSON.stringify({ schemaVersion: 1, documentDigest, answers })
  const config = (await prettier.resolveConfig(file)) ?? {}
  writeFileAtomic(
    file,
    await prettier.format(text, { ...config, filepath: file }),
  )
  return file
}

function createRecordDeps(overrides = {}) {
  return {
    post: postJson,
    mobileDir: MOBILE_DIR,
    ...session.createSessionDeps(overrides),
  }
}

function searchJourneys(deps) {
  const journeys = readJourneys(deps.journeysDir).filter((journey) =>
    journey.flow.tags.includes(SEARCH_TAG),
  )
  const plan = planJourneys(
    journeys,
    readJson(path.join(deps.configDir, "screens.json")),
    deps.config.settings,
  )
  return journeys.map((journey) => ({
    ...journey,
    platforms: plan.find((entry) => entry.id === journey.id).platforms,
  }))
}

function firstDevicePerPlatform(devicesConfig) {
  return ["ios", "android"]
    .map((platform) =>
      devicesConfig.devices.find((device) => device.platform === platform),
    )
    .filter(Boolean)
}

async function recordOnDevice(deps, run, device) {
  const journeys = run.journeys.filter((journey) =>
    journey.platforms.includes(device.platform),
  )
  if (journeys.length === 0) return
  run.server.setLaneDevice(device.lane, device.id)
  const handle = await session.openDevice(deps, device, {
    logFile: path.join(run.recordDir, `${device.id}-emulator.log`),
  })
  let booted = null
  try {
    booted = await handle.boot()
    if (!booted.ok) {
      run.journeyFailures.push({
        deviceId: device.id,
        journey: null,
        error: `the device did not start: ${booted.error}`,
      })
      return
    }
    if (device.platform === "android") {
      const installed = await handle.install(run.build.artifacts.android)
      if (!installed.ok) {
        run.journeyFailures.push({
          deviceId: device.id,
          journey: null,
          error: `the app install failed: ${installed.error}`,
        })
        return
      }
    }
    for (const journey of journeys) {
      if (run.signal.aborted) return
      const attempt = await session.runJourneyOnce(deps, {
        device,
        handle,
        flowFile: journey.file,
        outputDir: path.join(run.recordDir, "attempts", journey.id, device.id),
        artifacts: run.build.artifacts,
        serverLog: run.logPath,
        signal: run.signal,
      })
      run.log(
        `${journey.id} on ${device.id} ${attempt.passed ? "passed" : `failed (${attempt.class ?? "no class"}) at ${attempt.failedStep ?? "the start"}`}`,
      )
      if (!attempt.passed) {
        run.journeyFailures.push({
          deviceId: device.id,
          journey: journey.id,
          class: attempt.class,
          failedStep: attempt.failedStep,
          error: attempt.error ?? null,
          screenshot: attempt.screenshot,
        })
      }
    }
  } finally {
    if (booted?.refused !== true) {
      const stopped = await handle.shutdown()
      if (!stopped.ok) run.log(`${device.id} did not stop: ${stopped.error}`)
    }
    run.server.setLaneDevice(device.lane, null)
  }
}

async function recordSearchCommand(command, deps = createRecordDeps()) {
  let adminUrl
  try {
    adminUrl = localAdminUrl(
      command.flags?.["admin-url"] ??
        deps.env[ADMIN_URL_ENV] ??
        DEFAULT_RECORD_ADMIN_URL,
    )
  } catch (error) {
    if (!(error instanceof RecordRefusal)) throw error
    return refuseMode(deps, error.message)
  }
  const rules = journeyRulesRefusal(deps.journeysDir)
  if (rules) return refuseMode(deps, rules)
  if (searchJourneys(deps).length === 0) {
    return refuseMode(
      deps,
      `no top-level journey has the \`${SEARCH_TAG}\` tag`,
    )
  }
  // A take-over would remove the lock that `recover` reads.
  const stale = refuseStaleLock(deps, await deps.lock.inspect(), "the record")
  if (stale !== null) return stale
  const recordId = runFolder.newRunId(new Date(deps.now()), deps.randomHex())
  const taken = await deps.lock.acquire({
    mode: "record-search",
    runId: recordId,
    pid: deps.pid,
  })
  if (!taken.ok) {
    return refuseMode(
      deps,
      `another release check holds the lock (${holderText(taken.lock, { withRun: false })})`,
    )
  }
  const recordDir = path.join(deps.home, RECORDS_DIR, recordId)
  fs.mkdirSync(recordDir, { recursive: true })
  const abort = new AbortController()
  const onSignal = () => abort.abort()
  deps.signals.on("SIGINT", onSignal)
  deps.signals.on("SIGTERM", onSignal)
  const recorder = createSearchRecorder({
    adminUrl,
    post: deps.post,
    now: deps.now,
  })
  const run = {
    journeys: [],
    recordDir,
    logPath: path.join(recordDir, runFolder.SERVER_LOG),
    signal: abort.signal,
    journeyFailures: [],
    server: null,
    build: null,
    log: (text) => {
      fs.appendFileSync(
        path.join(recordDir, RECORD_LOG),
        `${new Date(deps.now()).toISOString()} ${text}\n`,
      )
      deps.err(`[record-search] ${text}`)
    },
  }
  let failure = null
  let checks = { checked: 0, refusals: [] }
  try {
    // The build takes minutes and the checkout can change, so the record runs
    // the copy that it checked, as a run does.
    const copy = path.join(recordDir, JOURNEYS_COPY_DIR)
    copyJourneys(deps.journeysDir, copy)
    const copyRules = journeyRulesRefusal(copy)
    if (copyRules) throw new RecordRefusal("JOURNEY_RULES", copyRules)
    run.journeys = searchJourneys({ ...deps, journeysDir: copy })
    const devices = firstDevicePerPlatform(deps.config.devices)
    run.build = await session.checkedBuild(deps, {
      platforms: devices.map((device) => device.platform),
      signal: abort.signal,
    })
    const lanes = devices.map((device) => ({
      port: session.lanePort(deps.config.settings, device.lane),
      lane: device.lane,
    }))
    runFolder.writeRunFile(recordDir, {
      recordId,
      devices: devices.map((device) => device.id),
    })
    run.server = deps.server.create({
      lanes,
      operations: deps.config.operations,
      searchAnswers: { schemaVersion: 1, answers: [] },
      answerSearchRequest: recorder.answerSearchRequest,
      adminSchemaSdl: await deps.git.show(run.build.commit, ADMIN_SCHEMA_PATH),
      logPath: run.logPath,
      onUpstreamUnavailable: () => {
        run.log("5 forwarded reads in a row failed; the record stops")
        abort.abort()
      },
    })
    await run.server.bind()
    run.server.startAnswering()
    run.log(`recording searches from ${adminUrl}`)
    for (const device of devices) {
      if (abort.signal.aborted) break
      await recordOnDevice(deps, run, device)
    }
    if (!abort.signal.aborted && run.journeyFailures.length === 0) {
      checks = await checkResults(recorder.entries(), {
        serverUrl: `http://127.0.0.1:${lanes[0].port}/api/graphql`,
        locales: adminLocales(deps.mobileDir),
        post: deps.post,
        sleep: deps.sleep,
        signal: abort.signal,
      })
    }
  } catch (error) {
    failure = error
  } finally {
    if (run.server) await run.server.close().catch(() => {})
    deps.signals.off("SIGINT", onSignal)
    deps.signals.off("SIGTERM", onSignal)
    taken.release()
  }

  const answers = recorder.entries()
  const problems = [
    ...(failure
      ? [`${failure.code ?? "RECORD_FAILED"}: ${failure.message}`]
      : []),
    ...(abort.signal.aborted ? ["the record was stopped"] : []),
    ...run.journeyFailures.map(
      (item) =>
        `${item.journey ?? "the device"} on ${item.deviceId}: ${item.error ?? item.class}`,
    ),
    ...recorder
      .failures()
      .map(
        (item) =>
          `the search ${JSON.stringify(item.search.query)} was not recorded: ${item.reason}`,
      ),
    ...checks.refusals.map(
      (item) =>
        `${item.type} result ${item.slug}${item.locale ? ` (${item.locale})` : ""} of the search ${item.queries.map((query) => JSON.stringify(query)).join(", ")}: ${item.reason}`,
    ),
  ]
  if (!failure && answers.length === 0 && problems.length === 0) {
    problems.push("the search journeys sent no search")
  }
  const file = path.join(deps.configDir, ANSWERS_FILE)
  if (problems.length === 0) {
    await writeSearchAnswers(file, {
      answers,
      documentDigest: currentWatchSearchDigest(deps.mobileDir),
    })
  }
  // The record folder must explain the outcome without the stdout JSON.
  for (const problem of problems) run.log(`problem: ${problem}`)
  run.log(
    problems.length === 0
      ? `wrote ${answers.length} answers to ${file} (${checks.checked} results checked)`
      : `wrote nothing, because of ${problems.length} problem(s)`,
  )
  deps.out(
    JSON.stringify(
      {
        result: problems.length === 0 ? "recorded" : "failed",
        file: problems.length === 0 ? file : null,
        answers: answers.length,
        checked: checks.checked,
        problems,
        recordDir,
      },
      null,
      2,
    ),
  )
  return problems.length === 0 ? EXIT.passed : EXIT.failed
}

module.exports = {
  adminLocales,
  checkResults,
  createRecordDeps,
  localAdminUrl,
  postJson,
  recordSearchCommand,
}
