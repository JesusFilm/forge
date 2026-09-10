---
module: Studio
problem_type: integration_issue
tags: [studio, generation, canonical-speech, native-tools]
---

# Return canonical effective speech after proposal validation

Native authors previously received validation success without the final spoken projection. A later `set-text` synchronizes existing speech, so an earlier longer `set-speech` can be overwritten while a model's QA still describes the earlier intent.

The shared operation descriptions now explain this existing order-sensitive behavior. Admin validates the final composition through unchanged authority, revision, source, asset and quality gates, then returns exact speech-bearing items in canonical order. `scriptDigest` uses the existing canonical script hash; the unchanged hash implementation is shared through the server-only package. Native checks project, revision and original operations digest before returning the projection as untrusted editorial data. It grants no approval or quality assurance.

Validation hashes the original parsed operations before applying cloned operations. The clone is necessary because the core evaluator assigns speech references and a later text operation mutates them. Core application semantics remain unchanged. The separate generation-read preview command alias remains reported, outside this correction: use original SSE arguments for original intent and the retained canonical document for final speech.

Exact UTF-8 JSON bounds are 30720 bytes for complete inline speech and 32768 for the complete native result. Oversized valid compositions receive an explicit unavailable envelope; no partial transcript is labeled complete and no text is truncated. Suppressed/empty speech items remain visible with exact whitespace and counts. The canonical hash still includes existing voice/settings/pronunciation dependencies.

See [validation and limitations](../../validation/studio-458/effective-speech-feedback/README.md) for original-SSE regression, authority/order/binding/byte-limit tests, fixed-base reviews and mixed loading measurements. New description bytes change the shipped tool schema and require fresh future paid admission. Closed paid batches remain immutable; this correction does not establish creative or ElevenLabs acceptance.
