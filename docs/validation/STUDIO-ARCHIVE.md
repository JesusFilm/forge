# Studio validation evidence

The Studio PR keeps validation summaries and the eleven retained-response fixtures used by automated regression tests. Raw logs, browser traces, screenshots, media captures, one-off harnesses and original checksum inventories have been removed from the final Git diff. Product code and test assertions are unchanged.

## Preserved archive

Before removal, every added validation file was archived and its extracted bytes independently checked against SHA-256.

- Source commit: `b0b690cbe487b4d35884f91d28f9af20f43c6a4b`
- Files: 1,993
- Archive: `pr-2205-b0b690cb-validation.tar.gz`
- SHA-256: `8ff609e9795bad66bc65edefd35211dd15d888d6a6f46f4a750301081c04ab14`
- Local storage: `/home/tataihono/.local/share/forge/studio-validation-archive/`
- Adjacent `manifest.json` records every original path and checksum.

This is a verified local archive, not a hosted backup. The same original bytes are also available from the source commit above. To inspect archived files, extract the archive into a separate directory; paths preserve their original `docs/validation/` prefix. Historical summaries retain original paths, outcomes and qualifications, including failures and incomplete acceptance. Their old artifact references point into this archive.

## Regression fixtures retained in Git

- `docs/validation/studio-458/effective-speech-feedback/slot0-original-proposal.json`
- `docs/validation/studio-458/llm-provider-evidence/2-response.body`
- `docs/validation/studio-458/llm-provider-evidence/4-response.body`
- `docs/validation/studio-458/model-comparison-1/live/request-3-0-response.body`
- `docs/validation/studio-458/model-comparison-1/live/request-3-1-response.body`
- `docs/validation/studio-458/model-comparison-1/live/retained-0.body`
- `docs/validation/studio-458/model-comparison-1/verified-bound-proposal.body`
- `docs/validation/studio-458/native-hosted-followup-2/binding/bound-proposal.body`
- `docs/validation/studio-458/native-hosted-followup-2/live/paid-0-2-response-proposal-0.json`
- `docs/validation/studio-458/native-hosted-live/paid-1-2-response-proposal-0.json`
- `docs/validation/studio-458/native-hosted-proposal/corrected-readonly-proposal.body`
