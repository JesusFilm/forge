/**
 * TEXT-ONLY localization preview: take a finished ENGLISH devotional and produce
 * the target-language TEXT edition (translate copy with the faithful two-pass +
 * real target-language scripture), with NO audio and NO video render. For
 * iterating on translation quality before spending a render.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/devo-localize-text.ts --chapter=19 --seq=0 --lang=ru
 *
 * Writes the localized text to the -<lang> cache (so a later audio/video run
 * reuses it) and to a readable .md under Devos for review. Pass --retranslate
 * to ignore any cached localized text and translate fresh.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import {
  getDevotionalModel,
  getDevotionalTranslateModel,
} from "../config/env"
import {
  cacheDirFor,
  loadCachedDevo,
  saveCachedDevo,
} from "../services/devotional/devotional-cache"
import {
  localeFor,
  type DevotionalLang,
} from "../services/devotional/devotional-locale"
import {
  generateDevotional,
  type GeneratedDevotional,
} from "../services/devotional/generate-devotional"
import { localizeDevotional } from "../services/devotional/localize-devotional"
import { buildDevotionalAgentLlms } from "../services/devotional/devotional-models"
import { createDevotionalLlm } from "../services/devotional/llm"

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function render(d: GeneratedDevotional, lang: string): string {
  return [
    `# Devotional (${lang}) — ${d.clip.title}`,
    ``,
    `## Заголовок (cover)`,
    d.title,
    ``,
    `## Писание — ${d.scripture.reference} (${d.scripture.translation ?? ""})`,
    d.scripture.text,
    ``,
    `## Размышление (reflection)`,
    d.reflection.text,
    ``,
    `_Атрибуция (показывается на обложке, не читается в размышлении): ${d.reflection.attribution}_`,
    ``,
    `## Вывод (conclusion)`,
    d.conclusion,
    ``,
    `## Вопрос (question)`,
    d.question,
    ``,
    `## Молитва (prayer)`,
    d.prayer,
    ``,
  ].join("\n")
}

async function main() {
  const chapterIndex = Number(arg("chapter", "19"))
  const sequence = Number(arg("seq", "0"))
  const lang = arg("lang", "ru") as DevotionalLang
  const retranslate = process.argv.includes("--retranslate")
  const locale = localeFor(lang)
  const llm = createDevotionalLlm({ model: getDevotionalModel() })
  // Stronger model for translation/adaptation into natural target language.
  const translateModel = getDevotionalTranslateModel()
  const translateLlm = createDevotionalLlm({ model: translateModel })
  console.log(`content model: ${getDevotionalModel()} | translate model: ${translateModel}`)

  // Source English devotional (reuse the cache, else generate it fresh).
  const enDir = cacheDirFor(chapterIndex, sequence)
  let en = retranslate ? null : await loadCachedDevo(enDir)
  if (!en) {
    en = await generateDevotional({
      chapterIndex,
      sequence,
      date: new Date().toISOString().slice(0, 10),
      llm,
      llms: buildDevotionalAgentLlms(),
    })
    await saveCachedDevo(enDir, en)
  }

  // Localize to the target language (skip when English).
  let localized: GeneratedDevotional
  if (lang === "en") {
    localized = en
  } else {
    const dir = cacheDirFor(chapterIndex, sequence, lang)
    const cached = retranslate ? null : await loadCachedDevo(dir)
    localized =
      cached ??
      (await localizeDevotional({ devotional: en, locale, llm, translateLlm }))
    await saveCachedDevo(dir, localized)
  }

  const out = render(localized, lang)
  console.log("\n" + out)

  const outDir = path.join(
    homedir(),
    "Desktop",
    "Devos",
    "devotional-video",
    "text",
  )
  await mkdir(outDir, { recursive: true })
  const file = path.join(outDir, `ch${chapterIndex}-seq${sequence}-${lang}.md`)
  await writeFile(file, out, "utf-8")
  console.log(`\n📄 ${file}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
