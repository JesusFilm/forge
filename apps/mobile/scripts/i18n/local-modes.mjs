// The local modes of translate-catalogs.mjs (plan KD5 amendment): a Claude
// session writes the answers, and web's real script checks and writes them.
// `core` holds the command's shared steps, so both run modes stay in step.

import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
const ops = require("./lib/catalogOps.js")
const local = require("./lib/localTranslation.js")
const { plural } = require("./lib/scriptFormat.js")

// Web's script needs a model name; the local server reads none.
const LOCAL_WEB_MODEL = "local-translation"
export const ANSWER_FORMAT =
  "Write <locale>.answer.json as a JSON object that maps each key in prompt.messagesToTranslate to its translation. `system` and `prompt` are the exact instructions that the paid model gets."

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]))
}

// Web's script reaches only the local server, and it sends the run's token in
// place of any real key, so no request and no key leaves the computer.
function localEnv(url, token) {
  return { ...process.env, OPENAI_BASE_URL: url, OPENAI_API_KEY: token }
}

function existingAncestor(dir) {
  let probe = dir
  while (!fs.existsSync(probe)) probe = path.dirname(probe)
  return probe
}

// Resolves symlinks first, then asks git, so a case variant or the main
// checkout around a worktree also counts as inside a repository.
function insideRepository(repo, dir) {
  const probe = existingAncestor(dir)
  const real = path.join(fs.realpathSync(probe), path.relative(probe, dir))
  const fromRepo = path.relative(fs.realpathSync(repo), real)
  const outside =
    fromRepo === ".." ||
    fromRepo.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromRepo)
  if (!outside) return true
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  )
  const git = spawnSync(
    "git",
    ["-C", probe, "rev-parse", "--is-inside-work-tree"],
    { encoding: "utf8", env },
  )
  return git.status === 0 && git.stdout.trim() === "true"
}

/** The local export and import modes, bound to the command's shared steps. */
export function createLocalModes(core) {
  // A file in a git work tree is untracked, and an untracked file stops
  // `eas update` (cli.requireCommit), so the work folder stays outside.
  function localWorkDir(value, { forExport }) {
    const dir = path.resolve(value)
    if (insideRepository(core.REPO, dir)) {
      throw new core.CommandError(
        "WORK_DIR_IN_REPOSITORY",
        `No file changed. Put the work folder outside every git repository, for example under $TMPDIR: ${dir}`,
      )
    }
    if (forExport && fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      throw new core.CommandError(
        "WORK_DIR_NOT_EMPTY",
        `No file changed. ${dir} is not empty. Export into a new folder, so that no old request mixes in.`,
      )
    }
    return dir
  }

  async function runLocalExport(options, paths) {
    const dir = localWorkDir(options.localExport, { forExport: true })
    const plan = await core.buildPlan(options, paths, LOCAL_WEB_MODEL)
    if (core.estimate(plan, options).requests === 0)
      return core.finishUpToDate(paths, plan)
    core.printPlan(plan, options, { local: true })
    core.assertWebFlags(paths)

    await core.writeState(paths, plan.state, plan.contexts)
    fs.mkdirSync(dir, { recursive: true })
    const token = crypto.randomUUID()
    const captured = {}
    const writeErrors = {}
    const serverErrors = []
    const server = await local.startChatServer({
      token,
      answer: (request) => {
        try {
          captured[request.locale] = local.writeRequestFile(dir, request)
        } catch (error) {
          writeErrors[request.locale] = error.message
        }
        return []
      },
      onError: (error) => serverErrors.push(error.message),
    })
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "forge-mobile-ui-"))
    const [group] = plan.groups
    let run
    try {
      run = await core.runWebScript(
        paths,
        { ...group, progress: path.join(scratch, "progress.json") },
        { ...options, maxAttempts: 1 },
        { env: localEnv(server.url, token), quiet: true },
      )
    } finally {
      await server.close()
      fs.rmSync(scratch, { recursive: true, force: true })
    }

    const locales = Object.keys(group.keysByLocale)
    const exported = locales.filter((locale) => captured[locale])
    local.writeIndex(dir, {
      createdOn: core.today(),
      englishDigest: ops.contentDigest(plan.state.source),
      answerFormat: ANSWER_FORMAT,
      locales: pick(captured, exported),
    })
    const lines = [
      `Wrote ${plural(exported.length, "request file")} and ${local.INDEX_FILE} to ${dir}.`,
      ANSWER_FORMAT,
      `Then run: node scripts/i18n/translate-catalogs.mjs --local-import ${dir} --translator <claude-model-id>`,
    ]
    const missing = locales.filter((locale) => !captured[locale])
    if (missing.length) {
      lines.push(`No request for ${plural(missing.length, "locale")}:`)
      for (const locale of missing) {
        const reason = local.exportFailureReason({
          locale,
          writeErrors,
          serverErrors,
          failures: run.failures,
          errorLines: run.errorLines,
        })
        lines.push(`  ${locale}: ${reason}`)
      }
    }
    console.log(lines.join("\n"))
    core.remindCatalogIndex(plan)
    return missing.length ? 1 : 0
  }

  async function runLocalImport(options, paths) {
    const dir = localWorkDir(options.localImport, { forExport: false })
    let index
    try {
      index = local.readIndex(dir)
    } catch (error) {
      throw core.withCode(error, "INVALID_EXPORT")
    }
    const exportedLocales = Object.keys(index.locales)
    if (exportedLocales.length === 0) {
      throw new core.CommandError(
        "NO_EXPORTED_LOCALES",
        `No file changed. ${dir} holds no request file; export again.`,
      )
    }
    // Without --locales, the import covers only the exported locales, so it
    // seeds no other catalog.
    const scope = {
      ...options,
      locales: options.locales ?? exportedLocales.join(","),
    }
    const plan = await core.buildPlan(scope, paths, options.translator)
    if (core.estimate(plan, options).requests === 0)
      return core.finishUpToDate(paths, plan)
    const [group] = plan.groups
    const planned = Object.keys(group.keysByLocale)
    const answered = planned.filter((locale) =>
      fs.existsSync(local.answerFile(dir, locale)),
    )
    if (answered.length === 0) {
      throw new core.CommandError(
        "NO_ANSWER_FILES",
        `No file changed. ${dir} has no answer file for the ${plural(planned.length, "locale")} that need a translation.`,
        1,
      )
    }
    core.printPlan(plan, options, { local: true })
    core.assertWebFlags(paths)
    if (index.englishDigest !== ops.contentDigest(plan.state.source)) {
      console.warn(
        "en.json changed after the export. Each key whose English or context changed fails; export those locales again into a new folder.",
      )
    }
    const web = await import(pathToFileURL(paths.webTranslator).href)

    await core.writeState(paths, plan.state, plan.contexts)
    const token = crypto.randomUUID()
    const problems = {}
    const serverErrors = []
    const server = await local.startChatServer({
      token,
      answer: (request) => {
        let result
        try {
          result = local.checkAnswer({
            locale: request.locale,
            request,
            exported: local.readExportedRequest(dir, request.locale),
            answer: local.readAnswer(dir, request.locale),
            web,
          })
        } catch (error) {
          result = { translations: [], problems: [error.message] }
        }
        if (result.problems.length) problems[request.locale] = result.problems
        return result.translations
      },
      onError: (error) => serverErrors.push(error.message),
    })
    let run
    try {
      run = await core.runWebScript(
        paths,
        {
          ...group,
          model: LOCAL_WEB_MODEL,
          keysByLocale: pick(group.keysByLocale, answered),
        },
        { ...options, maxAttempts: 1 },
        { env: localEnv(server.url, token), quiet: true },
      )
    } finally {
      await server.close()
    }
    // Quiet hides web's lines; show them when web stopped before any locale.
    if (run.status !== 0 && run.failures.size === 0) {
      for (const line of run.errorLines) console.error(`[web] ${line}`)
    }
    for (const message of new Set(serverErrors))
      console.error(`Local server: ${message}`)

    const results = [
      ...answered.map((locale) => ({
        locale,
        model: options.translator,
        details: problems[locale],
        ...core.localeStatus(paths, plan, locale, run.failures),
      })),
      ...planned
        .filter((locale) => !answered.includes(locale))
        .map((locale) => ({
          locale,
          model: options.translator,
          status: "noAnswer",
        })),
    ]
    const code = await core.finishRun(paths, plan, results)
    const report = local.writeReport(dir, {
      importedOn: core.today(),
      translator: options.translator,
      locales: Object.fromEntries(
        results.map((r) => [
          r.locale,
          r.status === "failed"
            ? { status: r.status, problems: r.details ?? [r.message] }
            : { status: r.status },
        ]),
      ),
    })
    console.log(`Full report, with every problem: ${report}`)
    return code
  }

  return { runLocalExport, runLocalImport }
}
