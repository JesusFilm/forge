---
module: Studio
problem_type: integration_issue
tags: [studio, generation, retained-proposals, provenance]
---

# Preserve original commands when reading generation previews

`StudioGenerationService.read` parsed a retained generation manifest, projected its selected proposal, and returned both the command and final document. The ordered evaluator clones the base document, but temporarily uses references from operations such as `set-speech` and `insert-item`. Later operations can mutate those objects. Consequently, the returned “Exact proposed operations” differed from the stored original even when the final preview document was correct.

Clone the full selected operations array at the read projection boundary. Keep the original proposal for the response. Cloning after projection is too late; cloning only speech misses inserted-item aliases. Core `applyOperations`, ordered text/speech semantics, hashes, source checks and transport contracts remain unchanged.

This defect affected a request-local parsed response, not stored manifest bytes or revision rows. Manager displays the returned command and submits it on explicit Apply, so preserving command provenance matters independently of final-document equality. Historical retained preview commands may already contain the alias: original SSE/manifest bytes are original-intent evidence; the retained canonical document is final-result evidence. Do not rewrite historical records.

The [validation record](../../validation/studio-458/generation-read-isolation/README.md) includes an original-SSE red/green regression, nested insertion and reversed ordering, selection/repeat and rejection tests, plus owned-Postgres manifest-byte and revision retention checks. No schema, native tool, prompt or provider changes are needed. The prior inconclusive frontend performance result remains unchanged; creative and ElevenLabs acceptance remain incomplete.
