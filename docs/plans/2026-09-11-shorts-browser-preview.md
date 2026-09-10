# Shorts browser preview

Replace external preview sessions with a lazy, fixed browser bundle in an opaque
sandboxed srcdoc frame. Manager resolves authorized canonical HLS URLs and bounded
retained audio/image/component bytes; it does not execute generated code. Browser
streams HLS directly. Parent sends document/play/seek messages; frame has no Manager
credentials, same-origin access, forms, popups, or top navigation.

Move existing source materialization to explicit render preparation before saving
and requesting the exact prepared revision. Keep final render admission, codec
proofs and VM execution unchanged. No infrastructure changes or deployment bypass.

Verify text/custom/media playback, seek/edit, sandbox boundaries and resource loading;
run scoped tests, types and build. Keep concise results, not committed raw traces.
