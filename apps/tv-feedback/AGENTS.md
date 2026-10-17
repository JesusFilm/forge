# Feedback app

This app owns the mobile QR feedback form and server-side Linear delivery. Do not import application internals from `apps/web` or `apps/tv`. Keep media private and use Redis for expiring grants, quotas, and idempotency. QR data is untrusted context, not authentication.
