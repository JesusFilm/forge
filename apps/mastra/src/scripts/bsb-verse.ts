/**
 * Print the exact Berean Standard Bible text of one or more references, from
 * the local corpus the devotional uses. For checking closing-verse candidates
 * before offering them to the owner (a candidate that prints NOT FOUND cannot
 * be passed to compose-storyteller's `--verse`).
 *
 *   pnpm --filter @forge/mastra exec tsx src/scripts/bsb-verse.ts "Psalm 103:3" "Romans 12:12"
 */
import { getVerseText } from "../services/devotional/bible-text"

for (const ref of process.argv.slice(2))
  console.log(`${ref}: ${getVerseText(ref) ?? "NOT FOUND"}`)
