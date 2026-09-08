> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Spec review — canonical effective-speech feedback

Fixed base: `5a17a9da11f1c19ef369e6b629bae10aa87b2b6f`; reviewed working diff and added projection/native/hash tests against the approved proposal and final “after all operations have executed” wording.

No actionable Spec findings.

Admin hashes the parsed original operations before projection and passes cloned operations to the existing evaluator, preserving ordered set-text/set-speech semantics and avoiding the known speech-object alias mutation. Authentication, revision, quality, asset and source gates precede the feedback. The shared server hash is the unchanged Admin algorithm with fixed equivalence vectors.

Feedback includes every speech-bearing item in canonical order with exact text and coherent counts, or a text-free unavailable envelope. UTF-8 serialized limits are enforced at 30720 bytes for speech and 32768 bytes for the native result; oversized valid projections remain valid. Native validation binds outer/nested project and revision plus the submitted operations digest, excludes duplicate QA, and redacts malformed success envelopes. Tool wording treats transcript text as untrusted data and grants no approval or quality assurance.

Regressions cover original slot0 speech intent versus retained final speech, reversed operations, whitespace/suppression/removal, identity dependencies, exact size boundaries, oversized canonical validation, authorization/revision failures, and next-turn transcript inspection. Existing typed error and replay/deadline paths are preserved. Closed evidence provenance documentation remains delivery work; no paid or creative acceptance is inferred from these tests.

Read-only source review; no tests, providers, services or code edits. Only this requested report was written.

## Final targeted follow-up

No findings. The added native-envelope test constructs exactly 30720 serialized UTF-8 bytes with long identifiers and verifies the complete returned result stays within 32768 bytes. Unavailable/partial/mismatched envelopes remain explicitly tested; the destructured-items assertion changes no product behavior. The final README distinguishes original SSE intent, historically aliased preview command, and retained final document; it preserves closed evidence and makes no paid or creative acceptance claim. Loading results are reported as mixed and attribution-inconclusive, explicitly not a passing no-regression certificate. The earlier pending provenance-documentation note above is now satisfied. No tests or services run during this follow-up.
