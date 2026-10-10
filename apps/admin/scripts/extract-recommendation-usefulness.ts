import { readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { extractUsefulnessSnapshot } from "../src/services/recommendations/experiment/usefulness-extractor"

const Config = z
  .object({
    experimentId: z.string().regex(/^[a-zA-Z0-9_-]{1,191}$/),
    configurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
    enrollmentStart: z
      .string()
      .datetime()
      .transform((value) => new Date(value)),
    enrollmentEnd: z
      .string()
      .datetime()
      .transform((value) => new Date(value)),
    plannedAssignmentsPerArm: z.number().int().min(200).max(100_000),
    minimumUsefulDelta: z.number().positive(),
  })
  .strict()

async function main() {
  const filename = process.argv[2]
  const connectionString = process.env.READ_ONLY_DATABASE_URL
  if (!filename || !connectionString) throw new Error("configuration required")
  const config = Config.parse(JSON.parse(readFileSync(filename, "utf8")))
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  })
  try {
    process.stdout.write(
      `${JSON.stringify(await extractUsefulnessSnapshot(prisma, config), null, 2)}\n`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch(() => {
  // Prisma diagnostics may include connection details or private row values.
  process.stderr.write(
    "Usefulness extraction failed; verify configuration, schema and read-only database access.\n",
  )
  process.exitCode = 1
})
