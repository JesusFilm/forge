import { Client } from "pg"
import { describe, expect, it } from "vitest"
import { env } from "@/config/env"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "recommendation fact index migration on PostgreSQL",
  () => {
    it("preserves identity, lineage, old-reader lookup, and expiry access", async () => {
      const client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      try {
        await client.query("BEGIN")
        const id = `fact-index-${Date.now()}`
        const requestId = `${id}-request`
        const otherRequestId = `${id}-other-request`
        const itemId = `${id}-item`
        const otherItemId = `${id}-other-item`
        const expiresAt = "2026-10-29T12:00:00.000Z"

        for (const [request, count] of [
          [requestId, 2],
          [otherRequestId, 1],
        ] as const) {
          await client.query(
            `INSERT INTO recommendation_request
              (id, contract_version, surface_version, manifest_id,
               strategy_version, classifier_version, session_digest,
               seed_media_id, locale, expected_item_count, result, expires_at)
             VALUES ($1, 'semantic-recommendation-v1', 'watch-below-player-v1',
               'semantic-transcript-pgvector-v1', 'semantic-transcript-pgvector-v1',
               'legacy-position-v0', $2, 'seed-video', 'en', $3, 'served', $4)`,
            [request, "a".repeat(64), count, expiresAt],
          )
        }
        for (const [item, position] of [
          [itemId, 0],
          [otherItemId, 1],
        ] as const) {
          await client.query(
            `INSERT INTO recommendation_served_item
              (id, request_id, position, target_media_id, canonical_href,
               candidate_generator, candidate_provenance, expires_at)
             VALUES ($1, $2, $3, $4, '/watch/video', 'semantic', '{}'::jsonb, $5)`,
            [item, requestId, position, `video-${position}`, expiresAt],
          )
        }

        const facts = [
          ["recommendation_rendered_fact", "recommendation_render"],
          ["recommendation_impression", "recommendation_impression"],
        ] as const
        for (const [table, prefix] of facts) {
          const capability = `${id}-${prefix}-capability`
          const insert = async (
            factId: string,
            request: string,
            item: string,
            event: string,
            jti = capability,
          ) =>
            client.query(
              `INSERT INTO ${table}
                (id, request_id, item_id, capability_jti, event_id,
                 payload_digest, occurred_at, expires_at${table === "recommendation_impression" ? ", visibility_policy" : ""})
               VALUES ($1, $2, $3, $4, $5, $6, now(), $7${table === "recommendation_impression" ? ", 'observer-v1'" : ""})`,
              [factId, request, item, jti, event, "b".repeat(64), expiresAt],
            )
          await insert(`${id}-${prefix}-fact`, requestId, itemId, "event-1")

          const oldReader = await client.query(
            `SELECT id FROM ${table} WHERE request_id = $1 AND item_id = $2`,
            [requestId, itemId],
          )
          expect(oldReader.rows).toEqual([{ id: `${id}-${prefix}-fact` }])
          const byItem = await client.query(
            `SELECT id FROM ${table} WHERE item_id = $1`,
            [itemId],
          )
          expect(byItem.rows).toEqual(oldReader.rows)

          const rejects = async (
            attempt: () => Promise<unknown>,
            code: string,
          ) => {
            await client.query("SAVEPOINT fact_attempt")
            try {
              await expect(attempt()).rejects.toMatchObject({ code })
            } finally {
              await client.query("ROLLBACK TO SAVEPOINT fact_attempt")
              await client.query("RELEASE SAVEPOINT fact_attempt")
            }
          }
          await rejects(
            () =>
              insert(
                `${id}-${prefix}-duplicate-item`,
                requestId,
                itemId,
                "event-2",
                `${capability}-new`,
              ),
            "23505",
          )
          await rejects(
            () =>
              insert(
                `${id}-${prefix}-duplicate-capability`,
                requestId,
                otherItemId,
                "event-2",
              ),
            "23505",
          )
          await rejects(
            () =>
              insert(
                `${id}-${prefix}-wrong-request`,
                otherRequestId,
                otherItemId,
                "event-3",
                `${capability}-new`,
              ),
            "23503",
          )

          const indexes = await client.query<{ indexname: string }>(
            `SELECT indexname FROM pg_indexes WHERE tablename = $1`,
            [table],
          )
          const names = indexes.rows.map(({ indexname }) => indexname)
          expect(names).toContain(`${prefix}_request_idx`)
          expect(names).toContain(`${table}_expires_at_idx`)
          expect(names).toContain(`${prefix}_item_key`)
          expect(names).toContain(`${prefix}_capability_key`)
          expect(names).not.toContain(`${prefix}_event_key`)
          expect(names).toContain(`${prefix}_item_request_key`)
        }

        // A request root still owns fact lifetime through the retained FKs.
        await client.query("DELETE FROM recommendation_request WHERE id = $1", [
          requestId,
        ])
        for (const [table] of facts) {
          const result = await client.query(
            `SELECT id FROM ${table} WHERE request_id = $1`,
            [requestId],
          )
          expect(result.rows).toHaveLength(0)
        }
      } finally {
        await client.query("ROLLBACK")
        await client.end()
      }
    })
  },
)
