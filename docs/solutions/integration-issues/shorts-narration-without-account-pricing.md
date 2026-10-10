---
module: Shorts narration
problem_type: integration_issue
tags: [shorts, narration, elevenlabs]
---

# Narration does not require an account-price lookup

The configured ElevenLabs key could read voices/models and generate speech but
could not read subscription details. A missing rate card blocked voice design,
registration and narration even after the owner authorized charges.

Voice and narration estimates can now be unavailable (`null`). Confirmation
accepts the fixed request's provider charges. Zero reserved micros represents no
**priced reservation**, never a claim that audio is free. Actual cost stays null
unless reported. Music still requires a priced estimate.

For mixed priced/unpriced scripts, `reservationMicros` retains the known subtotal
separately from the unavailable total. Submit that integer directly; converting
249 micros through decimal dollars and flooring can incorrectly produce 248.
Consumed-call protection, selected voice validation and script review remain.

Validation: 20 focused Manager tests pass (two existing local-codec tests skipped),
Admin/Manager types and affected lint pass. Both independent reviews resolved.
The two lazy panels have unchanged bundled dependency/import sets; combined
minified gzip increases 33 bytes. No new loading requests/effects were added;
this is bundle evidence, not a full-page timing benchmark.

A separately authorized live ElevenLabs speech sample returned HTTP 200 using
Bella and `eleven_multilingual_v2`. Provider actual price was not returned.
