import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../prisma/migrations/0052_subtitle_quality_lab/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
)

describe("subtitle evaluation raw-database immutability contract", () => {
  it.each([
    "subtitle_eval_corpus_snapshot",
    "subtitle_eval_corpus_cell",
    "subtitle_eval_artifact",
    "subtitle_eval_rubric_version",
    "subtitle_eval_comparison",
    "subtitle_eval_terminal_report",
    "subtitle_eval_machine_assessment",
    "subtitle_eval_provider_call",
    "subtitle_eval_human_review",
    "subtitle_eval_experiment_narrative",
    "subtitle_eval_audit_event",
    "manager_access_audit_event",
  ])("guards UPDATE and DELETE for %s", (table) => {
    expect(migration).toMatch(
      new RegExp(
        `BEFORE UPDATE OR DELETE ON "${table}"[\\s\\S]+EXECUTE FUNCTION "subtitle_eval_reject_mutation"`,
      ),
    )
  })

  it("constrains corpus version transitions in the database", () => {
    expect(migration).toContain("subtitle_eval_corpus_version_transition")
    expect(migration).toContain("subtitle_eval_guard_corpus_version_transition")
  })

  it("keeps assignment idempotency identity immutable while coordination fields remain mutable", () => {
    expect(migration).toContain("subtitle_eval_assignment_idempotency_key_key")
    expect(migration).toContain(
      "subtitle_eval_guard_assignment_request_identity",
    )
    expect(migration).toContain(
      'NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"',
    )
    expect(migration).toContain(
      'NEW."request_digest" IS DISTINCT FROM OLD."request_digest"',
    )
  })

  it("freezes run request identity while leaving execution coordination mutable", () => {
    expect(migration).toContain("subtitle_eval_guard_run_request_identity")
    for (const column of [
      "idempotency_key",
      "request_digest",
      "operator_id",
      "corpus_version_id",
      "requested_provider",
      "requested_model",
      "prompt_policy_id",
      "workflow_policy_digest",
      "code_revision",
      "determinism",
      "concurrency",
      "timeout_seconds",
      "max_attempts",
      "estimated_spend_micros",
    ]) {
      expect(migration).toContain(
        `NEW."${column}" IS DISTINCT FROM OLD."${column}"`,
      )
    }
    const guard = migration.slice(
      migration.indexOf(
        'CREATE FUNCTION "subtitle_eval_guard_run_request_identity"',
      ),
      migration.indexOf('CREATE TRIGGER "subtitle_eval_run_request_identity"'),
    )
    expect(guard).not.toMatch(
      /NEW\."(?:status|lease_generation|lease_token_hash|lease_expires_at|started_at|terminal_at|updated_at)"/,
    )
  })

  it("freezes run-cell binding identity while leaving lease and result state mutable", () => {
    expect(migration).toContain("subtitle_eval_guard_run_cell_binding_identity")
    for (const column of [
      "run_id",
      "corpus_cell_id",
      "idempotency_key",
      "target_language_id",
      "target_language_slug",
    ]) {
      expect(migration).toContain(
        `NEW."${column}" IS DISTINCT FROM OLD."${column}"`,
      )
    }
    const guard = migration.slice(
      migration.indexOf(
        'CREATE FUNCTION "subtitle_eval_guard_run_cell_binding_identity"',
      ),
      migration.indexOf(
        'CREATE TRIGGER "subtitle_eval_run_cell_binding_identity"',
      ),
    )
    expect(guard).not.toMatch(
      /NEW\."(?:status|attempt_count|lease_generation|lease_token_hash|lease_expires_at|result_digest|error_code|error_retryable|started_at|completed_at|updated_at)"/,
    )
  })

  it("rejects provider-call inserts after the parent run has a terminal report", () => {
    expect(migration).toContain(
      "subtitle_eval_guard_provider_call_before_terminal_report",
    )
    expect(migration).toContain(
      'JOIN "subtitle_eval_terminal_report" report ON report."run_id" = cell."run_id"',
    )
    expect(migration).toContain(
      'BEFORE INSERT ON "subtitle_eval_provider_call"',
    )
    expect(migration).toContain("FOR UPDATE OF parent_run")
  })

  it("constrains blind questionable track identity", () => {
    expect(migration).toContain(
      "subtitle_eval_human_review_questionable_track_check",
    )
    expect(migration).toContain(`"questionable_track" IN ('A', 'B')`)
  })

  it("lets separate cells reference the same content-addressed object", () => {
    expect(migration).toContain(
      'CREATE INDEX "subtitle_eval_artifact_object_key_idx" ON "subtitle_eval_artifact"("object_key")',
    )
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "subtitle_eval_artifact_object_key_key"',
    )
  })
})
