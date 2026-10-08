# RAG strategy and Source Expansion

October 8, 2026. This is the strategy map for the RAG bounded context; ticket
frontmatter remains authoritative for delivery status. The October 5 feedback
below comes from Jaco's J075 brief, not an independently reviewed transcript.
This PR delivers planning documents only. All new implementation/research entries
remain not started; dates/durations are placeholders and priorities are planning
triage, not an approved delivery order or spending commitment.

## Workstreams and success

| Theme                                 | Delivery owners in this lane                                                                                                                                                                                                                                                                  | Success evidence                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration closure / legacy retirement | [feat-435](feat-435-rag-proof-soak-archive.md) complete; [feat-532](feat-532-rag-legacy-service-credential-retirement.md) in progress; [feat-610](feat-610-rag-static-bearer-retirement.md) complete                                                                                          | Preserve Option A migration acceptance and static-bearer cutoff. Close remaining legacy resources only with named dispositions and redacted operator evidence; scheduled deletion is not observed deletion. |
| Consumer portal hardening             | [feat-530](feat-530-rag-consumer-self-service-portal.md), [feat-619](feat-619-rag-portal-session-recovery.md), [feat-580](feat-580-rag-consumer-revocation-restoration.md) complete; [feat-620](feat-620-rag-consumer-manual.md), [feat-576](feat-576-rag-governed-test-bench.md) not started | Preserve working access/session/revocation flows. Deliver data-derived manual examples, then separately bounded and attributed bench execution with measured page-load impact.                              |
| Observability / support / health      | [feat-605](feat-605-rag-safe-search-diagnostics.md) complete; [feat-625](feat-625-rag-health-support.md) new                                                                                                                                                                                  | Correlate safe request IDs, distinguish healthy process from working retrieval, reproduce or explicitly disposition intermittent failures and exercise alert/support routing.                               |
| Source quality / retrieval testing    | [feat-463](feat-463-rag-baseline-concerns-investigation.md), [feat-467](feat-467-gotquestions-icelandic-negative-retrieval.md), [feat-445](feat-445-rag-registry-policy-test-consolidation.md) existing; [feat-623](feat-623-rag-source-quality-gates.md) new                                 | Reproducible positive/negative, language, attribution and scope checks with compatible comparison identities; evidence-backed defect or accepted-limitation dispositions.                                   |
| Source Expansion                      | [feat-622](feat-622-rag-source-expansion.md) new                                                                                                                                                                                                                                              | Trace a suggestion through rights review, authorized bounded pilot, retrieval checks and disposition; exercise harmful/low-quality content reporting and containment.                                       |
| Bible lookup research / licensing     | [feat-624](feat-624-rag-bible-lookup-research.md) new                                                                                                                                                                                                                                         | Dated official capability/terms matrix, exact-reference semantics, cost/ownership options and a decision before implementation or licensing commitments.                                                    |
| Capacity / reliability                | [feat-568](feat-568-rag-usage-capacity-review.md), [feat-439](feat-439-rag-railway-infrastructure-as-code.md), [feat-446](feat-446-rag-typed-operational-errors.md), [feat-469](feat-469-rag-redirected-sitemap-relative-children.md) existing                                                | Measured safe capacity and thresholds, bounded failure handling and reproducible configuration; no assumption that durable accounting means unlimited volume.                                               |
| Operational workflow / handover       | [feat-606](feat-606-rag-post-migration-workflow-validation.md), [feat-471](feat-471-rag-production-operations-rollout.md) existing; [feat-626](feat-626-rag-operational-handover.md) new                                                                                                      | Distinguish previews from authorized acquisition/indexing receipts, coordinate Icelandic work, and have a second operator complete drills with named owners and open-item dispositions.                     |

## Source suggestions from October 5

Every row starts at **suggested; rights unverified; no ingestion approval**.
These are discovery categories, not approved publishers, editions or source keys.
The implementation of feat-622 will assign intake IDs and reviewers.

| Suggestion                           | Intake refinement / rights questions                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Additional Cru and ministry material | Identify collections, languages and editions; compare existing Cru/source inventory to avoid duplicate acquisition; establish authority for each intended use. |
| Apologetics books                    | Identify titles/editions, authors, publishers and rights holders; confirm digital storage, embedding and excerpt/full-document permissions.                    |
| Ligonier                             | Identify proposed resources and rights contact; distinguish website access from authorized corpus and retrieval use.                                           |
| Biblica                              | Identify translations/resources and intended use; coordinate with feat-624 research without presuming Bible-text rights.                                       |
| Church fathers                       | Identify work, translation, edition and digitization provenance; verify the specific rights position rather than infer permission from author age.             |
| Reformation writings                 | Identify edition/translation and provenance; review attribution, territory and downstream use restrictions.                                                    |
| Historical sermons                   | Identify preacher, collection, transcription/translation and publisher; verify permission for the exact artifact and delivery mode.                            |

Rights evidence is a review prerequisite, not a legal conclusion supplied by this
roadmap. Store permission records in an appropriate restricted location and link
safe identifiers; do not copy protected source text into tickets.

## Sequencing and decision gates

Existing in-progress retirement continues under its own authority. Research,
intake design, quality-check design and health/support planning can proceed in
parallel as independent work; this does not request parallel agent execution.
The only new hard feature dependency is **feat-623 -> feat-622**: the quality
protocol must exist before the Source Expansion initiative can complete its
pilot gates. Intake design itself can start earlier. Existing **feat-620 ->
feat-576** still separates the disabled manual from live bench execution.

Before any pilot: identify the exact candidate and accountable reviewers, verify
rights, agree quality thresholds and document inventory/cost/target bounds.
Before production promotion: review pilot evidence, confirm access and licensing
restrictions can be enforced, and obtain explicit operational authorization.
Before material volume expansion: use feat-568's measured capacity envelope and
agree any spending or retention changes. No new source is a dependency of
historical migration closure; feat-463's accepted baseline concerns remain
independent of acquisition/ingestion proof.

No material product/legal choice is needed to publish this gated roadmap.
Future choices remain open at their execution gates: first pilot and audience,
rights reviewer and permissions, Bible provider/translation/architecture,
quality thresholds, budget/volume and operational ownership. Ask Jaco one bounded
multiple-choice question at a time when the relevant work needs a decision;
do not infer approval from this document or from an unanswered question.

## Identity and evidence preservation

The two RAG feat-575 tickets are now **feat-619 (session recovery, complete)** and
**feat-620 (Consumer Manual, not started)**. Platform feat-575 is unchanged.
Historical `evidence/feat-575/` assets retain their paths and provenance; use the
linked ticket title to disambiguate old PR references. Other pre-existing global
ID collisions remain outside J075; new IDs 619–626 are globally unique at creation.
See the [J075 report](../../reports/2026-10-08-j075-rag-strategy.md) for checks and limitations.
