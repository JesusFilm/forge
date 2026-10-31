# Feedback app

This app owns the mobile QR feedback form and server-side Linear delivery. Do not import application internals from `apps/web` or `apps/tv`. Keep media private and use Redis for expiring grants, quotas, and idempotency. QR data is untrusted context, not authentication.

The isolated `/tv/local` development receiver uses bounded filesystem state and
an explicit local receipt instead of Redis or verified grants. Keep it disabled
in production and preserve evidence; optional Linear delivery requires its own
explicit action and confirmed issue/attachments. See `LOCAL-FEEDBACK.md`.

The separate `/tv/simulator` route authorizes only after verifying the dedicated
Ed25519 token. Its server-created simulator grants bypass daily report counts;
normal native grants retain their limits. Preserve expiry, upload bounds,
ownership, idempotency and server-forced simulator labels. Never trust a client
source marker or place a private signing key in the TV bundle or server config.
