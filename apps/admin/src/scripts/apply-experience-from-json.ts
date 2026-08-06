/**
 * Create + publish a single Experience from a JSON file:
 *   { "slug": "...", "title": "...", "metaDescription"?: "...", "blocks": [ ... ] }
 *
 * Blocks are validated by BlocksSchema inside ExperienceService.create — an
 * invalid block throws a Zod error naming the offending path. Idempotent:
 * deletes any prior experience carrying the slug first.
 *
 * Usage:
 *   CI=true DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
 *     pnpm --filter @forge/admin exec tsx src/scripts/apply-experience-from-json.ts <path.json>
 */

import { readFileSync } from "node:fs"

import type { Principal } from "@/auth/principal"

const PROD_DENY = new Set([
  "admin.jesusfilm.org",
  "www.jesusfilm.org",
  "jesusfilm.org",
  "manager.jesusfilm.org",
  "web.jesusfilm.org",
])
function assertNotProdUrl(raw: string | undefined): void {
  if (!raw) throw new Error("DATABASE_URL is required")
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    throw new Error("DATABASE_URL is not a parseable URL")
  }
  if (
    host.endsWith(".railway.app") ||
    host.endsWith(".jesusfilm.org") ||
    PROD_DENY.has(host)
  ) {
    throw new Error(`Refusing to run against production-like host: ${host}`)
  }
}

async function main(): Promise<void> {
  assertNotProdUrl(process.env.DATABASE_URL)

  const path = process.argv[2]
  if (!path) throw new Error("usage: apply-experience-from-json.ts <path.json>")
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    slug: string
    title: string
    metaDescription?: string
    blocks: unknown[]
  }
  if (!doc.slug || !Array.isArray(doc.blocks)) {
    throw new Error("JSON must have { slug, title, blocks[] }")
  }

  const { prisma } = await import("@/db/client")
  const { ExperienceService } = await import("@/services/experience.service")
  const admin: Principal = { id: null, role: "ADMIN" }
  const service = new ExperienceService(prisma)

  try {
    const prior = await prisma.experienceLocale.findMany({
      where: { slug: doc.slug },
      select: { experienceId: true },
    })
    const priorIds = [...new Set(prior.map((p) => p.experienceId))]
    if (priorIds.length) {
      await prisma.experience.deleteMany({ where: { id: { in: priorIds } } })
      process.stdout.write(
        `Removed ${priorIds.length} prior experience(s) for slug=${doc.slug}\n`,
      )
    }

    // create (validates blocks against BlocksSchema)
    const created = await service.create({
      input: {
        locale: "en",
        slug: doc.slug,
        title: doc.title,
        blocks: doc.blocks,
      },
      user: admin,
    })
    const localeId = created.locales[0]!.id

    if (doc.metaDescription) {
      await service.updateLocale({
        input: { id: localeId, metaDescription: doc.metaDescription },
        user: admin,
      })
    }

    const published = await service.publishLocale({
      input: { id: localeId },
      user: admin,
    })
    process.stdout.write(
      `✓ ${doc.title}  slug=${doc.slug}  blocks=${doc.blocks.length}  status=${published.status}\n` +
        `  http://localhost:3000/watch/${doc.slug}.html/english.html\n`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  process.stderr.write(
    `[apply-experience] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  )
  process.exit(1)
})
