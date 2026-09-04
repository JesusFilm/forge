# Campaign: GotQuestions multilingual expansion

_Source key: `gotquestions` · Status: deferred · Starts after the English slice_

## Goal

Extend the already-proven `gotquestions` source across its remaining translated
sections without requiring one slice or operator session per language. All
translations share `www.gotquestions.org`, so they extend the existing source
key; they never become language-specific source keys.

## Delivery and resume contract

- English lands first through [`gotquestions.md`](./gotquestions.md).
- Campaign work lands as small, sequential checkpoint PRs: inventory/canary,
  then count-based language batches, then closing evaluation.
- Every merged PR updates this file with its evidence, commit/PR reference, and
  a concrete resume hint. The next branch starts from current `origin/main`.
- A fresh session resumes with: “Resume the GotQuestions multilingual campaign
  from `apps/rag/docs/slices/gotquestions-multilingual.md`.” The current `$slice`
  launcher is used for English, not for this same-source campaign.
- AI performs inventory, acquisition, label audits, retrieval smoke tests, and
  corpus-grounded eval drafting in bulk. The operator reviews consolidated
  exception/eval packets and gates writes and production promotion.

## Planned phases

- [ ] 0 — Inventory every language section: canonical code, URL shape, document
      count, sample extraction, detector coverage, and malformed/tiny sections.
- [ ] 1 — Canary a deliberately diverse set of roughly five languages (Latin,
      Arabic-script, CJK, low-resource, and tiny section); verify extraction,
      labels, retrieval, and evaluation before scaling.
- [ ] 2 — Partition the remaining inventory into count-based batches and process
      them resumably, surfacing exceptions rather than asking per-language
      questions.
- [ ] 3 — Run per-language retrieval smoke checks and bulk corpus-grounded golden
      authoring with consolidated operator approval packets.
- [ ] 4 — Run the closing living-relevant-set review, verify all declared
      language rows, and prepare an operator-gated production promotion handoff.

## Batch principles locked 2026-08-21

- Substantial collections receive fuller evaluation; small collections receive
  lightweight but real retrieval checks; malformed or effectively empty
  sections are explicitly deferred with evidence.
- Per-document language detection remains authoritative. Detector-risk
  languages are audited in bulk by comparing declared and detected language
  totals, and only anomalies are surfaced for review.
- Production is never automatic: local verification, merge, and explicit
  promotion approval remain separate gates.

## Resume hint

Planned only. Do not start until the English slice is merged. First action then:
inventory all translated sections and draft the canary cohort; do not register
215 language rows from the marketing page alone.
