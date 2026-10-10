# Shorts narration without account pricing

The owner authorizes narration charges. Missing account pricing must not block
voice setup or narration. Keep music's existing pricing requirement.

Represent unavailable estimates as null, keep provider-reported actual cost null
when absent, and reserve zero priced funds for unpriced calls (not zero actual
cost). Explicit UI confirmation authorizes the fixed request even when its price
is unknown. Preserve script/voice review, fixed request bounds, consumed-call
replay protection and canonical result retention. No account-read permission or
fabricated rate card is required.

Validate missing-rate narration, voice design/registration, retained pricing
checks and unsupported provider rejection with focused tests and affected types.
