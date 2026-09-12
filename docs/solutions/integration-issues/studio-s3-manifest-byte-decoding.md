---
module: Studio narration
tags: [studio, narration, s3, assets, byte-decoding]
problem_type: integration_issue
---

# Retained narration failed to attach from S3

Six recordings and both narration manifests were retained, but production run
`cmty79q5i558es00sw7225yze` stayed READY with a QUEUED attempt. Its generic
`Studio command rejected` diagnostic concealed a JSON SyntaxError.

A read-only transaction in the deployed Admin service reproduced the failure
at `attachStudioNarration`'s root manifest JSON parse. The same exact retained
manifest passed locally. Railway S3 returns Uint8Array, whereas filesystem
storage returns Buffer. Calling `.toString()` on Uint8Array produces decimal
byte values separated by commas, not UTF-8 text. JSON parsing failed at the
first comma after `123`.

`readVerifiedStudioAsset` now normalizes verified bytes to Buffer, preserving
the existing byte-size and SHA-256 checks. This gives all downstream manifest
readers the same decoding behavior for both storage backends.

The regression in
`apps/admin/src/services/studio-authoring/narration-recovery.db.test.ts` uses
the real asset registry and canonical completion transaction, with storage
reads represented as Uint8Array. It attaches six cached recordings, checks
the completed run has no provider calls, and replays the completion receipt.
Before the fix it reproduces the production SyntaxError; afterward it passes.

Run against the owned migrated database:

```sh
STUDIO_TEST_DATABASE_URL=postgresql://tataihono@127.0.0.1:55460/forge_studio_491_test \
  pnpm --filter @forge/admin exec vitest run \
  src/services/studio-authoring/narration-recovery.db.test.ts
```

Recovery uses a current-revision narration admission and the retained exact
speech identities. Never replay paid requests to repair attachment, and never
overwrite a newer revision with the original failed attempt.
