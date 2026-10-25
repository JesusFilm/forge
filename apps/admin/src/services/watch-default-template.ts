import type { Prisma, PrismaClient } from "@prisma/client"

// This is the parent identity used by public Watch settings. Locale publication
// is checked only after selecting the parent; it must not promote another
// template when the selected parent has no published locale.
export const WATCH_DEFAULT_TEMPLATE_SELECTION = {
  where: { isTemplate: true, archivedAt: null },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
} satisfies Pick<Prisma.ExperienceFindFirstArgs, "where" | "orderBy">

export async function findDefaultWatchTemplateId(
  prisma: Pick<PrismaClient, "experience">,
): Promise<string | null> {
  const template = await prisma.experience.findFirst({
    ...WATCH_DEFAULT_TEMPLATE_SELECTION,
    select: { id: true },
  })
  return template?.id ?? null
}
