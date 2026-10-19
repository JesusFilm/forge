# Editorial related-video selection

Scope: feat-733, local catalogue curation only. The user wants this assistant
to work through the library and make six editorial choices per video.

Use Railway CLI credentials to export the 1,031 ready profiles from Admin's
`production-astra-catalog-20261013-v6` generation and join canonical video IDs
to English metadata. Enforce read-only transactions and bounded SQL timeouts.

Reuse summaries, themes, people, citations, and existing evidence. Read the
catalogue in manageable batches, retain an index across batches, and choose
connections by subject, narrative, thematic relevance, or complementary
perspective. Save progress durably so completed decisions do not need repeat
generation. Request transcript passages only where source evidence is unclear.

Output a local artifact with six distinct ordered target IDs and short reasons
for each assessed source. Validate membership, uniqueness, coverage, and absence
of self-links. Keep production unchanged and report any unfinished coverage.

## Completed draft and durable findings

The local artifacts in `output/editorial-recommendations/` cover all 1,031 sources
with six choices each. `curate.py` preserves explicit editorial groups, source
assignments, and 262 individual overrides; it performs no model inference.
The remaining 769 sources share authored decisions for closely related content.
`review.html` provides searchable inspection, with CSV and JSON exports alongside.

Treat a ready profile state separately from evidence quality: 172 ready rows had
null profiles, and 57 profiles contained uninformative transcript descriptions.
Catalogue metadata supplied the evidence for those cases. Five title/profile or
transcript-language discrepancies require reconciliation under `feat-734`.
Full videos were not viewed; no playback-language-specific review was performed.

Validation checks cover source membership, canonical and core target uniqueness,
no self-recommendations, exported title fidelity, reasons, and snapshot playback
availability. Choices are attached to canonical videos once; language eligibility
must be checked when serving rather than regenerating editorial choices per dub.
The precomputed table lookup requires zero recommendation-time model tokens.
No production data was changed and no additional model API calls were made.

## PR packaging

The tracked review artifact is `docs/recommendations/editorial-2026-10-19/`.
It contains JSON, CSV, a self-contained review page, playback snapshot, the
historical validation report, and an offline validator. The full raw profile
export and local curation tooling remain outside Git. Roadmap IDs were reassigned
to feat-733 and feat-734 against current main to avoid collisions. This is a
data-only PR and does not wire the choices into production.
