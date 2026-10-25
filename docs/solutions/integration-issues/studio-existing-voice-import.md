---
module: Studio narration
problem_type: integration_issue
tags: [studio, elevenlabs, voice, manager]
date: 2026-09-12
---

# Existing voices need an operator import path

The speech panel queried recorded voice assets and told operators to import a
preset, but provided no import control. A successful provider speech sample did
not make that voice available in Studio. Peace in the Storm revision 9 therefore
had six cards with no speech and no retained narration run.

`apps/manager/src/app/api/shorts/voices/route.ts` now provides same-origin,
interactive-authenticated search/import. `existing-voices.ts` uses read-only
ElevenLabs lookup endpoints and retains a JSON preset through the existing Admin
asset-upload capability. It does not create a provider voice or dispatch TTS.
Provider IDs are rechecked on import; name and complete preset determine the
idempotency key. Transfers are restricted to the existing capability path and
responses are bounded. Account credentials and unneeded provider fields stay on
the server.

Keep the author language (`english` in this saved project) separate from the
provider language code (`en`). The preset records both using the existing
`settings.language_code` override. Narration still requires complete script
review, approval and paid admission.

## Verification

- 18 focused service/route/provider/narration tests passed; Manager typecheck,
  touched-file ESLint and production build passed.
- Browser fixture using the real import component: search Bella, reject invalid
  `english` provider code, accept `en`, return the retained preset to the caller.
  Provider and asset-transfer boundaries were mocked in this fixture; live
  narration remains a separate acceptance step.
- Built import chunk `00lglkwsbm09~.js`: 1,920 bytes, 1,024 bytes gzip. It is a
  separate dynamic import inside the already dynamically loaded speech panel,
  mounted only after the operator clicks Import existing voice. The editor and
  preview entrypoints are unchanged; no startup effect or provider request was
  added. This verifies the loading boundary rather than claiming a noisy timing
  comparison as a speed improvement.

Provider reference: https://elevenlabs.io/docs/api-reference/voices/get and
https://elevenlabs.io/docs/api-reference/voices/search.
