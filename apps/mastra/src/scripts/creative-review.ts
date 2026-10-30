/**
 * Creative review from a story session: Claude writes, GPT reviews.
 *
 *   pnpm exec tsx --env-file=.env.local src/scripts/creative-review.ts \
 *     --kind=carousel --lang=en --file=draft.md --out=<dir> [--revise] \
 *     [--context=passage.txt] [--locked=decisions.txt] \
 *     [--reviewer=openai/gpt-6.1-sol] [--writer=anthropic/claude-fable-5.1]
 *
 * `--locked`: the owner's decisions, one per line; neither model may undo them.
 *
 * Writes <out>/review.json, <out>/review.md (for the review doc's "Review"
 * tab) and, with --revise, <out>/revision.md (the revised draft). See
 * docs/devotional-carousel-playbook.md, section 6.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  CREATIVE_KINDS,
  DEFAULT_REVIEW_MODEL,
  DEFAULT_WRITER_MODEL,
  reviewMarkdown,
  runCreativeReview,
  type CreativeKind,
} from "../services/devotional/creative-review"
import { createDevotionalLlm } from "../services/devotional/llm"

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function main() {
  const kind = arg("kind") as CreativeKind | undefined
  const file = arg("file")
  const out = arg("out")
  if (!kind || !CREATIVE_KINDS.includes(kind) || !file || !out) {
    console.error(
      `usage: --kind=${CREATIVE_KINDS.join("|")} --file=<draft> --out=<dir> [--lang=en] [--revise] [--context=<file>] [--locked=<file>]`,
    )
    process.exit(2)
  }
  const lang = arg("lang") ?? "en"
  const draft = await readFile(file, "utf8")
  const context = arg("context")
    ? await readFile(arg("context")!, "utf8")
    : undefined
  const locked = arg("locked")
    ? await readFile(arg("locked")!, "utf8")
    : undefined
  const reviewer = createDevotionalLlm({
    model: arg("reviewer") ?? DEFAULT_REVIEW_MODEL,
    timeoutMs: 180_000,
  })
  const writer = process.argv.includes("--revise")
    ? createDevotionalLlm({
        model: arg("writer") ?? DEFAULT_WRITER_MODEL,
        timeoutMs: 180_000,
      })
    : undefined
  const input = {
    kind,
    draft,
    lang,
    ...(context ? { context } : {}),
    ...(locked ? { locked } : {}),
  }
  console.log(
    `review ${kind} (${lang}) with ${reviewer.model}${writer ? `, revise with ${writer.model}` : ""}…`,
  )
  const result = await runCreativeReview(input, {
    reviewer,
    ...(writer ? { writer } : {}),
  })
  await mkdir(out, { recursive: true })
  await writeFile(
    path.join(out, "review.json"),
    JSON.stringify(result, null, 2) + "\n",
  )
  await writeFile(path.join(out, "review.md"), reviewMarkdown(result, input))
  if (result.revision)
    await writeFile(
      path.join(out, "revision.md"),
      result.revision.revised + "\n",
    )
  const major = result.review.items.filter((i) => i.severity === "major").length
  console.log(
    `${result.review.items.length} note(s), ${major} major. Most important: ${result.review.mostImportant}`,
  )
  if (result.revision) {
    const taken = result.revision.decisions.filter((d) => d.accepted).length
    const unanswered =
      result.review.items.length - result.revision.decisions.length
    console.log(
      `revision: took ${taken} of ${result.review.items.length} suggestion(s)${unanswered ? `, ${unanswered} unanswered` : ""}`,
    )
  }
  if (result.revisionError)
    console.error(
      `revision failed, review kept: ${result.revisionError}\n(revise by hand, or rerun the review alone without --revise)`,
    )
  console.log(`→ ${out}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
