#!/usr/bin/env tsx
/**
 * The owner's note on a message-first script, applied by the writer (feat-572:
 * "keep the message, give a note, the text is rewritten"). Only the sentences
 * the note concerns change; roles, credits and voices are kept; the quality
 * gate runs again and the script sheet is rewritten. The previous devo.json
 * and script are kept.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/revise-devotional.ts --source=lumo-luke-15 \
 *     --note="…" --out=<new script .txt>
 */
import { existsSync } from "node:fs"
import { copyFile } from "node:fs/promises"
import path from "node:path"

import {
  cacheDirFor,
  loadCachedDevo,
  saveCachedDevo,
} from "../services/devotional/devotional-cache"
import { modelFor } from "../services/devotional/devotional-models"
import { reviewDevotionalText } from "../services/devotional/devotional-quality-gate"
import type { ReflectionParagraph } from "../services/devotional/generate-devotional"
import { stripDashes } from "../services/devotional/generate-devotional"
import { createDevotionalLlm } from "../services/devotional/llm"
import { reviseMessageFirstReflection } from "../services/devotional/message-first-writer"
import {
  ancientEntry,
  loadReferenceCorpora,
  verifyQuote,
} from "../services/devotional/reference-corpus"
import { videoSource } from "../services/devotional/video-sources"

const arg = (name: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=")

async function main() {
  const src = videoSource(arg("source") ?? "")
  const note = arg("note")
  if (!src || !note)
    throw new Error("--source=<key> and --note=<text> are required")
  const dir = cacheDirFor(src.index, Number(arg("seq") ?? "0"))
  const devo = await loadCachedDevo(dir)
  const paragraphs = devo?.reflection.paragraphs ?? []
  if (!devo?.message || !paragraphs.every((p) => p.role)) {
    throw new Error(
      "revise works on message-first devotionals (tagged paragraphs)",
    )
  }
  // --history=Sir.19.30,Sir.33.19-Sir.33.23: verified source texts for a
  // historical paragraph the note asks for, with its on-screen credit.
  const corpora = loadReferenceCorpora()
  // --history=Sir.33.19-Sir.33.23 (an ancient text) and/or
  // --work="Edersheim:4.17#<verbatim words>" (a passage of a longer work,
  // checked word for word and handed over with its whole paragraph).
  const history = (arg("history") ?? "")
    .split(",")
    .filter(Boolean)
    .map((r) => {
      const e = ancientEntry(corpora, r.trim())
      if (!e) throw new Error(`--history: ${r} is not in the corpora`)
      return { ...e, text: `(King James Version) ${e.text}` }
    })
  for (const w of process.argv.filter((a) => a.startsWith("--work="))) {
    const [id, quote] = w.slice("--work=".length).split("#")
    const e = corpora.dictionaries.find((d) => d.id === id)
    if (!e || !quote) throw new Error(`--work: ${id} is not in the corpora`)
    const para = e.text.split(/\n{2,}/).find((p) => verifyQuote(quote, p))
    if (!para) throw new Error(`--work: “${quote}” is not in ${id}`)
    history.push({
      ...e,
      id: `${e.source}, ${e.term.toLowerCase()}`,
      text: para,
    })
  }
  const problems = [`The owner's note: ${note}`]
  if (history.length) {
    problems.push(
      "HISTORY SOURCES for that paragraph (role 'history'; verified; quote only their exact words, or paraphrase without quotation marks, and do not name the book aloud, it is credited on screen):",
      ...history.map((e) => `${e.id}: ${e.text}`),
    )
  }
  const written = await reviseMessageFirstReflection({
    paragraphs: paragraphs.map((p) => ({ role: p.role!, text: p.text })),
    problems,
    message: {
      ...devo.message,
      classicPoints: devo.message.classicPoints ?? [],
    },
    passageReference: src.passage.reference,
    passageText: devo.clipTranscript ?? "",
    classicName: devo.reflection.source,
    classicPoints: [devo.reflection.sourceExcerpt ?? ""],
    llm: createDevotionalLlm({ model: modelFor("modernizer") }),
  })
  // Credits and voices follow the roles, as the composer builds them: each
  // section keeps the credit it had, on its first paragraph.
  const markOf = new Map(
    paragraphs.filter((p) => p.mark).map((p) => [p.role, p.mark!]),
  )
  // New sources replace the section's old credit.
  if (history.length) {
    markOf.set("history", {
      label: "Historical context",
      source: [...new Set(history.map((e) => e.source.replace(/\s*\(.*$/, "")))]
        .map((x) => (x.startsWith("Edersheim") ? "Alfred Edersheim (1883)" : x))
        .join(" · "),
      portrait: "book",
      evidence: history.map((e) => `${e.id}: ${e.text}`).join("\n\n"),
    })
  }
  const depthVoice = paragraphs.find((p) => p.role === "language")?.voice
  const voiceOf = new Map(paragraphs.map((p) => [p.role, p.voice]))
  const credited = new Set<string>()
  const next: ReflectionParagraph[] = written.map((w) => {
    const mark = !credited.has(w.role) ? markOf.get(w.role) : undefined
    if (mark) credited.add(w.role)
    const voice =
      voiceOf.get(w.role) ??
      (w.role === "history" ? depthVoice : undefined) ??
      devo.voice
    return {
      text: stripDashes(w.text),
      role: w.role,
      ...(voice ? { voice } : {}),
      ...(mark ? { mark } : {}),
    }
  })
  for (const [i, p] of next.entries()) {
    if (p.text !== paragraphs[i]?.text)
      console.log(
        `¶${i} changed:\n  − ${paragraphs[i]?.text ?? "(new)"}\n  + ${p.text}`,
      )
  }
  const revised = {
    ...devo,
    reflection: {
      ...devo.reflection,
      paragraphs: next,
      text: next.map((p) => p.text).join(" "),
    },
  }
  const review = await reviewDevotionalText({
    devotional: revised,
    passageReference: src.passage.reference,
    checkFidelity: true,
    lang: "en",
    log: (m) => console.log(m),
  })
  const cached = path.join(dir, "devo.json")
  if (existsSync(cached))
    await copyFile(cached, path.join(dir, `devo.before-${Date.now()}.json`))
  await saveCachedDevo(dir, revised)
  console.log(`wrote ${cached}`)
  console.log(
    review.blocking.length
      ? `⛔ gate: ${review.blocking.join("; ")}`
      : "gate passed",
  )
}

main().catch((e) => {
  console.error("revise-devotional failed:", e instanceof Error ? e.stack : e)
  process.exit(1)
})
