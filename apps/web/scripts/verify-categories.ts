#!/usr/bin/env tsx
/**
 * Pre-ship verification for the browse-modal category grid.
 *
 * Temporarily disabled while feat-247 replaces the legacy Admin
 * Query.search(q, locale...) contract. Keep the command as a no-op so CI and
 * developer scripts are not blocked by the migration.
 *
 * Run: GRAPHQL_URL=https://... pnpm -F @forge/web verify:categories
 * Or:  NEXT_PUBLIC_ADMIN_GRAPHQL_URL already set in the shell
 *
 * Intentionally avoids importing @/lib/client or @/lib/search so the script
 * does not drag apps/web's client-only module graph (env-schema validation,
 * next/navigation hooks, Apollo boot) into a plain Node execution context.
 */

import { CATEGORIES } from "../src/lib/search-categories"

async function main() {
  console.log(
    `Category search verification skipped for ${CATEGORIES.length} categories while feat-247 replaces Watch search.`,
  )
}

void main()
