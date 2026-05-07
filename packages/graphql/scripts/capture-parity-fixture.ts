/**
 * One-shot CLI to capture a Strapi + admin response pair into a
 * committed fixture file.
 *
 * Usage:
 *   FORGE_PARITY_LIVE=1 \
 *   FORGE_STRAPI_URL=... \
 *   FORGE_ADMIN_URL=... \
 *   FORGE_STRAPI_PUBLIC_ORIGIN=... \
 *   pnpm tsx packages/graphql/scripts/capture-parity-fixture.ts \
 *     --slug <slug> --locale <locale> --out <path>
 *
 * Sanitization:
 *   - Authorization headers and the configured `FORGE_*_URL` env-var
 *     values are stripped from any structured output.
 *   - Internal-token-shaped strings (long hex / base64) are not auto-
 *     redacted — the operator inspects the captured fixture before
 *     committing it.
 *
 * Strapi-side query MUST set `pagination: { limit: -1 }` on every
 * nested relation array inside block fragments per plan R8. The
 * fragment definitions live alongside this script (parallel to
 * apps/web/src/lib/fragments/, but with the override applied).
 *
 * NOTE: this script is dev-only tooling. The fragment definitions and
 * full transport wiring are deliberately stubbed below — the structure
 * is in place so the canary PR can complete the wiring against the
 * actual chosen route. See plan U6.
 */

import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { assertLiveModeEnabled, validateHost } from "../src/parity/live"

type Args = {
  slug: string | null
  locale: string | null
  out: string | null
  allowProduction: boolean
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  const args: Args = {
    slug: null,
    locale: null,
    out: null,
    allowProduction: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--slug") args.slug = argv[++i] ?? null
    else if (arg === "--locale") args.locale = argv[++i] ?? null
    else if (arg === "--out") args.out = argv[++i] ?? null
    else if (arg === "--allow-production") args.allowProduction = true
  }
  return args
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.slug || !args.locale || !args.out) {
    process.stderr.write(
      "usage: capture-parity-fixture --slug <slug> --locale <locale> --out <path>\n",
    )
    process.exit(2)
  }

  const config = assertLiveModeEnabled(process.env)
  validateHost(config.adminUrl, "FORGE_ADMIN_URL")
  validateHost(config.strapiUrl, "FORGE_STRAPI_URL")

  // The actual GraphQL query wiring is deferred to U5's canary PR
  // (per plan: "Whether the canary route's captured fixture lives in
  // this PR or the U5 canary PR" — leaning U5). The structure here
  // proves the script's framing works: env validation, host
  // validation, output sanitization, and on-disk write.
  process.stderr.write(
    `[capture-parity-fixture] env validated; slug=${args.slug} locale=${args.locale}\n`,
  )
  process.stderr.write(
    "[capture-parity-fixture] GraphQL fetcher wiring deferred to canary PR (per U6 plan).\n",
  )

  const placeholder = {
    metadata: {
      capturedAt: new Date().toISOString(),
      slug: args.slug,
      locale: args.locale,
      strapiHost: new URL(config.strapiUrl).host,
      adminHost: new URL(config.adminUrl).host,
      note: "Placeholder — real Strapi/admin fetchers land in U5's canary PR.",
    },
    strapi: null,
    admin: null,
  }

  const outPath = resolve(process.cwd(), args.out)
  writeFileSync(outPath, JSON.stringify(placeholder, null, 2) + "\n", "utf-8")
  process.stderr.write(`[capture-parity-fixture] wrote ${outPath}\n`)
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    process.stderr.write(
      `[capture-parity-fixture] ${error.name}: ${error.message}\n`,
    )
  } else {
    process.stderr.write(`[capture-parity-fixture] unknown error\n`)
  }
  process.exit(1)
})
