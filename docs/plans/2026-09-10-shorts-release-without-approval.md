# Shorts release without a separate reviewer

User requested removal of the Tataihono approval gate. Remove environment reviewer protection and code-level approval-history checks. Retain manual main-only dispatch, explicit publish input, enable switches, immutable candidate/run binding, bounded downloads, and separate VM selection. Remove obsolete approval tests; exercise real publisher entrypoint without approval API calls and reject mismatched source/run/bytes. This continues feat-462 (in progress). No runtime rendering changes.
