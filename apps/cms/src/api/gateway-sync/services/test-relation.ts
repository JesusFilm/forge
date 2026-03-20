import type { Core } from "@strapi/strapi"
import { docs, upsertByGatewayId } from "./strapi-helpers"

/**
 * Test: reproduce the study question → video relation failure.
 * Call this endpoint TWICE to test the update path.
 * First call: creates video + study question + bible citation
 * Second call: updates them (the real failure scenario)
 *
 * POST /api/gateway-sync/test-relation?cleanup=true to delete test data
 */
export async function testRelation(strapi: Core.Strapi): Promise<unknown> {
  const log: string[] = []

  try {
    // Step 1: Upsert a Video (creates on first call, updates on second)
    log.push("1. Upserting video...")
    const { documentId: videoDocId, action: videoAction } =
      await upsertByGatewayId(
        strapi,
        "api::video.video",
        "test-rel-video-1",
        {
          title: "Test Video",
          slug: "test-rel-video-1",
          label: "shortFilm",
        },
        { locale: "en" },
      )
    log.push(`   Video ${videoAction}: documentId=${videoDocId}`)

    // Step 2: Upsert a study question with video relation
    log.push("2. Upserting study question with video relation...")
    try {
      const { documentId: sqDocId, action: sqAction } = await upsertByGatewayId(
        strapi,
        "api::video-study-question.video-study-question",
        "test-rel-sq-1",
        {
          value: "Test question?",
          order: 1,
          video: videoDocId,
        },
        { locale: "en" },
      )
      log.push(`   StudyQuestion ${sqAction}: documentId=${sqDocId}`)
    } catch (error) {
      log.push(
        `   StudyQuestion FAILED: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // Step 3: Upsert a bible citation with video relation
    log.push("3. Upserting bible citation with video relation...")
    try {
      const { documentId: bcDocId, action: bcAction } = await upsertByGatewayId(
        strapi,
        "api::bible-citation.bible-citation",
        "test-rel-bc-1",
        {
          osisId: "Gen",
          chapterStart: 1,
          order: 1,
          video: videoDocId,
        },
      )
      log.push(`   BibleCitation ${bcAction}: documentId=${bcDocId}`)
    } catch (error) {
      log.push(
        `   BibleCitation FAILED: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    // Step 4: Upsert a subtitle with video relation
    log.push("4. Upserting subtitle with video relation...")
    try {
      const { documentId: subDocId, action: subAction } =
        await upsertByGatewayId(
          strapi,
          "api::video-subtitle.video-subtitle",
          "test-rel-sub-1",
          {
            primary: true,
            vttSrc: "https://example.com/test.vtt",
            value: "Test subtitle",
            edition: "base",
            video: videoDocId,
          },
        )
      log.push(`   Subtitle ${subAction}: documentId=${subDocId}`)
    } catch (error) {
      log.push(
        `   Subtitle FAILED: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    log.push("")
    log.push(
      "NOTE: Records are NOT cleaned up. Call again to test UPDATE path.",
    )
    log.push("First call = create, second call = update (the failing scenario)")

    return { log }
  } catch (error) {
    log.push(`FATAL: ${error instanceof Error ? error.message : String(error)}`)
    return { log }
  }
}
