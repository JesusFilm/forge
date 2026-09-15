---
module: auth
tags: [auth, oauth, rate-limit, cloudflare, manager, better-auth]
problem_type: integration_issue
---

# Better Auth OAuth requests shared one rate-limit bucket

Manager sign-in intermittently returned HTTP 429 at
`/api/auth/oauth2/authorize`. Production Auth deployment
`20cb8966-89e1-49e7-9dea-a34c6309ccb2` logged that Better Auth could not determine
a trusted client IP and was using a shared per-path bucket. HTTP logs confirmed
repeated authorization 429s, including requests on 2026-09-10 at 12:38–12:39 UTC.

Better Auth 1.7.1 defaults to reading `x-forwarded-for`, but rejects ambiguous
multi-address chains without configured trusted proxies. Auth had no
`advanced.ipAddress` configuration. Its separate custom-route limiter already
preferred `cf-connecting-ip`, but that helper does not control Better Auth's
OAuth endpoints.

Configure `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]` in
`apps/auth/src/auth/config.ts`. This uses the single client address supplied by
the Cloudflare ingress. Keep that ingress trusted: this configuration assumes
Cloudflare overwrites the header and production requests enter through the
configured edge. Do not add arbitrary forwarding headers as a fallback or
disable IP tracking. Requests without a resolved address retain Better Auth's
fallback bucket; rate-limit ceilings remain unchanged.

`apps/auth/src/auth/config.test.ts` passes the app's actual captured IP options
into an unmocked Better Auth instance with the real OAuth provider. It exhausts
the 30-request authorization budget for one Cloudflare IP and verifies a second
IP is still admitted. Changing `x-forwarded-for` cannot evade the first IP's
limit. The test failed with 429 on the second client's first request before the
configuration fix and passed afterward.

Production recovery still requires the normal PR-to-main deployment followed by
Manager sign-in verification. A successful fresh login-page load alone does not
prove this intermittent issue is resolved.
