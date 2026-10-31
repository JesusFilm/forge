import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"

const originalMigration = readFileSync(
  new URL(
    "../../../prisma/migrations/0064_recommendation_governance_review_guards/migration.sql",
    import.meta.url,
  ),
  "utf8",
)
const originalGuard = originalMigration.match(
  /CREATE OR REPLACE FUNCTION "prevent_recommendation_profile_projection_child_update"\(\)[\s\S]*?\$\$;/,
)?.[0]
const repairMigration = readFileSync(
  new URL(
    "../../../prisma/migrations/0129_recommendation_projection_eligibility_retention_unlink/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "projection eligibility FK cleanup on PostgreSQL",
  () => {
    const schema = `retention_eligibility_${randomUUID().replaceAll("-", "")}`
    let client: Client

    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_retention_fk_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback retention fixture database required")
      if (!originalGuard)
        throw new Error("Original projection guard was not found")
      client = new Client({ connectionString: url.toString() })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET search_path TO "${schema}", public`)
      await client.query(`
        CREATE TABLE fixture_request (id text PRIMARY KEY);
        CREATE TABLE recommendation_eligibility_decision (
          id text PRIMARY KEY,
          request_id text REFERENCES fixture_request(id) ON DELETE CASCADE
        );
        CREATE TABLE recommendation_outcome_revision (id text PRIMARY KEY);
        CREATE TABLE recommendation_selection (id text PRIMARY KEY);
        CREATE TABLE recommendation_profile_projection_generation (
          id text PRIMARY KEY, state text NOT NULL
        );
        CREATE TABLE recommendation_profile_projection_contribution (
          id text PRIMARY KEY,
          generation_id text NOT NULL REFERENCES
            recommendation_profile_projection_generation(id) ON DELETE CASCADE,
          source_id_digest text NOT NULL,
          source_outcome_id text REFERENCES
            recommendation_outcome_revision(id) ON DELETE SET NULL,
          source_selection_id text REFERENCES
            recommendation_selection(id) ON DELETE CASCADE,
          source_eligibility_decision_id text,
          source_eligibility_revision integer,
          evidence_payload text NOT NULL,
          expires_at timestamptz NOT NULL,
          CONSTRAINT recommendation_profile_contribution_eligibility_fkey
            FOREIGN KEY (source_eligibility_decision_id)
            REFERENCES recommendation_eligibility_decision(id) ON DELETE SET NULL,
          CONSTRAINT recommendation_profile_contribution_eligibility_revision_check
            CHECK (
              (source_eligibility_decision_id IS NULL AND source_eligibility_revision IS NULL)
              OR (source_eligibility_decision_id IS NOT NULL AND source_eligibility_revision >= 1)
            )
        );
        CREATE TABLE recommendation_profile_interest (id text PRIMARY KEY, weight integer NOT NULL);
      `)
      await client.query(originalGuard)
      await client.query(`
        CREATE TRIGGER recommendation_profile_contribution_immutable
        BEFORE UPDATE ON recommendation_profile_projection_contribution
        FOR EACH ROW EXECUTE FUNCTION prevent_recommendation_profile_projection_child_update();
        CREATE TRIGGER recommendation_profile_interest_immutable
        BEFORE UPDATE ON recommendation_profile_interest
        FOR EACH ROW EXECUTE FUNCTION prevent_recommendation_profile_projection_child_update();
        INSERT INTO recommendation_profile_projection_generation VALUES ('published', 'PUBLISHED');
      `)
    })

    afterAll(async () => {
      if (!client) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    })

    it("reproduces the original failed request deletion, then retains the published observation after the repair", async () => {
      await client.query(`
        INSERT INTO fixture_request VALUES ('expired-request');
        INSERT INTO recommendation_eligibility_decision VALUES ('expired-decision', 'expired-request');
        INSERT INTO recommendation_profile_projection_contribution VALUES (
          'retained-contribution', 'published', 'retained-digest', NULL, NULL,
          'expired-decision', 4, 'retained-observation', now() + interval '2 days'
        );
      `)
      await expect(
        client.query("DELETE FROM fixture_request WHERE id='expired-request'"),
      ).rejects.toThrow("published profile projection children are immutable")
      expect(
        (await client.query("SELECT count(*)::int AS n FROM fixture_request"))
          .rows[0].n,
      ).toBe(1)

      await client.query(repairMigration)
      await client.query(
        "DELETE FROM fixture_request WHERE id='expired-request'",
      )
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM recommendation_eligibility_decision",
          )
        ).rows[0].n,
      ).toBe(0)
      const retained = await client.query(`
        SELECT generation_id, source_id_digest, source_eligibility_decision_id,
          source_eligibility_revision, evidence_payload, expires_at > now() AS live
        FROM recommendation_profile_projection_contribution
        WHERE id='retained-contribution'
      `)
      expect(retained.rows).toEqual([
        {
          generation_id: "published",
          source_id_digest: "retained-digest",
          source_eligibility_decision_id: null,
          source_eligibility_revision: null,
          evidence_payload: "retained-observation",
          live: true,
        },
      ])
    })

    it("rejects direct unlink and content edits while preserving the older FK actions", async () => {
      await client.query(`
        INSERT INTO fixture_request VALUES ('live-request');
        INSERT INTO recommendation_eligibility_decision VALUES ('live-decision', 'live-request');
        INSERT INTO recommendation_profile_projection_contribution VALUES (
          'protected-contribution', 'published', 'protected-digest', NULL, NULL,
          'live-decision', 5, 'untouched-observation', now() + interval '2 days'
        );
        INSERT INTO recommendation_outcome_revision VALUES ('source-outcome');
        INSERT INTO recommendation_selection VALUES ('source-selection');
        INSERT INTO recommendation_profile_projection_contribution VALUES (
          'outcome-contribution', 'published', 'outcome-digest', 'source-outcome',
          NULL, NULL, NULL, 'outcome-observation', now() + interval '2 days'
        );
        INSERT INTO recommendation_profile_projection_contribution VALUES (
          'selection-contribution', 'published', 'selection-digest', NULL,
          'source-selection', NULL, NULL, 'selection-observation', now() + interval '2 days'
        );
        INSERT INTO recommendation_eligibility_decision VALUES ('replacement-decision', 'live-request');
        INSERT INTO recommendation_profile_interest VALUES ('published-interest', 1);
      `)
      await expect(
        client.query(`
          UPDATE recommendation_profile_projection_contribution
          SET source_eligibility_decision_id=NULL, source_eligibility_revision=NULL
          WHERE id='protected-contribution'
        `),
      ).rejects.toThrow("published profile projection children are immutable")
      await expect(
        client.query(`
          UPDATE recommendation_profile_projection_contribution
          SET evidence_payload='changed' WHERE id='protected-contribution'
        `),
      ).rejects.toThrow("published profile projection children are immutable")
      await expect(
        client.query(`
          UPDATE recommendation_profile_projection_contribution
          SET source_eligibility_revision=NULL WHERE id='protected-contribution'
        `),
      ).rejects.toThrow("published profile projection children are immutable")
      await expect(
        client.query(`
          UPDATE recommendation_profile_projection_contribution
          SET source_eligibility_decision_id='replacement-decision'
          WHERE id='protected-contribution'
        `),
      ).rejects.toThrow("published profile projection children are immutable")
      await expect(
        client.query(`
          UPDATE recommendation_profile_projection_contribution
          SET source_eligibility_decision_id=NULL,
            source_eligibility_revision=NULL, evidence_payload='changed'
          WHERE id='protected-contribution'
        `),
      ).rejects.toThrow("published profile projection children are immutable")
      // A nested application trigger is not the FK action: the source row is
      // still present, so trigger depth alone cannot authorize the unlink.
      await client.query(`
        CREATE TABLE attempted_nested_unlink (id integer PRIMARY KEY);
        CREATE FUNCTION attempt_nested_unlink() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          UPDATE recommendation_profile_projection_contribution
          SET source_eligibility_decision_id=NULL
          WHERE id='protected-contribution';
          RETURN NEW;
        END $$;
        CREATE TRIGGER attempted_nested_unlink
        AFTER INSERT ON attempted_nested_unlink FOR EACH ROW
        EXECUTE FUNCTION attempt_nested_unlink();
      `)
      await expect(
        client.query(`INSERT INTO attempted_nested_unlink VALUES (1)`),
      ).rejects.toThrow("published profile projection children are immutable")
      await expect(
        client.query(`UPDATE recommendation_profile_interest SET weight=2`),
      ).rejects.toThrow("published profile projection children are immutable")
      await client.query(`
        DELETE FROM recommendation_eligibility_decision WHERE id='live-decision'
      `)
      await client.query("DELETE FROM recommendation_outcome_revision")
      await client.query("DELETE FROM recommendation_selection")
      const results = await client.query(`
        SELECT id, source_outcome_id, source_eligibility_decision_id,
          source_eligibility_revision, evidence_payload
        FROM recommendation_profile_projection_contribution
        WHERE id IN ('protected-contribution', 'outcome-contribution', 'selection-contribution')
        ORDER BY id
      `)
      expect(results.rows).toEqual([
        {
          id: "outcome-contribution",
          source_outcome_id: null,
          source_eligibility_decision_id: null,
          source_eligibility_revision: null,
          evidence_payload: "outcome-observation",
        },
        {
          id: "protected-contribution",
          source_outcome_id: null,
          source_eligibility_decision_id: null,
          source_eligibility_revision: null,
          evidence_payload: "untouched-observation",
        },
      ])
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM fixture_request WHERE id='live-request'",
          )
        ).rows[0].n,
      ).toBe(1)
    })
  },
)
