import type { Core } from "@strapi/strapi"

interface SectionBlock {
  __component: string
  content?: Array<{ __component: string; buttonText?: string }>
  [key: string]: unknown
}

interface ExperienceDocument {
  documentId: string
  blocks?: SectionBlock[]
}

export async function seedQuizButton(strapi: Core.Strapi): Promise<void> {
  const docs = (await strapi.documents("api::experience.experience").findMany({
    populate: { blocks: { populate: "*" } },
    limit: 1,
  })) as ExperienceDocument[]

  if (!docs.length) {
    strapi.log.info("[seed] No experience found — skipping quiz button seed.")
    return
  }

  const experience = docs[0]
  const blocks = experience.blocks ?? []

  const sectionIndex = blocks.findIndex(
    (b) => b.__component === "sections.section",
  )

  if (sectionIndex === -1) {
    strapi.log.info(
      "[seed] No Section block found in first experience — skipping quiz button seed.",
    )
    return
  }

  const section = blocks[sectionIndex]
  const content = section.content ?? []

  const alreadySeeded = content.some(
    (c) => c.__component === "sections.quiz-button",
  )

  if (alreadySeeded) return

  content.push({
    __component: "sections.quiz-button",
    buttonText: "What's your next step of faith?",
    iframeSrc: "https://your.nextstep.is/embed/easter2025?expand=false",
  } as (typeof content)[number])

  section.content = content
  blocks[sectionIndex] = section

  await strapi.documents("api::experience.experience").update({
    documentId: experience.documentId,
    data: { blocks } as Record<string, unknown>,
  })

  strapi.log.info("[seed] Quiz button added to first section of experience.")
}
