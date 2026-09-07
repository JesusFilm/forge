# Studio browser preview host

This service serves a fixed browser bundle and bounded, expiring, broker-uploaded
assets. It NEVER evaluates generated code on the server. The browser origin must
be a distinct registrable site from Manager and carry no user cookies.

Stage requests require the dedicated service key; that key never enters browser
responses. Browser sessions use short-lived random capabilities for exactly their
staged files. Preserve restrictive CSP, sandbox, no-referrer, opaque origin, request
and storage caps. Production render execution belongs to feat-460.
