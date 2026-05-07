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

import { assertLiveModeEnabled } from "../src/parity/live"

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

  // assertLiveModeEnabled validates env + both host URLs; no extra
  // validateHost calls needed here.
  assertLiveModeEnabled(process.env)

  // The actual GraphQL query wiring is deferred to U5's canary PR
  // (per plan: "Whether the canary route's captured fixture lives in
  // this PR or the U5 canary PR" — leaning U5). Until the wiring
  // lands, the script exits with a deferred-message rather than
  // writing a misleading null-payload fixture.
  process.stderr.write(
    `[capture-parity-fixture] env validated; slug=${args.slug} locale=${args.locale}\n`,
  )
  process.stderr.write(
    "[capture-parity-fixture] GraphQL fetcher wiring is deferred to U5's canary PR.\n",
  )
  process.stderr.write(
    "[capture-parity-fixture] No fixture file written — see plan U6 Open Questions.\n",
  )
  process.exit(2)
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
