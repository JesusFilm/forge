/**
 * TODAY's devotional, fully automatic: the agent goes to the JESUS-film library,
 * picks an unused mapped clip (no topic chosen by hand), generates + localizes,
 * and renders BOTH formats — 9:16 mobile (portrait) and 16:9 desktop (wide) —
 * with the approved narration recipe. Defaults to Russian.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/render-daily-devotional.ts            # ru, today, both formats
 *     ... --lang=ru --chapter=42   # pin a chapter instead of auto-pick
 *     ... --record                 # mark the clip used so tomorrow picks a new one
 *
 * The audio is produced once (portrait) and REUSED for the wide render, so both
 * formats share the exact same narration.
 */
import { homedir } from "node:os"
import path from "node:path"

import { getDevotionalModel, getDevotionalTranslateModel } from "../config/env"
import { prepareAndRenderDevotional } from "../services/devotional/devotional-render"
import { type DevotionalLang } from "../services/devotional/devotional-locale"
import { JESUS_FILM_CHAPTERS } from "../services/devotional/jesus-film-catalog"
import {
  chapterWithPassage,
  mappedChapterIndices,
} from "../services/devotional/jesus-film-passages"
import {
  hasReflectionSource,
  loadReflectionCorpora,
} from "../services/devotional/reflection-corpus"
import { createDevotionalLlm } from "../services/devotional/llm"
import { calendarEntryFor } from "../services/devotional/devotional-calendar"
import {
  chooseChapter,
  createUsedClipsStore,
} from "../services/devotional/used-clips-ledger"

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

async function main() {
  const lang = arg("lang", "ru") as DevotionalLang
  const date = arg("date", new Date().toISOString().slice(0, 10))!
  const record = process.argv.includes("--record")
  const outDir = path.join(homedir(), "Desktop", "Devos", "Devotionals")

  const store = createUsedClipsStore()
  const ledger = await store.read()

  // The library: JESUS-film chapters that have a curated passage mapping AND a
  // commentary that actually covers that passage. The corpora are Gospel-only
  // (Ryle on Matthew/Luke, Matthew Henry on Mark/John), so a chapter drawing on
  // non-Gospel material — the film opens with GENESIS creation content — has
  // nothing to adapt and dies mid-run with "no reflection source". Filtering
  // here means such a chapter is never picked in the first place.
  const corpora = loadReflectionCorpora()
  const pool = mappedChapterIndices()
    .map((i) => JESUS_FILM_CHAPTERS[i - 1])
    .filter(Boolean)
    .filter((c) => {
      const passage = chapterWithPassage(c.index)
      return passage != null && hasReflectionSource(passage.osisRef, corpora)
    })
  if (pool.length === 0) {
    throw new Error(
      "no chapter has both a curated passage and a commentary covering it",
    )
  }

  // Pick the clip: an explicit --chapter wins; else the editorial calendar
  // (a specific chapter planned for THIS date, e.g. the August plan) wins;
  // otherwise the agent chooses an unused one (never-used first, then
  // least-recently-used).
  const pinned = arg("chapter")
  const calendarEntry = pinned ? null : calendarEntryFor(date)
  const chapter = pinned
    ? pool.find((c) => c.index === Number(pinned))
    : calendarEntry
      ? pool.find((c) => c.index === calendarEntry.chapterIndex)
      : chooseChapter(pool, ledger.used)
  if (!chapter) throw new Error(`no mapped chapter for --chapter=${pinned}`)

  // Sequence advances voice/reflection-source rotation. A calendar day uses
  // its PINNED sequence (stable regardless of how many other devotionals get
  // approved between now and then — a pre-rendered cache for that date stays
  // valid); otherwise the count of prior recorded uses (matches the
  // workflow's auto-sequence).
  const sequence =
    calendarEntry?.sequence ??
    Object.values(ledger.used).reduce((s, e) => s + e.count, 0)

  const reference = chapterWithPassage(chapter.index)?.reference ?? ""
  console.log(
    `📖 today's clip: ch${chapter.index} "${chapter.title}" (${reference}) — seq ${sequence}, ${lang}, ${date}`,
  )

  const llm = createDevotionalLlm({ model: getDevotionalModel() })
  const translateLlm = createDevotionalLlm({
    model: getDevotionalTranslateModel(),
  })

  // Render both aspects. Portrait first produces + caches the audio; wide reuses
  // it (same narration in both). Text is cached after the first render too.
  const results: Record<string, string> = {}
  for (const aspect of ["portrait", "wide"] as const) {
    const { videoPath } = await prepareAndRenderDevotional({
      chapterIndex: chapter.index,
      sequence,
      date,
      llm,
      translateLlm,
      lang,
      outDir,
      aspect,
      log: (m) => console.log(`[${aspect}] ${m}`),
    })
    // The daily job never asks for the review stop, so a null path here would
    // mean the contract changed under us rather than a run we chose to pause.
    if (videoPath === null) {
      throw new Error(
        `daily render returned no video for ${aspect} (review stop is not used by the daily job)`,
      )
    }
    results[aspect] = videoPath
  }

  if (record) {
    await store.record(chapter.id).catch(() => undefined)
    console.log(`recorded ch${chapter.index} as used`)
  }

  console.log(`\n✅ TODAY'S DEVOTIONAL (${lang}) — ch${chapter.index}`)
  console.log(`   📱 mobile:  ${results.portrait}`)
  console.log(`   🖥  desktop: ${results.wide}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
