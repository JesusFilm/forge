# Database and search certificate maintenance

Each subdirectory is an independent Docker build context for the digest-pinned
vendor image recorded in `images.json`. These images update certificate trust;
they preserve the PostgreSQL or Typesense programs, image startup configuration,
and existing data format. Build contexts contain no application code or secrets.

Run `python3 infra/security-ca/verify-image.py <name>` with Docker to compare
vendor configuration, environment, package inventory and executable hashes;
verify both affected chains fail independently through three CA stores; verify
valid TLS; and start the same server using empty, network-isolated storage.
The check creates no production connection and makes no model or indexing call.

Production changes use the normal reviewed PR-to-main release. Match each live
service's original image digest to exactly one context. Preserve its variables,
volumes, start command, networking, replicas and health settings. Confirm recovery
coverage before maintenance and deploy one service at a time. Restrict watch
patterns to its context so unrelated application commits cannot restart it.
A successful build is insufficient: verify the exact serving deployment, original
server hash, effective CA stores and read-only database/search health after release.
Do not upgrade database/search versions or restore data as part of this change.
