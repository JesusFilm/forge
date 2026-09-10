# Shorts direct render upload

Use Mux Direct Uploads so the trusted VM supervisor PUTs its verified local MP4 directly to Mux. Keep the render container offline and keep API credentials in Manager. Forge's retained original remains available for review/download; Mux must no longer fetch that original from Forge.

Bind one durable upload to the existing render/lease/Mux dispatch. Persist provider upload identity before returning its URL; ambiguous creation cannot create a replacement. After canonical render completion, the VM uploads within a persisted bounded window before pruning its output. The Manager observer only resolves upload→asset→ready; publication remains separate. Preserve cancellation, exact receipts, defaults and source restrictions.

Validate provider request shape, gateway lease binding, canonical upload identity, VM direct PUT/restart/error handling and affected types. No real provider upload or VM deployment in this change.

## Verification

Fresh consolidated migration replay and nine real database publication tests pass, including immutable upload identity and consumed-dispatch replay. Manager focused tests cover direct-upload creation, exact-lease access, disabled admission, response loss and observation. VM tests cover direct verified-byte PUT, partial resume, lost response, destination/hash refusal and nonrenewable windows. Expired unresolved uploads retain local files; review caught and corrected an earlier cleanup path that would have discarded them. No raw logs or captures are committed. Real provider upload and deployed-host qualification remain separate release checks.
