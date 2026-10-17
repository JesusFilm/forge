"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
// Local modes of translate-catalogs.mjs: web's real script sends its requests to
// 127.0.0.1, where the export records them and the import answers from a Claude
// session's files. Web's script then checks and writes, as on a paid run.

const fs = require("fs")
const http = require("http")
const path = require("path")
const { parse } = require("@formatjs/icu-messageformat-parser")
const { pluralOperationError } = require("./catalogChecks")

const INDEX_FILE = "index.json"
const REPORT_FILE = "import-report.json"
const LOCALE_TAG = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/
const RETRY_SUFFIX = "\n\nThe previous response failed validation"

class LocalTranslationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "LocalTranslationError"
    this.code = code
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function localeFile(dir, locale, kind) {
  if (!LOCALE_TAG.test(locale)) {
    throw new LocalTranslationError(
      "INVALID_LOCALE_TAG",
      `Not a catalog tag: ${JSON.stringify(locale)}`,
    )
  }
  return path.join(dir, `${locale}.${kind}.json`)
}

function requestFile(dir, locale) {
  return localeFile(dir, locale, "request")
}

function answerFile(dir, locale) {
  return localeFile(dir, locale, "answer")
}

/** The system prompt, the user prompt, and the target locale of one request. */
function parseChatRequest(body) {
  const payload = JSON.parse(body)
  const content = (role) =>
    Array.isArray(payload?.messages)
      ? payload.messages.find((message) => message?.role === role)?.content
      : undefined
  const system = content("system")
  const user = content("user")
  if (typeof system !== "string" || typeof user !== "string") {
    throw new LocalTranslationError(
      "NOT_A_CHAT_REQUEST",
      "The request has no system and user message",
    )
  }
  const prompt = JSON.parse(user.split(RETRY_SUFFIX)[0])
  if (
    !isPlainObject(prompt) ||
    typeof prompt.targetLocale !== "string" ||
    !isPlainObject(prompt.messagesToTranslate)
  ) {
    throw new LocalTranslationError(
      "NOT_A_TRANSLATION_REQUEST",
      "The user prompt has no targetLocale and messagesToTranslate",
    )
  }
  return { locale: prompt.targetLocale, system, prompt }
}

function sendJson(response, status, value) {
  response.statusCode = status
  response.setHeader("content-type", "application/json")
  response.end(JSON.stringify(value))
}

// Only web's script holds the run's token, and a browser always sends Origin,
// so any other sender gets 401 and writes no file. A throw from `answer` goes
// to `onError`, and the reply then holds no translation, so web fails it.
async function startChatServer({ token, answer, onError }) {
  const server = http.createServer((request, response) => {
    if (
      request.headers.authorization !== `Bearer ${token}` ||
      request.headers.origin !== undefined
    ) {
      request.resume()
      onError(
        new LocalTranslationError(
          "UNAUTHORIZED_REQUEST",
          "The local server refused a request that did not carry this run's token",
        ),
      )
      sendJson(response, 401, {
        error: { message: "Only the translation command may call this server" },
      })
      return
    }
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => {
      let translations = []
      try {
        translations = answer(parseChatRequest(body))
      } catch (error) {
        onError(error)
      }
      sendJson(response, 200, {
        choices: [{ message: { content: JSON.stringify({ translations }) } }],
        usage: {},
      })
    })
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise((done) => server.close(done)),
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function writeRequestFile(dir, request) {
  writeJson(requestFile(dir, request.locale), {
    locale: request.locale,
    system: request.system,
    prompt: request.prompt,
  })
  return Object.keys(request.prompt.messagesToTranslate)
}

function readJsonFile(file, label) {
  let text
  try {
    text = fs.readFileSync(file, "utf8")
  } catch (error) {
    throw new LocalTranslationError(
      "MISSING_FILE",
      `No ${label} at ${file}: ${error.message}`,
    )
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new LocalTranslationError(
      "INVALID_JSON",
      `The ${label} at ${file} is not valid JSON: ${error.message}`,
    )
  }
}

/** What the export recorded for one locale: English, contexts, and system prompt. */
function readExportedRequest(dir, locale) {
  const request = readJsonFile(requestFile(dir, locale), "request file")
  const english = request?.prompt?.messagesToTranslate
  if (!isPlainObject(english) || typeof request.system !== "string") {
    throw new LocalTranslationError(
      "INVALID_REQUEST_FILE",
      `${requestFile(dir, locale)} is not a request file; export again`,
    )
  }
  const contexts = request.prompt.messageContexts
  return {
    english,
    contexts: isPlainObject(contexts) ? contexts : {},
    system: request.system,
  }
}

function readAnswer(dir, locale) {
  const answer = readJsonFile(answerFile(dir, locale), "answer file")
  if (!isPlainObject(answer)) {
    throw new LocalTranslationError(
      "INVALID_ANSWER_FILE",
      `${answerFile(dir, locale)} must be a JSON object that maps each key to its translation`,
    )
  }
  return answer
}

function icuSyntaxError(key, value) {
  try {
    parse(value)
    return null
  } catch (error) {
    return `ICU syntax error: ${key}: ${error.message}`
  }
}

// Lists every problem, not only the first one that web names. A key is stale
// when its English, its context, or the system prompt differs from the export.
// The plural and ICU syntax checks are the mobile-only ones the format suite runs.
function checkAnswer({ locale, request, exported, answer, web }) {
  const problems = []
  const translations = []
  const contexts = request.prompt.messageContexts ?? {}
  const sameSystem = exported.system === request.system
  for (const [key, english] of Object.entries(
    request.prompt.messagesToTranslate,
  )) {
    const stale =
      !sameSystem ||
      exported.english[key] !== english ||
      JSON.stringify(exported.contexts[key]) !== JSON.stringify(contexts[key])
    if (stale) {
      problems.push(
        `${key}: the export did not record this key with its current English and context; export again into a new folder`,
      )
      continue
    }
    const value = answer[key]
    if (typeof value !== "string") {
      problems.push(`${key}: the answer file has no translation`)
      continue
    }
    const problem =
      web.messageContractError(key, english, value) ??
      pluralOperationError(key, english, value) ??
      icuSyntaxError(key, value) ??
      (web.isSourceEquivalent(english, value)
        ? `${key}: the translation equals the English`
        : null) ??
      web.explicitScriptContractError(locale, { [key]: value })
    if (problem) problems.push(problem)
    else translations.push({ key, value })
  }
  // A locale with a problem gets no translation, so web's script writes nothing.
  return problems.length
    ? { translations: [], problems }
    : { translations, problems }
}

// Every exported locale fails in web by design, so web's own failure text is
// the least useful reason for a missing request file and comes last.
function exportFailureReason({
  locale,
  writeErrors,
  serverErrors,
  failures,
  errorLines,
}) {
  return (
    writeErrors[locale] ??
    serverErrors[0] ??
    (errorLines.join(" ").slice(0, 300) || failures.get(locale)) ??
    "web's script sent no request"
  )
}

function writeIndex(dir, index) {
  writeJson(path.join(dir, INDEX_FILE), index)
}

function readIndex(dir) {
  const index = readJsonFile(path.join(dir, INDEX_FILE), "export index")
  if (!isPlainObject(index) || !isPlainObject(index.locales)) {
    throw new LocalTranslationError(
      "INVALID_EXPORT_INDEX",
      `${path.join(dir, INDEX_FILE)} is not an export index; export again`,
    )
  }
  return index
}

function writeReport(dir, report) {
  const file = path.join(dir, REPORT_FILE)
  writeJson(file, report)
  return file
}

module.exports = {
  INDEX_FILE,
  REPORT_FILE,
  LocalTranslationError,
  answerFile,
  checkAnswer,
  exportFailureReason,
  parseChatRequest,
  readAnswer,
  readExportedRequest,
  readIndex,
  requestFile,
  startChatServer,
  writeIndex,
  writeReport,
  writeRequestFile,
}
